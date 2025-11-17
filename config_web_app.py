from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BASE_DIR / "configs"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
REPORT_PROFILE_PATH = BASE_DIR / "report_profile.json"

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")
FORMULA_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

DEFAULT_REPORT_PROFILE = {
    "summary_fields": [
        {"label": "Client Name", "source": "client_name"},
        {"label": "Borrower Name", "source": "borrower_name"},
        {"label": "Risk Rating", "source": "risk_rating"},
        {"label": "Closing Date", "source": "closing_date"},
        {"label": "Revolving Period End Date", "source": "revolving_period_end_date"},
        {"label": "Amortization Period End Date", "source": "amortization_period_end_date"},
        {"label": "Facility Maturity Date", "source": "facility_maturity_date"},
        {"label": "As of Date", "source": "@business_date"},
        {"label": "Global Advances Outstanding", "source": "global_advances_outstanding", "format": "currency"},
        {"label": "Global Commitment", "source": "global_commitment", "format": "currency"},
        {"label": "BMO Advances Outstanding", "source": "bmo_advances_outstanding", "format": "currency"},
        {"label": "BMO Commitment", "source": "bmo_commitment", "format": "currency"},
        {"label": "BMO Utilization", "source": "bmo_utilization", "format": "percentage"},
        {"label": "Collateral Par Balance", "source": "collateral_par_balance", "format": "currency"},
        {"label": "Max Facility Advance Rate", "source": "max_facility_advance_rate", "format": "percentage"},
        {"label": "Effective Advance Rate", "source": "effective_advance_rate", "format": "percentage"},
    ],
    "deal_layouts": {},
    "detail_rows": [],
}


def load_report_profile() -> Dict[str, Any]:
    if REPORT_PROFILE_PATH.exists():
        with REPORT_PROFILE_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    return DEFAULT_REPORT_PROFILE


REPORT_PROFILE = load_report_profile()


def validate_detail_rows(detail_rows: Any) -> Any:
    if not isinstance(detail_rows, list):
        return "Must be an array."
    row_errors: Dict[int, Any] = {}
    for idx, row in enumerate(detail_rows):
        if not isinstance(row, dict):
            row_errors[idx] = "Each row must be an object."
            continue
        for side in ("left", "right"):
            label_key = f"{side}_label"
            type_key = f"{side}_type"
            source_key = f"{side}_source"
            text_key = f"{side}_text"
            if not row.get(label_key):
                row_errors.setdefault(idx, {})[label_key] = "Label required."
            value_type = row.get(type_key) or "field"
            row[type_key] = value_type
            if value_type == "text":
                if not row.get(text_key):
                    row_errors.setdefault(idx, {})[text_key] = "Text required."
            else:
                if not row.get(source_key):
                    row_errors.setdefault(idx, {})[source_key] = "Source required."
            if value_type not in ("field", "text"):
                row_errors.setdefault(idx, {})[type_key] = "Type must be 'field' or 'text'."
    return row_errors


def validate_report_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    errors: Dict[str, Any] = {}
    summary_fields = profile.get("summary_fields", [])
    if not isinstance(summary_fields, list):
        errors["summary_fields"] = "Must be an array."
    else:
        for idx, field in enumerate(summary_fields):
            if not isinstance(field, dict):
                errors.setdefault("summary_fields", {})[idx] = "Each summary field must be an object."
                continue
            if not field.get("label"):
                errors.setdefault("summary_fields", {})[idx] = "Label is required."
            if not field.get("source"):
                errors.setdefault("summary_fields", {})[idx] = "Source is required."

    deal_layouts = profile.get("deal_layouts", {})
    if not isinstance(deal_layouts, dict):
        errors["deal_layouts"] = "Must be an object."
    else:
        for deal_name, layout in deal_layouts.items():
            if not isinstance(layout, dict):
                errors.setdefault("deal_layouts", {})[deal_name] = "Layout must be an object."
                continue
            detail_rows = layout.get("detail_rows", [])
            detail_errors = validate_detail_rows(detail_rows)
            if isinstance(detail_errors, str):
                errors.setdefault("deal_layouts", {})[deal_name] = {"detail_rows": detail_errors}
            elif detail_errors:
                errors.setdefault("deal_layouts", {})[deal_name] = {"detail_rows": detail_errors}

    return errors


