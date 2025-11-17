const configSelect = document.getElementById("config-select");
const reloadConfigsBtn = document.getElementById("reload-configs");
const loadMetricsBtn = document.getElementById("load-metrics");
const configStatus = document.getElementById("config-status");
const metricList = document.getElementById("metric-list");
const summaryTableBody = document.querySelector("#summary-table tbody");
const detailTableBody = document.querySelector("#detail-table tbody");
const addSummaryFieldBtn = document.getElementById("add-summary-field");
const addDetailRowBtn = document.getElementById("add-detail-row");
const saveProfileBtn = document.getElementById("save-profile");
const resetProfileBtn = document.getElementById("reset-profile");
const profileStatus = document.getElementById("profile-status");
const previewBox = document.getElementById("profile-preview");
const visualizeBtn = document.getElementById("visualize-report");

let configs = [];
let profile = { summary_fields: [], detail_rows: [] };
let metrics = [{ label: "As of Date (Business Date)", value: "@business_date" }];

function fetchJSON(url, options) {
  return fetch(url, options).then((response) => {
    if (!response.ok) {
      return response.json().then((payload) => {
        const err = new Error(payload?.error || "Request failed");
        err.payload = payload;
        throw err;
      });
    }
    return response.json();
  });
}

async function loadConfigs() {
  configStatus.textContent = "Loading configs…";
  try {
    const data = await fetchJSON("/api/configs");
    configs = data.configs || [];
    configSelect.innerHTML = "";
    configs.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = `${entry.name} (updated ${entry.updated.slice(0, 10)})`;
      configSelect.appendChild(option);
    });
    configStatus.textContent = `${configs.length} configs`;
  } catch (err) {
    configStatus.textContent = `Failed to load configs: ${err.message}`;
  }
}

async function loadProfile() {
  try {
    profile = await fetchJSON("/api/report/profile");
  } catch {
    profile = { summary_fields: [], detail_rows: [] };
  }
  if (!Array.isArray(profile.summary_fields)) profile.summary_fields = [];
  if (!Array.isArray(profile.detail_rows)) profile.detail_rows = [];
  renderSummaryFields();
  renderDetailRows();
  renderPreview();
}

async function loadMetrics() {
  const selected = configSelect.value;
  if (!selected) {
    configStatus.textContent = "Select a config.";
    return;
  }
  configStatus.textContent = "Loading metrics…";
  try {
    const data = await fetchJSON(`/api/configs/${encodeURIComponent(selected)}`);
    const fields = data.config?.fields || {};
    metrics = [{ label: "As of Date (Business Date)", value: "@business_date" }];
    const appendMetrics = (prefix, entries) => {
      Object.keys(entries || {}).forEach((key) => {
        metrics.push({ label: `${prefix}: ${key}`, value: key });
      });
    };
    appendMetrics("Static", fields.static_values);
    appendMetrics("Cell", fields.cell_references);
    appendMetrics("Variable", fields.variables);
    Object.keys(fields.calculated_fields || {}).forEach((key) => {
      metrics.push({ label: `Calculated: ${key}`, value: key });
    });
    metricList.innerHTML = metrics
      .map((metric) => `<div>• ${metric.label} (${metric.value})</div>`)
      .join("");
    configStatus.textContent = `Loaded ${metrics.length} metrics from ${selected}`;
    renderSummaryFields();
    renderDetailRows();
  } catch (err) {
    configStatus.textContent = `Metrics load failed: ${err.message}`;
  }
}

