const configSelect = document.getElementById("config-select");
const listStatus = document.getElementById("list-status");
const formStatus = document.getElementById("form-status");
const preview = document.getElementById("preview");
const form = document.getElementById("config-form");
const uploadBtn = document.getElementById("upload-config");
const uploadInput = document.getElementById("upload-input");
const sampleInput = document.getElementById("sample-file");
const buildRegexBtn = document.getElementById("build-regex");
const dataSourceTypeSelect = document.getElementById("data-source-type");
const dataSourceRegexInput = document.getElementById("data-source-regex");
const dataSourceSheetInput = document.getElementById("data-source-sheet");
const dataSourceCellInput = document.getElementById("data-source-cell");
const dataSourceValueLabelSpan = document.querySelector('label[for="data-source-regex"] span');

const sections = {
  static: document.getElementById("static-rows"),
  cell: document.getElementById("cell-rows"),
  variable: document.getElementById("variable-rows"),
  calc: document.getElementById("calc-rows"),
};

let currentName = null;

const emptyConfig = () => ({
  spv: "",
  file_pattern: "",
  directory: "",
  fields: {
    static_values: {},
    cell_references: {},
    variables: {},
    calculated_fields: {},
  },
  data_source: { type: "filename", regex: "" },
});

function createElement(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function addStaticRow(key = "", value = "") {
  const row = createElement("div", "row kv");
  const keyInput = createElement("input");
  keyInput.placeholder = "Key";
  keyInput.value = key;
  const valueInput = createElement("input");
  valueInput.placeholder = "Value";
  valueInput.value = value;
  const removeBtn = createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "✕";
  removeBtn.className = "light";
  removeBtn.addEventListener("click", () => { row.remove(); refreshPreview(); });
  [keyInput, valueInput].forEach(input => input.addEventListener("input", refreshPreview));
  row.append(keyInput, valueInput, removeBtn);
  sections.static.appendChild(row);
}

function addCellRow(container, key = "", sheet = "", cell = "") {
  const row = createElement("div", "row cell");
  const keyInput = createElement("input");
  keyInput.placeholder = "Key";
  keyInput.value = key;
  const sheetInput = createElement("input");
  sheetInput.placeholder = "Sheet";
  sheetInput.value = sheet;
  const cellInput = createElement("input");
  cellInput.placeholder = "Cell";
  cellInput.value = cell;
  const removeBtn = createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "✕";
  removeBtn.className = "light";
  removeBtn.addEventListener("click", () => { row.remove(); refreshPreview(); });
  [keyInput, sheetInput, cellInput].forEach(input => input.addEventListener("input", refreshPreview));
  row.append(keyInput, sheetInput, cellInput, removeBtn);
  container.appendChild(row);
}

function addCalcRow(key = "", formula = "", dataType = "") {
  const row = createElement("div", "row calc");
  const keyInput = createElement("input");
  keyInput.placeholder = "Key";
  keyInput.value = key;
  const formulaInput = createElement("input");
  formulaInput.placeholder = "Formula";
  formulaInput.value = formula;
  const typeSelect = document.createElement("select");
  ["", "percentage", "number", "string", "date"].forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt || "Select type";
    if (opt === (dataType || "")) option.selected = true;
    typeSelect.appendChild(option);
  });
  const removeBtn = createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "✕";
  removeBtn.className = "light";
  removeBtn.addEventListener("click", () => { row.remove(); refreshPreview(); });
  [keyInput, formulaInput, typeSelect].forEach((input) => input.addEventListener("input", refreshPreview));
  row.append(keyInput, formulaInput, typeSelect, removeBtn);
  sections.calc.appendChild(row);
}

function clearRows() {
  Object.values(sections).forEach(section => { section.innerHTML = ""; });
}

