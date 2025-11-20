"""
Daily PnL calculator (lean version).

What it does:
- Pull core deal fields from table `private_deals_data_uat` (latest record per transit).
- Pull WAL funding premium grid from `catr_rates` by business_date.
- Pull SOFR 30D + Overnight rates (stubbed query to `sofr_rates`).
- Compute daily PnL from each deal's closing_date through today with weekend/holiday
  spanning (Fri accrues Fri+Sat+Sun; holidays add to the span; weekend at month-end
  accrues to the first business day of the next month).
- Persist rows into SQL table 2 (stubbed).
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import math
from typing import Dict, Iterable, List, Optional, Sequence

import psycopg2
from psycopg2.extras import DictCursor
from pymfl import Dates, Quotes

# ------------------------------------------------------------------------------
# Config
# ------------------------------------------------------------------------------

DB_CONN = "<database_connection_string>"  # TODO: replace.

# Quote labels (pymfl)
QUOTE_LABEL_30D = "SOFR_30D"
QUOTE_LABEL_ON = "SOFR_ON"

# Transit-specific multipliers for WAL undrawn calc
TRANSIT_MULTIPLIERS: Dict[str, float] = {
    "G9930": 0.08 * 0.005,  # 8% of 50 bps
    "G7182": 0.10 * 0.01,   # 10% of 100 bps
}

# Divisors to keep formulas easy to tweak
DAYCOUNT_DAILY = 365
DAYCOUNT_ON = 36_500               # 365 * 100
DIV_WAL_DRAWN = 3_650_000          # 365 * 10,000
DIV_WAL_UNDRAWN = 365_000          # 365 * 1,000


# ------------------------------------------------------------------------------
# Data classes
# ------------------------------------------------------------------------------

@dataclasses.dataclass
class DealRow:
    transit: str
    client_name: str
    business_date: Optional[dt.date]  # optional if table 1 supplies it per-row
    closing_date: dt.date
    most_recent_amendment_date: dt.date
    revolving_period_end_date: dt.date
    facility_maturity_date: dt.date
    applicable_margin: float  # decimal, e.g., 0.0425 for 4.25%
    unused_fee: float  # decimal
    currency: str
    bmo_commitment: float
    bmo_advances_outstanding: float
    min_utilization: Optional[float]  # decimal, e.g., 0.5 for 50%
    funding_premium: Optional[float] = None  # decimal

    # Derived fields:
    term_years: Optional[int] = None
    wal_years: Optional[float] = None
    min_utilization_amount: Optional[float] = None


@dataclasses.dataclass
class WalSpreads:
    """Funding premiums keyed by tenor year (1..10)."""

    levels: Dict[int, float]

    def by_year(self, years: int) -> float:
        years = min(max(years, 1), 10)
        return self.levels[years]


@dataclasses.dataclass
class SofrRate:
    date: dt.date
    sofr_30d: float  # decimal
    sofr_on: float  # decimal
    # 30d values treated as percent (e.g., 5.25), Overnight treated as percent.


# ------------------------------------------------------------------------------
# Fetchers (replace with real queries/API)
# ------------------------------------------------------------------------------

def fetch_deal_rows(conn: str) -> List[DealRow]:
    with psycopg2.connect(conn) as connection:
        with connection.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT *
                FROM (
                    SELECT
                        transit,
                        client_name,
                        business_date,
                        closing_date,
                        most_recent_amendment_date,
                        revolving_period_end_date,
                        facility_maturity_date,
                        applicable_margin,
                        unused_fee,
                        currency,
                        bmo_commitment,
                        bmo_advances_outstanding,
                        min_utilization,
                        funding_premium,
                        ROW_NUMBER() OVER (
                            PARTITION BY transit
                            ORDER BY business_date DESC
                        ) AS rn
                    FROM private_deals_data_uat
                ) t
                WHERE rn = 1
                """
            )
            rows = cur.fetchall()

    deals: List[DealRow] = []
    for r in rows:
        deals.append(
            DealRow(
                transit=r["transit"],
                client_name=r["client_name"],
                business_date=r["business_date"],
                closing_date=r["closing_date"],
                most_recent_amendment_date=r["most_recent_amendment_date"],
                revolving_period_end_date=r["revolving_period_end_date"],
                facility_maturity_date=r["facility_maturity_date"],
                applicable_margin=r["applicable_margin"],
                unused_fee=r["unused_fee"],
                currency=r["currency"],
                bmo_commitment=r["bmo_commitment"],
                bmo_advances_outstanding=r["bmo_advances_outstanding"],
                min_utilization=r["min_utilization"],
                funding_premium=r["funding_premium"],
            )
        )
    return deals