function createSummaryRow(field = { label: "", source: "", format: "", aggregate: "" }) {
  const tr = document.createElement("tr");
  const labelInput = document.createElement("input");
  labelInput.value = field.label || "";
  labelInput.addEventListener("input", (event) => {
    field.label = event.target.value;
    renderPreview();
  });

  const sourceSelect = document.createElement("select");
  populateMetricOptions(sourceSelect, field.source);
  sourceSelect.addEventListener("change", (event) => {
    field.source = event.target.value;
    renderPreview();
  });

  const formatSelect = document.createElement("select");
  ["", "currency", "number", "percentage"].forEach((fmt) => {
    const option = document.createElement("option");
    option.value = fmt;
    option.textContent = fmt || "Auto";
    if (fmt === field.format) option.selected = true;
    formatSelect.appendChild(option);
  });
  formatSelect.addEventListener("change", (event) => {
    field.format = event.target.value;
    renderPreview();
  });

  const aggregateSelect = document.createElement("select");
  [
    { label: "None", value: "" },
    { label: "Sum", value: "sum" },
    { label: "Average", value: "average" },
    { label: "Max", value: "max" },
    { label: "Min", value: "min" },
    { label: "Ratio (use numerator/denominator)", value: "ratio" },
  ].forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    if (entry.value === field.aggregate) option.selected = true;
    aggregateSelect.appendChild(option);
  });
  const ratioContainer = document.createElement("div");
  ratioContainer.style.display = field.aggregate === "ratio" ? "block" : "none";
  ratioContainer.style.marginTop = "0.3rem";

  const numeratorSelect = document.createElement("select");
  populateMetricOptions(numeratorSelect, field.numerator);
  numeratorSelect.addEventListener("change", (event) => {
    field.numerator = event.target.value;
    renderPreview();
  });
  numeratorSelect.placeholder = "Numerator";

  const denominatorSelect = document.createElement("select");
  populateMetricOptions(denominatorSelect, field.denominator);
  denominatorSelect.addEventListener("change", (event) => {
    field.denominator = event.target.value;
    renderPreview();
  });

  ratioContainer.appendChild(document.createTextNode("Numerator"));
  ratioContainer.appendChild(numeratorSelect);
  ratioContainer.appendChild(document.createTextNode("Denominator"));
  ratioContainer.appendChild(denominatorSelect);

  const aggregateWrapper = document.createElement("div");
  aggregateWrapper.appendChild(aggregateSelect);
  aggregateWrapper.appendChild(ratioContainer);

  aggregateSelect.addEventListener("change", (event) => {
    field.aggregate = event.target.value;
    ratioContainer.style.display = event.target.value === "ratio" ? "block" : "none";
    renderPreview();
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "row-actions";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    profile.summary_fields = profile.summary_fields.filter((item) => item !== field);
    renderSummaryFields();
    renderPreview();
  });

  tr.appendChild(createCell(labelInput));
  tr.appendChild(createCell(sourceSelect));
  tr.appendChild(createCell(formatSelect));
  tr.appendChild(createCell(aggregateWrapper));
  tr.appendChild(createCell(removeBtn));
  return tr;
}

function createDetailRow(row = defaultDetailRow()) {
  const tr = document.createElement("tr");

  const leftLabel = document.createElement("input");
  leftLabel.value = row.left_label || "";
  leftLabel.addEventListener("input", (event) => {
    row.left_label = event.target.value;
    renderPreview();
  });

  const leftSelect = createValueSelector(row, "left");
  const rightLabel = document.createElement("input");
  rightLabel.value = row.right_label || "";
  rightLabel.addEventListener("input", (event) => {
    row.right_label = event.target.value;
    renderPreview();
  });

  const rightSelect = createValueSelector(row, "right");

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "row-actions";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    profile.detail_rows = profile.detail_rows.filter((item) => item !== row);
    renderDetailRows();
    renderPreview();
  });

  tr.appendChild(createCell(leftLabel));
  tr.appendChild(createCell(leftSelect));
  tr.appendChild(createCell(rightLabel));
  tr.appendChild(createCell(rightSelect));
  tr.appendChild(createCell(removeBtn));
  return tr;
}

function createValueSelector(row, side) {
  const container = document.createElement("div");
  const typeSelect = document.createElement("select");
  [
    { label: "Field", value: "field" },
    { label: "Text", value: "text" },
  ].forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    if ((row[`${side}_type`] || "field") === entry.value) option.selected = true;
    typeSelect.appendChild(option);
  });

  const valueSelect = document.createElement("select");
  populateMetricOptions(valueSelect, row[`${side}_source`]);
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.placeholder = "Custom value";
  textInput.value = row[`${side}_text`] || "";

  const renderControl = () => {
    container.innerHTML = "";
    if (typeSelect.value === "text") {
      container.appendChild(typeSelect);
      container.appendChild(textInput);
    } else {
      container.appendChild(typeSelect);
      container.appendChild(valueSelect);
    }
  };

  typeSelect.addEventListener("change", () => {
    row[`${side}_type`] = typeSelect.value;
    renderControl();
    renderPreview();
  });
  valueSelect.addEventListener("change", (event) => {
    row[`${side}_source`] = event.target.value;
    renderPreview();
  });
  textInput.addEventListener("input", (event) => {
    row[`${side}_text`] = event.target.value;
    renderPreview();
  });

  renderControl();
  return container;
}

function populateMetricOptions(selectEl, currentValue) {
  selectEl.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Select metric…";
  selectEl.appendChild(option);
  let hasCurrent = false;
  metrics.forEach((metric) => {
    const item = document.createElement("option");
    item.value = metric.value;
    item.textContent = metric.label;
    if (metric.value === currentValue) {
      item.selected = true;
      hasCurrent = true;
    }
    selectEl.appendChild(item);
  });
  if (currentValue && !hasCurrent) {
    const custom = document.createElement("option");
    custom.value = currentValue;
    custom.textContent = currentValue;
    custom.selected = true;
    selectEl.appendChild(custom);
  }
}

