# Denis Goubkine Reporting Toolkit

This repo contains everything needed to design, preview, and send the borrowing-base reports used by Denis Goubkine’s deals. It includes:

- **Flask Config Builder** (`config_web_app.py`, `templates/index.html`, `static/app.js`) – define each deal’s directory, file pattern, static values, and Excel cell references.
- **Report Profile Builder** (`/report`, `templates/report_builder.html`, `static/report_builder.js`) – configure the shared summary and per-deal detail quadrants. Supports multiple deals with their own layouts.
- **Deal Loader** (`deal_loader.py`) – renders the final HTML/Outlook draft by reading configs + Excel files and applying the saved report profile.
- **Sample Data** (`sample_data/`) – contains demo Excel files (e.g., `Denis Goubkine Fund - Borrowing Base 2025-08-15.xlsx`) you can use to test the pipeline without waiting for real files.

## Requirements
- Python 3.10+ with `pip install flask openpyxl pywin32`
- Windows (for Outlook draft creation)

---

## Config Builder (service URLs below assume Flask is running locally)

1. Start the Flask app:
   ```
   python config_web_app.py
   ```
2. Visit `http://127.0.0.1:5050/`
3. Use the **Deal Config Studio** to:
   - Enter SPV, file pattern, directory path, static values, cell references, variables, and calculated fields.
   - Define the business-date source (filename regex vs. sheet/cell).
   - Save each deal’s config to `configs/<deal>.json`.

### Testing Config Extraction
1. Place your Excel files in the directory specified by the config (for demos, drop them into `sample_data/`).
2. Run:
   ```
   python deal_loader.py --config-dir configs --sample-data sample_data --force-demo --report-profile report_profile.json
   ```
   This will:
   - Rebuild demo workbooks (if needed).
   - Parse every config and matching Excel file.
   - Write `deal_loader_report.html` and open an Outlook draft with the rendered HTML.

---

## Report Profile Builder

1. Visit `http://127.0.0.1:5050/report`
2. Select a config and click **Load Metrics** – the palette is populated from that deal’s static/cell/variable/calculated fields.
3. Configure the **Shared Summary**:
   - These rows are common across all deals; each row shows label/source/format/aggregate.
   - Missing sources (for the currently loaded config) highlight in red.
   - Removing a summary field pops a confirmation before deletion.
4. Configure the **Detail Quadrants**:
   - Each config gets its own layout (stored in `profile.deal_layouts`).
   - Rows render `Label/Value | Label/Value` (columns 1/2 and 3/4).
   - Use “Field” for metrics or switch to “Text” to insert notes.
5. Save the profile (writes to `report_profile.json`) and/or click **Visualize Email** to open the rendered HTML in a new tab (uses the same template the loader uses).

---

## Loader Behavior
1. Loads `report_profile.json`, which defines:
   - `summary_fields` – shared across all deals.
   - `deal_layouts` – per-deal detail rows keyed by config name.
   - `detail_rows` (optional default layout when a deal has no specific layout).
2. Parses each config/Excel file pair and builds `DealResult` objects containing the extracted values.
3. Renders a single HTML report containing:
   - Summary table with totals (respects `aggregate`/`format` settings).
   - Deal-specific detail cards (each using its layout from `deal_layouts`).
4. Saves `deal_loader_report.html` and opens an Outlook draft (if `pywin32` is available). If Outlook isn’t configured or `pywin32` isn’t installed, the loader simply prints the path to the HTML file.

---

## How to Test Everything

1. **Config Builder**: Create or edit a deal (e.g., `denis_goubkine_fund`) and save it (`configs/denis_goubkine_fund.json`).
2. **Sample Excel**: Use the provided demo file or generate a new one:
   ```
   python -c "from pathlib import Path; from openpyxl import Workbook; from datetime import datetime
   # ... (see sample_data generator snippet in updates) ..."
   ```
   Ensure the filename matches the config’s `file_pattern` and drop it into `sample_data/`.
3. **Report Builder**: Visit `/report`, select the config, load metrics, define layout, and save the profile.
4. **Loader**: Run `python deal_loader.py --config-dir configs --sample-data sample_data --report-profile report_profile.json` — the console will show any missing metrics; `deal_loader_report.html` will show the final HTML, and Outlook will open a draft if available.

---

## File/Directory Overview

```
configs/                  # Deal configs (JSON)
  denis_goubkine_fund.json
sample_data/              # Excel files used for testing/loader input
  Denis Goubkine Fund - Borrowing Base 2025-08-15.xlsx
templates/
  index.html              # Config builder UI
  report_builder.html     # Report profile builder UI
static/
  app.js                  # Config builder logic
  report_builder.js       # Report builder logic
config_web_app.py         # Flask app hosting both builders
deal_loader.py            # CLI/Outlook report generator
report_profile.json       # Shared profile with summary fields + deal layouts
```

Feel free to edit configs or profiles directly, but use the builder UI when possible to avoid syntax errors. For questions or enhancements (e.g., adding a live reporting dashboard), note them in README or create issues in your personal tracking system.