def fetch_wal_spreads(conn: str, as_of: dt.date) -> WalSpreads:
    """Pull WAL funding premium grid from catr_rates (filter by business_date)."""
    with psycopg2.connect(conn) as connection:
        with connection.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT
                    one_year_fp  AS fp1,
                    two_year_fp  AS fp2,
                    three_year_fp AS fp3,
                    four_year_fp  AS fp4,
                    five_year_fp  AS fp5,
                    six_year_fp   AS fp6,
                    seven_year_fp AS fp7,
                    eight_year_fp AS fp8,
                    nine_year_fp  AS fp9,
                    ten_year_fp   AS fp10
                FROM catr_rates
                WHERE business_date <= %s
                ORDER BY business_date DESC
                LIMIT 1
                """,
                (as_of,),
            )
            row = cur.fetchone()
    if not row:
        raise ValueError(f"No WAL spreads found on/before {as_of}")

    levels = {i: row[f"fp{i}"] for i in range(1, 11)}
    return WalSpreads(levels=levels)


def fetch_sofr_rates(_conn: str, start: dt.date, end: dt.date) -> Dict[dt.date, SofrRate]:
    q = Quotes()
    series_30d = q.TimeSeries([QUOTE_LABEL_30D], from_m=start, to=end, quote_label=QUOTE_LABEL_30D)
    series_on = q.TimeSeries([QUOTE_LABEL_ON], from_m=start, to=end, quote_label=QUOTE_LABEL_ON)

    rates: Dict[dt.date, SofrRate] = {}
    for row in series_30d:
        rates[row["date"]] = SofrRate(date=row["date"], sofr_30d=float(row["value"]), sofr_on=0.0)
    for row in series_on:
        existing = rates.get(row["date"]) or SofrRate(date=row["date"], sofr_30d=0.0, sofr_on=0.0)
        existing.sofr_on = float(row["value"])
        rates[row["date"]] = existing
    return rates


# ------------------------------------------------------------------------------
# Date helpers
# ------------------------------------------------------------------------------

_CAL = Dates().calendar("NYSE")


def business_days(start: dt.date, end: dt.date) -> List[dt.date]:
    return list(_CAL.business_days(start, end, inclusive=True))


def fiscal_year_for(day: dt.date) -> str:
    """Fiscal year starts Nov 1; FY label uses end-year (e.g., Nov-2023 -> FY2024)."""
    end_year = day.year + 1 if day.month >= 11 else day.year
    return f"FY{end_year}"


def day_span_for_date(idx: int, ordered_days: Sequence[dt.date]) -> int:
    current = ordered_days[idx]
    prev_day = ordered_days[idx - 1] if idx > 0 else None
    next_day = ordered_days[idx + 1] if idx + 1 < len(ordered_days) else None
    if prev_day and current.month != prev_day.month:
        return (current - prev_day).days
    if next_day:
        return max((next_day - current).days, 1)
    return 1


# ------------------------------------------------------------------------------
# Core calculations
# ------------------------------------------------------------------------------

def compute_derived_fields(deal: DealRow) -> DealRow:
    term_days = (deal.revolving_period_end_date - deal.most_recent_amendment_date).days
    deal.term_years = math.ceil(term_days / 360)

    wal_days = (deal.facility_maturity_date - deal.revolving_period_end_date).days
    deal.wal_years = ((wal_days * 0.5) / 360) + (deal.term_years or 0)

    deal.min_utilization_amount = (deal.min_utilization or 0) * deal.bmo_commitment if deal.min_utilization else 0
    return deal


def select_fp_rate(deal: DealRow, grid: WalSpreads) -> float:
    if deal.funding_premium is not None:
        return deal.funding_premium
    # Funding premium keyed off Term (Years) mapping to 1Y...10Y grid.
    return grid.by_year(max(1, min(10, math.ceil(deal.term_years or 0))))


def calculate_balances(deal: DealRow) -> tuple[float, float, bool]:
    min_amt = deal.min_utilization_amount or 0
    if min_amt > deal.bmo_advances_outstanding:
        drawn = min_amt
        unused = max(deal.bmo_commitment - min_amt, 0)
        return drawn, unused, True
    drawn = deal.bmo_advances_outstanding
    unused = max(deal.bmo_commitment - drawn, 0)
    return drawn, unused, False


def compute_pnl_components(
    *,
    daycount: int,
    advances_outstanding: float,
    drawn_base: float,
    unused_base: float,
    min_util_amount: float,
    commitment: float,
    funding_premium: float,
    unused_fee: float,
    applicable_margin: float,
    spread_mult: float,
    sofr_on_t1: float,
    sofr_30d_t1: float,
) -> Dict[str, float]:
    use_min = min_util_amount > advances_outstanding

    wal_drawn_base = min_util_amount if use_min else advances_outstanding
    wal_undrawn_base = (commitment - min_util_amount) if use_min else unused_base

    cost_of_funds_drawn = (advances_outstanding * sofr_on_t1 * daycount) / DAYCOUNT_ON
    cost_of_funds_wal_drawn = (wal_drawn_base * daycount * funding_premium) / DIV_WAL_DRAWN
    cost_of_funds_wal_undrawn = (spread_mult * funding_premium * daycount * wal_undrawn_base) / DIV_WAL_UNDRAWN

    unused_revenue = (unused_fee * daycount * wal_undrawn_base) / DAYCOUNT_DAILY
    gross_rate = (sofr_30d_t1 / 100) + applicable_margin
    gross_revenue = (gross_rate * daycount * wal_drawn_base) / DAYCOUNT_DAILY

    pnl = (
        cost_of_funds_drawn
        + cost_of_funds_wal_undrawn
        + cost_of_funds_wal_drawn
        + unused_revenue
        + gross_revenue
    )

    return {
        "cost_of_funds_drawn": cost_of_funds_drawn,
        "cost_of_funds_wal_undrawn": cost_of_funds_wal_undrawn,
        "cost_of_funds_wal_drawn": cost_of_funds_wal_drawn,
        "unused_revenue": unused_revenue,
        "gross_revenue": gross_revenue,
        "pnl": pnl,
        "gross_rate": gross_rate,
    }


def _closest_rate(target: dt.date, rates: Dict[dt.date, SofrRate]) -> Optional[SofrRate]:
    """Pick the latest available rate on or before target."""
    eligible = [d for d in rates if d <= target]
    if not eligible:
        return None
    return rates[max(eligible)]


def build_pnl_rows(
    deal: DealRow,
    wal_grid: WalSpreads,
    rates: Dict[dt.date, SofrRate],
    start: dt.date,
    end: dt.date,
) -> List[dict]:
    days = business_days(start, end)
    rows: List[dict] = []
    drawn_balance, unused_balance, min_applied = calculate_balances(deal)
    fp_rate = select_fp_rate(deal, wal_grid)

    for idx, biz_day in enumerate(days):
        span_days = day_span_for_date(idx, days)
        rate_t0 = rates.get(biz_day) or _closest_rate(biz_day, rates)
        if not rate_t0:
            raise ValueError(f"No SOFR rate available for {biz_day}")
        rate_t1 = _closest_rate(biz_day - dt.timedelta(days=1), rates)
        if not rate_t1:
            raise ValueError(f"No prior SOFR rate available for {biz_day}")

        daycount = span_days

        drawn_base = drawn_balance if not min_applied else deal.min_utilization_amount or 0
        drawn_base = drawn_base or drawn_balance
        unused_base = unused_balance if not min_applied else max(deal.bmo_commitment - (deal.min_utilization_amount or 0), 0)

        components = compute_pnl_components(
            daycount=daycount,
            advances_outstanding=deal.bmo_advances_outstanding,
            drawn_base=drawn_base,
            unused_base=unused_base,
            min_util_amount=deal.min_utilization_amount or 0,
            commitment=deal.bmo_commitment,
            funding_premium=fp_rate,
            unused_fee=deal.unused_fee,
            applicable_margin=deal.applicable_margin,
            spread_mult=TRANSIT_MULTIPLIERS.get(deal.transit, 0),
            sofr_on_t1=rate_t1.sofr_on,
            sofr_30d_t1=rate_t1.sofr_30d,
        )

        rows.append(
            {
                "transit": deal.transit,
                "client_name": deal.client_name,
                "business_date": biz_day,
                "fiscal_year": fiscal_year_for(biz_day),
                "day_count": span_days,
                "currency": deal.currency,
                "min_utilization": deal.min_utilization or 0,
                "min_utilization_amount": deal.min_utilization_amount or 0,
                "min_utilization_applied": min_applied,
                "drawn_balance": drawn_base,
                "unused_balance": unused_base,
                "term_years": deal.term_years,
                "wal_years": deal.wal_years,
                "funding_premium": fp_rate,
                "applicable_margin": deal.applicable_margin,
                "unused_fee": deal.unused_fee,
                "sofr_30d_t0": rate_t0.sofr_30d,
                "sofr_on_t0": rate_t0.sofr_on,
                "sofr_30d_t1": rate_t1.sofr_30d,
                "sofr_on_t1": rate_t1.sofr_on,
                "gross_rate": components["gross_rate"],
                "cost_of_funds_drawn": components["cost_of_funds_drawn"],
                "cost_of_funds_wal_undrawn": components["cost_of_funds_wal_undrawn"],
                "cost_of_funds_wal_drawn": components["cost_of_funds_wal_drawn"],
                "unused_revenue": components["unused_revenue"],
                "gross_revenue": components["gross_revenue"],
                "pnl": components["pnl"],
            }
        )
    return rows


# ------------------------------------------------------------------------------
# Persistence
# ------------------------------------------------------------------------------

def store_pnl_rows(conn: str, rows: Iterable[dict]) -> None:
    """
    Insert/upsert rows into SQL table 2.
    """
    if not rows:
        return
    with psycopg2.connect(conn) as connection:
        with connection.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO table_2 (
                    transit,
                    client_name,
                    business_date,
                    fiscal_year,
                    day_count,
                    currency,
                    min_utilization,
                    min_utilization_amount,
                    min_utilization_applied,
                    drawn_balance,
                    unused_balance,
                    term_years,
                    wal_years,
                    funding_premium,
                    applicable_margin,
                    unused_fee,
                    sofr_30d_t0,
                    sofr_on_t0,
                    sofr_30d_t1,
                    sofr_on_t1,
                    cost_of_funds_drawn,
                    cost_of_funds_wal_undrawn,
                    cost_of_funds_wal_drawn,
                    unused_revenue,
                    gross_revenue,
                    gross_rate,
                    pnl
                )
                VALUES (
                    %(transit)s,
                    %(client_name)s,
                    %(business_date)s,
                    %(fiscal_year)s,
                    %(day_count)s,
                    %(currency)s,
                    %(min_utilization)s,
                    %(min_utilization_amount)s,
                    %(min_utilization_applied)s,
                    %(drawn_balance)s,
                    %(unused_balance)s,
                    %(term_years)s,
                    %(wal_years)s,
                    %(funding_premium)s,
                    %(applicable_margin)s,
                    %(unused_fee)s,
                    %(sofr_30d_t0)s,
                    %(sofr_on_t0)s,
                    %(sofr_30d_t1)s,
                    %(sofr_on_t1)s,
                    %(cost_of_funds_drawn)s,
                    %(cost_of_funds_wal_undrawn)s,
                    %(cost_of_funds_wal_drawn)s,
                    %(unused_revenue)s,
                    %(gross_revenue)s,
                    %(gross_rate)s,
                    %(pnl)s
                )
                """,
                list(rows),
            )


# ------------------------------------------------------------------------------
# Orchestration
# ------------------------------------------------------------------------------

def calculate_pnl_for_all_deals(
    start_override: Optional[dt.date] = None,
    end_override: Optional[dt.date] = None,
) -> None:
    deals = [compute_derived_fields(d) for d in fetch_deal_rows(DB_CONN)]
    if not deals:
        print("No deals returned; exiting.")
        return

    overall_start = start_override or min(d.closing_date for d in deals)
    overall_end = end_override or dt.date.today()
    rates = fetch_sofr_rates(DB_CONN, overall_start, overall_end)

    all_rows: List[dict] = []
    for deal in deals:
        wal_grid = fetch_wal_spreads(DB_CONN, deal.most_recent_amendment_date)
        all_rows.extend(
            build_pnl_rows(
                deal=deal,
                wal_grid=wal_grid,
                rates=rates,
                start=deal.closing_date,
                end=overall_end,
            )
        )

    store_pnl_rows(DB_CONN, all_rows)


if __name__ == "__main__":
    calculate_pnl_for_all_deals()