function createCell(content) {
  const td = document.createElement("td");
  if (content instanceof HTMLElement) {
    td.appendChild(content);
  } else {
    td.textContent = content;
  }
  return td;
}

function renderSummaryFields() {
  summaryTableBody.innerHTML = "";
  if (!profile.summary_fields.length) {
    profile.summary_fields.push({ label: "", source: "" });
  }
  profile.summary_fields.forEach((field) => {
    summaryTableBody.appendChild(createSummaryRow(field));
  });
}

function defaultDetailRow() {
  return {
    left_label: "",
    left_type: "field",
    left_source: "",
    left_text: "",
    right_label: "",
    right_type: "field",
    right_source: "",
    right_text: "",
  };
}

function renderDetailRows() {
  detailTableBody.innerHTML = "";
  if (!profile.detail_rows.length) {
    profile.detail_rows.push(defaultDetailRow());
  }
  profile.detail_rows.forEach((row) => {
    detailTableBody.appendChild(createDetailRow(row));
  });
}

function renderPreview() {
  if (!previewBox) return;
  previewBox.textContent = JSON.stringify(profile, null, 2);
}

async function saveProfile() {
  profileStatus.textContent = "Saving profile…";
  try {
    await fetchJSON("/api/report/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    profileStatus.textContent = "Profile saved.";
    renderPreview();
  } catch (err) {
    profileStatus.textContent = `Save failed: ${err.message}`;
  }
}

function resetProfile() {
  profile = { summary_fields: [], detail_rows: [] };
  renderSummaryFields();
  renderDetailRows();
  renderPreview();
}

addSummaryFieldBtn.addEventListener("click", () => {
  profile.summary_fields.push({ label: "", source: "" });
  renderSummaryFields();
});

addDetailRowBtn.addEventListener("click", () => {
  profile.detail_rows.push(defaultDetailRow());
  renderDetailRows();
});

saveProfileBtn.addEventListener("click", saveProfile);
resetProfileBtn.addEventListener("click", resetProfile);
reloadConfigsBtn.addEventListener("click", loadConfigs);
loadMetricsBtn.addEventListener("click", loadMetrics);
function buildPreviewHTML() {
  const summaryRows = (profile.summary_fields || [])
    .map(
      (field) =>
        `<tr><td>${field.label || field.source}</td><td>${field.source ? `{{${field.source}}}` : ""}</td><td>${
          field.format || ""
        }</td></tr>`
    )
    .join("");
  const detailRows = (profile.detail_rows || [])
    .map((row) => {
      const leftValue =
        (row.left_type === "text" ? row.left_text : row.left_source ? `{{${row.left_source}}}` : "") || "";
      const rightValue =
        (row.right_type === "text" ? row.right_text : row.right_source ? `{{${row.right_source}}}` : "") || "";
      return `<tr><th>${row.left_label || ""}</th><td>${leftValue}</td><th>${row.right_label || ""}</th><td>${rightValue}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>Report Preview</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background:#f5f7fb; color:#0f1a33; padding: 20px; }
        .summary-table { width:100%; border-collapse: collapse; margin-bottom: 24px; background:#fff; border-radius: 16px; overflow:hidden; box-shadow:0 8px 24px rgba(15,42,99,0.08); }
        .summary-table th, .summary-table td { padding: 10px; border-bottom:1px solid #eef2fb; text-align:left; }
        .summary-table th { background:#1a3bb5; color:#fff; }
        .detail-table { width:100%; border-collapse: collapse; background:#fff; border-radius: 16px; overflow:hidden; box-shadow:0 8px 24px rgba(15,42,99,0.08); }
        .detail-table th { background:#f5f7ff; text-transform:uppercase; font-size:0.75rem; letter-spacing:0.05em; padding:10px; color:#4d5b7e; }
        .detail-table td { padding:10px; border-bottom:1px solid #eef2fb; font-weight:600; color:#16255a; }
      </style>
    </head>
    <body>
      <h2>Summary Preview</h2>
      <table class="summary-table">
        <tr><th>Label</th><th>Value</th><th>Format</th></tr>
        ${summaryRows || "<tr><td colspan='3'>No summary fields configured.</td></tr>"}
      </table>
      <h2>Detail Preview</h2>
      <table class="detail-table">
        ${detailRows || "<tr><td colspan='4'>No detail rows configured.</td></tr>"}
      </table>
    </body>
  </html>`;
}

if (visualizeBtn) {
  visualizeBtn.addEventListener("click", () => {
    const html = buildPreviewHTML();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  });
}

async function initialize() {
  await loadConfigs();
  await loadProfile();
  await loadMetrics();
}

initialize();
