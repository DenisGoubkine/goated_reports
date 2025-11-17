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
const summaryWarning = document.getElementById("summary-warning");

let configs = [];
let profile = { summary_fields: [], deal_layouts: {} };
let metrics = [{ label: "As of Date (Business Date)", value: "@business_date" }];
let currentDealKey = "";

function getCurrentDeal() {
  return configSelect.value || currentDealKey || (configs[0]?.name || "");
}

function ensureDealLayout(dealKey) {
  if (!dealKey) {
    return {"detail_rows": []};
  }
  if (!profile.deal_layouts) profile.deal_layouts = {};
  if (!profile.deal_layouts[dealKey]) {
    profile.deal_layouts[dealKey] = { detail_rows: [] };
  }
  const layout = profile.deal_layouts[dealKey];
  if (!Array.isArray(layout.detail_rows)) layout.detail_rows = [];
  return layout;
}

function getCurrentDetailRows() {
  const dealKey = getCurrentDeal();
  if (!dealKey) {
    return null;
  }
  const layout = ensureDealLayout(dealKey);
  if (!layout.detail_rows.length) {
    layout.detail_rows.push(defaultDetailRow());
  }
  return layout.detail_rows;
}

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
    if (configs.length && !configSelect.value) {
      configSelect.value = configs[0].name;
    }
    currentDealKey = configSelect.value || currentDealKey;
    configStatus.textContent = `${configs.length} configs`;
  } catch (err) {
    configStatus.textContent = `Failed to load configs: ${err.message}`;
  }
}

async function loadProfile() {
  try {
    profile = await fetchJSON("/api/report/profile");
  } catch {
    profile = { summary_fields: [], deal_layouts: {} };
  }
  if (!Array.isArray(profile.summary_fields)) profile.summary_fields = [];
  if (!profile.deal_layouts || typeof profile.deal_layouts !== "object") {
    profile.deal_layouts = {};
  }
  renderSummaryFields();
  renderDetailRows();
  renderPreview();
  if (profileStatus) profileStatus.textContent = "";
}

async function loadMetrics() {
  const selected = configSelect.value;
  if (!selected) {
    configStatus.textContent = "Select a config.";
    return;
  }
  currentDealKey = selected;
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
    ensureDealLayout(selected);
    renderSummaryFields();
    renderDetailRows();
    if (profileStatus) profileStatus.textContent = "";
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
    const rows = getCurrentDetailRows();
    if (rows) {
      const index = rows.indexOf(row);
      if (index >= 0) {
        rows.splice(index, 1);
      }
    }
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
  const showMissing = metrics.length > 1;
  const metricValues = new Set(metrics.map((metric) => metric.value));
  const missingLabels = [];
  profile.summary_fields.forEach((field) => {
    const row = createSummaryRow(field);
    if (showMissing && field.source && field.source !== "@business_date" && !metricValues.has(field.source)) {
      row.classList.add("missing-summary");
      missingLabels.push(field.label || field.source);
    }
    summaryTableBody.appendChild(row);
  });
  if (summaryWarning) {
    summaryWarning.textContent = showMissing && missingLabels.length
      ? `Missing in current config: ${missingLabels.join(", ")}`
      : "";
  }
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
  const rows = getCurrentDetailRows();
  if (!rows || !rows.length) {
    detailTableBody.innerHTML = "<tr><td colspan='5'>Select a config and load metrics to design detail rows.</td></tr>";
    return;
  }
  rows.forEach((row) => {
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
  profile = { summary_fields: [], deal_layouts: {} };
  renderSummaryFields();
  renderDetailRows();
  renderPreview();
  if (summaryWarning) summaryWarning.textContent = "";
}

addSummaryFieldBtn.addEventListener("click", () => {
  profile.summary_fields.push({ label: "", source: "" });
  renderSummaryFields();
});

addDetailRowBtn.addEventListener("click", () => {
  const rows = getCurrentDetailRows();
  if (!rows) {
    configStatus.textContent = "Select a config and load metrics before adding rows.";
    return;
  }
  rows.push(defaultDetailRow());
  renderDetailRows();
});

saveProfileBtn.addEventListener("click", saveProfile);
resetProfileBtn.addEventListener("click", resetProfile);
reloadConfigsBtn.addEventListener("click", loadConfigs);
loadMetricsBtn.addEventListener("click", loadMetrics);
configSelect.addEventListener("change", () => {
  currentDealKey = configSelect.value;
  renderDetailRows();
  renderSummaryFields();
});
if (visualizeBtn) {
  visualizeBtn.addEventListener("click", () => {
    const payload = {
      summary_fields: profile.summary_fields,
      detail_rows: getCurrentDetailRows() || [],
    };
    profileStatus.textContent = "Generating preview…";
    fetchJSON("/api/report/visualize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        const blob = new Blob([response.html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        profileStatus.textContent = "Preview opened in new tab.";
      })
      .catch((err) => {
        profileStatus.textContent = `Visualization failed: ${err.message}`;
      });
  });
}

async function initialize() {
  await loadConfigs();
  await loadProfile();
  await loadMetrics();
}

initialize();