function setFormConfig(config) {
  document.getElementById("spv").value = config.spv || "";
  document.getElementById("file-pattern").value = config.file_pattern || "";
  document.getElementById("directory").value = config.directory || "";
  dataSourceTypeSelect.value = config.data_source?.type || "filename";
  const dsRegex = config.data_source?.regex || "";
  dataSourceRegexInput.value = dsRegex;
  if ((config.data_source?.type || "filename") === "cell_reference") {
    const [sheet = "", cell = ""] = dsRegex.split(",").map(part => part.trim());
    dataSourceSheetInput.value = sheet;
    dataSourceCellInput.value = cell;
  } else {
    dataSourceSheetInput.value = "";
    dataSourceCellInput.value = "";
  }
  updateDataSourceHelper();
  sampleInput.value = "";
  clearRows();

  const staticValues = config.fields.static_values || {};
  const cellRefs = config.fields.cell_references || {};
  const variables = config.fields.variables || {};
  const calculated = config.fields.calculated_fields || {};

  if (Object.keys(staticValues).length === 0) addStaticRow();
  Object.entries(staticValues).forEach(([key, value]) => addStaticRow(key, value));

  if (Object.keys(cellRefs).length === 0) addCellRow(sections.cell);
  Object.entries(cellRefs).forEach(([key, entry]) => addCellRow(
    sections.cell,
    key,
    entry.sheet || "",
    entry.cell || ""
  ));

  if (Object.keys(variables).length === 0) addCellRow(sections.variable);
  Object.entries(variables).forEach(([key, entry]) => addCellRow(
    sections.variable,
    key,
    entry.sheet || "",
    entry.cell || ""
  ));

  if (Object.keys(calculated).length === 0) addCalcRow();
  Object.entries(calculated).forEach(([key, entry]) => addCalcRow(
    key,
    entry.formula || "",
    entry.data_type || entry.description || ""
  ));

  refreshPreview();
}

function readKeyValueRows(container) {
  const result = {};
  container.querySelectorAll(".row").forEach(row => {
    const [keyInput, valueInput] = row.querySelectorAll("input");
    const key = keyInput.value.trim();
    if (!key) return;
    result[key] = valueInput.value.trim();
  });
  return result;
}

function readCellRows(container) {
  const result = {};
  container.querySelectorAll(".row").forEach(row => {
    const inputs = row.querySelectorAll("input");
    const key = inputs[0].value.trim();
    if (!key) return;
    result[key] = { sheet: inputs[1].value.trim(), cell: inputs[2].value.trim() };
  });
  return result;
}

function readCalcRows() {
  const result = {};
  sections.calc.querySelectorAll(".row").forEach(row => {
    const [keyInput, formulaInput, typeInput] = row.querySelectorAll("input");
    const key = keyInput.value.trim();
    if (!key) return;
    result[key] = {
      formula: formulaInput.value.trim(),
      data_type: typeInput.value.trim()
    };
  });
  return result;
}

function collectConfig() {
  return {
    spv: document.getElementById("spv").value.trim(),
    file_pattern: document.getElementById("file-pattern").value.trim(),
    directory: document.getElementById("directory").value.trim(),
    fields: {
      static_values: readKeyValueRows(sections.static),
      cell_references: readCellRows(sections.cell),
      variables: readCellRows(sections.variable),
      calculated_fields: readCalcRows(),
    },
    data_source: {
      type: dataSourceTypeSelect.value.trim(),
      regex: buildDataSourceValue(),
    },
  };
}


function refreshPreview() {
  const config = collectConfig();
  preview.textContent = JSON.stringify(config, null, 2);
}

async function loadList() {
  listStatus.textContent = "Loading...";
  const res = await fetch("/api/configs");
  const payload = await res.json();
  configSelect.innerHTML = "";
  (payload.configs || []).forEach(entry => {
    const option = document.createElement("option");
    option.value = entry.name;
    option.textContent = `${entry.name} (updated ${entry.updated})`;
    configSelect.appendChild(option);
  });
  listStatus.textContent = `${payload.configs.length} configs`;
}

async function loadCurrentSelection() {
  const name = configSelect.value;
  if (!name) {
    listStatus.textContent = "No config selected.";
    return;
  }
  const res = await fetch(`/api/configs/${encodeURIComponent(name)}`);
  const payload = await res.json();
  if (payload.error) {
    listStatus.textContent = payload.details || payload.error;
    return;
  }
  currentName = payload.name;
  document.getElementById("config-name").value = payload.name;
  setFormConfig(payload.config);
  formStatus.textContent = `Loaded ${payload.name}`;
}

function resetForm() {
  currentName = null;
  document.getElementById("config-name").value = "";
  setFormConfig(emptyConfig());
  formStatus.textContent = "Ready for new config.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nameValue = document.getElementById("config-name").value.trim();
  if (!nameValue) {
    formStatus.textContent = "Config name is required.";
    return;
  }
  const config = collectConfig();
  const isUpdate = currentName && currentName === nameValue;
  const url = isUpdate ? `/api/configs/${encodeURIComponent(nameValue)}` : "/api/configs";
  const method = isUpdate ? "PUT" : "POST";
  const body = isUpdate ? { config } : { name: nameValue, config };

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (payload.error) {
    formStatus.textContent = JSON.stringify(payload.details || payload.error);
    return;
  }
  currentName = payload.name;
  formStatus.textContent = `Saved ${payload.name}`;
  await loadList();
});