def render_profile_preview(profile: Dict[str, Any], detail_rows: Any = None) -> str:
    summary_fields = profile.get("summary_fields", [])
    if detail_rows is None:
        detail_rows = profile.get("detail_rows", [])

    summary_header = "".join("<th>{}</th>".format(field.get("label", "")) for field in summary_fields)
    summary_rows = "".join(
        "<td>{{{{{}}}}}</td>".format(field.get("source", "")) for field in summary_fields
    )
    summary_html = (
        "<table class='summary-table'>"
        "<tr>{}</tr>"
        "<tr>{}</tr>"
        "</table>".format(summary_header or "<th>No Summary Fields</th>", summary_rows or "<td>—</td>")
    )

    detail_html_rows = []
    if detail_rows:
        for row in detail_rows:
            left_value = row.get("left_text", "") if row.get("left_type") == "text" else "{{%s}}" % row.get("left_source", "")
            right_value = row.get("right_text", "") if row.get("right_type") == "text" else "{{%s}}" % row.get("right_source", "")
            detail_html_rows.append(
                "<tr>"
                "<th>{}</th><td>{}</td>"
                "<th>{}</th><td>{}</td>"
                "</tr>".format(
                    row.get("left_label", ""),
                    left_value or "—",
                    row.get("right_label", ""),
                    right_value or "—",
                )
            )
    else:
        detail_html_rows.append("<tr><td colspan='4'>No detail rows configured.</td></tr>")

    detail_html = "<table class='detail-table'>{}</table>".format("".join(detail_html_rows))

    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Report Preview</title>
    <style>
      body {{ font-family: 'Segoe UI', Arial, sans-serif; background:#f5f7fb; color:#0f1a33; padding: 24px; }}
      .summary-table, .detail-table {{
        width: 100%;
        border-collapse: collapse;
        background:#fff;
        border-radius: 16px;
        overflow: hidden;
        box-shadow:0 12px 30px rgba(15,42,99,0.08);
        margin-bottom: 32px;
      }}
      .summary-table th, .summary-table td,
      .detail-table th, .detail-table td {{
        padding: 12px;
        border-bottom: 1px solid #eef2fb;
        text-align: left;
      }}
      .summary-table th, .detail-table th {{
        background:#1a3bb5;
        color:#fff;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.8rem;
      }}
      .detail-table th {{
        width: 20%;
      }}
      .detail-table td {{
        font-weight: 600;
        color:#16255a;
      }}
    </style>
  </head>
  <body>
    <h2>Summary Preview</h2>
    {summary_html}
    <h2>Detail Preview</h2>
    {detail_html}
  </body>
</html>"""


class ConfigValidationError(Exception):
    def __init__(self, errors: Dict[str, Any]):
        super().__init__("Invalid configuration payload")
        self.errors = errors


@dataclass
class ConfigRepository:
    base_dir: Path

    def _validate_name(self, name: str) -> str:
        name = name.strip()
        if not name:
            raise ValueError("Missing config name.")
        if not NAME_PATTERN.fullmatch(name):
            raise ValueError("Only letters, numbers, '.', '_' and '-' allowed in name.")
        return name

    def path_for(self, name: str) -> Path:
        safe = self._validate_name(name)
        return self.base_dir / f"{safe}.json"

    def list_configs(self) -> List[Dict[str, Any]]:
        entries = []
        for file in sorted(self.base_dir.glob("*.json")):
            entries.append(
                {
                    "name": file.stem,
                    "updated": datetime.fromtimestamp(file.stat().st_mtime).isoformat(),
                    "size": file.stat().st_size,
                }
            )
        return entries

    def load(self, name: str) -> Dict[str, Any]:
        path = self.path_for(name)
        if not path.exists():
            raise FileNotFoundError(f"Config '{name}' not found.")
        with path.open("r", encoding="utf-8-sig") as handle:
            data = json.load(handle)
        ensure_structure(data)
        return data

    def save(self, name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        path = self.path_for(name)
        ensure_structure(payload)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        return payload


def make_empty_document() -> Dict[str, Any]:
    return {
        "spv": "",
        "file_pattern": "",
        "directory": "",
        "fields": {
            "static_values": {},
            "cell_references": {},
            "variables": {},
            "calculated_fields": {},
        },
        "data_source": {"type": "filename", "regex": ""},
    }


def ensure_structure(document: Dict[str, Any]) -> None:
    document.setdefault("fields", {})
    fields = document["fields"]
    for key in ("static_values", "cell_references", "variables", "calculated_fields"):
        fields.setdefault(key, {})
        if not isinstance(fields[key], dict):
            raise ConfigValidationError({key: "Must be an object."})
    document.setdefault("data_source", {"type": "", "regex": ""})


def validate_document(document: Dict[str, Any]) -> Dict[str, Any]:
    errors: Dict[str, Any] = {}
    for header in ("spv", "file_pattern", "directory"):
        if not str(document.get(header, "")).strip():
            errors[header] = "Required."

    fields = document.get("fields", {})
    static_values = fields.get("static_values", {})
    cell_references = fields.get("cell_references", {})
    variables = fields.get("variables", {})
    calculated = fields.get("calculated_fields", {})

    def validate_cells(block: Dict[str, Any], label: str) -> None:
        for key, entry in block.items():
            if not key.strip():
                errors.setdefault(label, {})[key] = "Keys must not be empty."
            if not isinstance(entry, dict):
                errors.setdefault(label, {})[key] = "Must be an object with sheet/cell."
                continue
            if not entry.get("sheet", "").strip():
                errors.setdefault(label, {})[key] = "Missing sheet."
            if not entry.get("cell", "").strip():
                errors.setdefault(label, {})[key] = "Missing cell."

    validate_cells(cell_references, "cell_references")
    validate_cells(variables, "variables")

    available_formula_names = set(static_values.keys()) | set(variables.keys())
    for key, entry in calculated.items():
        if not isinstance(entry, dict):
            errors.setdefault("calculated_fields", {})[key] = "Must be an object."
            continue
        formula = entry.get("formula", "").strip()
        if not formula:
            errors.setdefault("calculated_fields", {})[key] = "Formula is required."
            continue
        referenced = set(FORMULA_TOKEN.findall(formula))
        unknown = referenced - available_formula_names
        if unknown:
            errors.setdefault("calculated_fields", {})[key] = (
                f"Unknown references: {', '.join(sorted(unknown))}"
            )

    data_source = document.get("data_source", {})
    if not str(data_source.get("type", "")).strip():
        errors.setdefault("data_source", {})["type"] = "Required."
    if not str(data_source.get("regex", "")).strip():
        errors.setdefault("data_source", {})["regex"] = "Required."

    return errors


repository = ConfigRepository(CONFIG_DIR)


@app.errorhandler(ConfigValidationError)
def handle_validation_error(exc: ConfigValidationError):
    return jsonify({"error": "validation_error", "details": exc.errors}), 400


@app.errorhandler(FileNotFoundError)
def handle_not_found(exc: FileNotFoundError):
    return jsonify({"error": "not_found", "details": str(exc)}), 404


@app.errorhandler(ValueError)
def handle_value_error(exc: ValueError):
    return jsonify({"error": "validation_error", "details": {"name": str(exc)}}), 400


@app.get("/api/configs")
def list_configs():
    return jsonify({"configs": repository.list_configs()})


@app.get("/api/configs/<name>")
def get_config(name: str):
    data = repository.load(name)
    return jsonify({"name": name, "config": data})


@app.get("/api/report/profile")
def get_report_profile():
    return jsonify(REPORT_PROFILE)


@app.put("/api/report/profile")
def update_report_profile():
    payload = request.get_json(force=True) or {}
    errors = validate_report_profile(payload)
    if errors:
        return jsonify({"error": "validation_error", "details": errors}), 400
    REPORT_PROFILE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    global REPORT_PROFILE
    REPORT_PROFILE = payload
    return jsonify(REPORT_PROFILE)


@app.post("/api/report/visualize")
def visualize_report_profile():
    payload = request.get_json(force=True) or {}
    profile_data = payload.get("profile", payload)
    if "deal_layouts" in profile_data:
        errors = validate_report_profile(profile_data)
        if errors:
            return jsonify({"error": "validation_error", "details": errors}), 400
        first_layout = next(iter(profile_data.get("deal_layouts", {}).values()), {})
        detail_rows = first_layout.get("detail_rows", [])
        html = render_profile_preview(profile_data, detail_rows)
        return jsonify({"html": html})
    summary_fields = profile_data.get("summary_fields", [])
    if not isinstance(summary_fields, list):
        return jsonify({"error": "validation_error", "details": {"summary_fields": "Must be an array."}}), 400
    detail_rows = profile_data.get("detail_rows", [])
    detail_errors = validate_detail_rows(detail_rows)
    if isinstance(detail_errors, str):
        return jsonify({"error": "validation_error", "details": {"detail_rows": detail_errors}}), 400
    if detail_errors:
        return jsonify({"error": "validation_error", "details": {"detail_rows": detail_errors}}), 400
    html = render_profile_preview({"summary_fields": summary_fields}, detail_rows)
    return jsonify({"html": html})


@app.post("/api/configs")
def create_config():
    payload = request.get_json(force=True)
    name = payload.get("name", "")
    config = payload.get("config") or {}
    ensure_structure(config)
    errors = validate_document(config)
    if errors:
        raise ConfigValidationError(errors)
    path = repository.path_for(name)
    if path.exists():
        raise ValueError(f"Config '{name}' already exists.")
    repository.save(name, config)
    return jsonify({"name": name, "config": config})


@app.put("/api/configs/<name>")
def update_config(name: str):
    payload = request.get_json(force=True)
    config = payload.get("config") or {}
    ensure_structure(config)
    errors = validate_document(config)
    if errors:
        raise ConfigValidationError(errors)
    repository.save(name, config)
    return jsonify({"name": name, "config": config})


@app.get("/")
def dashboard():
    return render_template("index.html")


@app.get("/report")
def report_builder():
    return render_template("report_builder.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