document.getElementById("add-static").addEventListener("click", () => { addStaticRow(); refreshPreview(); });
document.getElementById("add-cell").addEventListener("click", () => { addCellRow(sections.cell); refreshPreview(); });
document.getElementById("add-variable").addEventListener("click", () => { addCellRow(sections.variable); refreshPreview(); });
document.getElementById("add-calc").addEventListener("click", () => { addCalcRow(); refreshPreview(); });

document.getElementById("load-config").addEventListener("click", loadCurrentSelection);
document.getElementById("new-config").addEventListener("click", resetForm);

["spv","file-pattern","directory","data-source-type","data-source-regex"].forEach(id => {
  document.getElementById(id).addEventListener("input", refreshPreview);
});
sampleInput.addEventListener("input", refreshPreview);
dataSourceTypeSelect.addEventListener("change", () => {
  updateDataSourceHelper();
  refreshPreview();
});
[dataSourceRegexInput, dataSourceSheetInput, dataSourceCellInput].forEach(input => {
  input.addEventListener("input", refreshPreview);
});

uploadBtn.addEventListener("click", () => uploadInput.click());
uploadInput.addEventListener("change", async () => {
  if (!uploadInput.files?.length) return;
  const file = uploadInput.files[0];
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    currentName = file.name.replace(/\.json$/i, "");
    document.getElementById("config-name").value = currentName;
    setFormConfig(payload);
    formStatus.textContent = `Loaded ${file.name}`;
  } catch (err) {
    formStatus.textContent = `Upload failed: ${err}`;
  } finally {
    uploadInput.value = "";
  }
});

function deriveRegexFromSample(name) {
  const patterns = [
    { regex: /\d{2}\.\d{2}\.\d{4}/, token: "\\\\d{2}\\\\.\\\\d{2}\\\\.\\\\d{4}" },
    { regex: /\d{4}-\d{2}-\d{2}/, token: "\\\\d{4}-\\\\d{2}-\\\\d{2}" },
    { regex: /\d{2}-\d{2}-\d{4}/, token: "\\\\d{2}-\\\\d{2}-\\\\d{4}" },
    { regex: /\d{2}\/\d{2}\/\d{4}/, token: "\\\\d{2}\\\\/\\\\d{2}\\\\/\\\\d{4}" }
  ];
  for (const pattern of patterns) {
    if (pattern.regex.test(name)) {
      const filePattern = name.replace(pattern.regex, pattern.token).replace(/\./g, "\\.");
      return { filePattern, token: pattern.token };
    }
  }
  return null;
}

buildRegexBtn.addEventListener("click", () => {
  const sample = sampleInput.value.trim();
  if (!sample) {
    formStatus.textContent = "Sample filename required.";
    return;
  }
  const derived = deriveRegexFromSample(sample);
  if (!derived) {
    formStatus.textContent = "No recognizable date found in sample.";
    return;
  }
  dataSourceTypeSelect.value = "filename";
  updateDataSourceHelper();
  document.getElementById("file-pattern").value = derived.filePattern;
  document.getElementById("data-source-regex").value = derived.token;
  dataSourceSheetInput.value = "";
  dataSourceCellInput.value = "";
  refreshPreview();
  formStatus.textContent = "Regex generated from sample.";
});

function updateDataSourceHelper() {
  const type = dataSourceTypeSelect.value || "filename";
  if (type === "cell_reference") {
    dataSourceRegexInput.style.display = "none";
    dataSourceSheetInput.style.display = "";
    dataSourceCellInput.style.display = "";
    if (dataSourceValueLabelSpan) {
      dataSourceValueLabelSpan.textContent = "If cell reference: fill the Sheet & Cell inputs (example: \"Cover\" and \"B2\").";
    }
  } else {
    dataSourceRegexInput.style.display = "";
    dataSourceSheetInput.style.display = "none";
    dataSourceCellInput.style.display = "none";
    if (dataSourceValueLabelSpan) {
      dataSourceValueLabelSpan.textContent = "If filename: enter the date regex (example: \"\\\\d{4}-\\\\d{2}-\\\\d{2}\").";
    }
  }
}

function buildDataSourceValue() {
  if (dataSourceTypeSelect.value === "cell_reference") {
    const sheet = dataSourceSheetInput.value.trim();
    const cell = dataSourceCellInput.value.trim();
    return sheet && cell ? `${sheet}, ${cell}` : "";
  }
  return dataSourceRegexInput.value.trim();
}

resetForm();
loadList();
