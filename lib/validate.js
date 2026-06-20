const REQUIRED_FIELDS = ["id", "body", "recipe"];
const KNOWN_FIELDS = [
  "id", "body", "recipe", "ashSource", "glazeThickness",
  "kiln", "firingCurve", "peakTemp", "color", "defects",
  "score", "observations"
];
const NUMBER_FIELDS = ["peakTemp", "score"];
const ARRAY_FIELDS = ["firingCurve", "observations"];

export function validateRows(parsed, existingIds) {
  const { headers, rows } = parsed;
  const recognized = headers.filter(h => KNOWN_FIELDS.includes(h));
  const unrecognized = headers.filter(h => !KNOWN_FIELDS.includes(h));
  const missingRequired = REQUIRED_FIELDS.filter(f => !recognized.includes(f));

  const importable = [];
  const errors = [];
  const duplicateWithinImport = [];
  const duplicateWithExisting = [];
  const seenIds = new Set();

  for (const row of rows) {
    const line = row.__line;
    const rowErrors = [];

    for (const f of REQUIRED_FIELDS) {
      const v = row[f];
      if (v === undefined || v === null || v === "") {
        rowErrors.push(`缺失必填字段:${f}`);
      }
    }

    const id = String(row.id ?? "").trim();
    if (id) {
      if (seenIds.has(id)) {
        if (!duplicateWithinImport.includes(id)) duplicateWithinImport.push(id);
        rowErrors.push(`导入数据内重复id:${id}`);
      }
      seenIds.add(id);
      if (existingIds.has(id)) {
        if (!duplicateWithExisting.includes(id)) duplicateWithExisting.push(id);
      }
    }

    for (const f of NUMBER_FIELDS) {
      if (row[f] !== undefined && row[f] !== "" && isNaN(Number(row[f]))) {
        rowErrors.push(`${f}需为数字`);
      }
    }

    for (const f of ARRAY_FIELDS) {
      if (row[f] !== undefined && row[f] !== "" && !Array.isArray(row[f])) {
        rowErrors.push(`${f}需为数组`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ line, id, errors: rowErrors });
    } else {
      importable.push(normalizeRow(row));
    }
  }

  const errorSummary = summarizeErrors(errors);
  const allDuplicateIds = [...new Set([...duplicateWithinImport, ...duplicateWithExisting])];

  return {
    headers: { recognized, unrecognized, missingRequired },
    counts: {
      totalRows: rows.length,
      importableRows: importable.length,
      errorRows: errors.length
    },
    duplicateIds: allDuplicateIds,
    duplicateWithinImport,
    duplicateWithExisting,
    errorSummary,
    errors,
    importable
  };
}

function summarizeErrors(errors) {
  const map = {};
  for (const e of errors) {
    for (const msg of e.errors) {
      map[msg] ||= 0;
      map[msg] += 1;
    }
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => ({ message, count, exampleLines: [] }))
    .slice(0, 10);
}

function normalizeRow(row) {
  return {
    id: String(row.id).trim(),
    body: row.body ?? "",
    recipe: row.recipe ?? "",
    ashSource: row.ashSource ?? "",
    glazeThickness: row.glazeThickness ?? "",
    kiln: row.kiln ?? "",
    firingCurve: Array.isArray(row.firingCurve) ? row.firingCurve : [],
    peakTemp: row.peakTemp !== undefined && row.peakTemp !== "" ? Number(row.peakTemp) : 0,
    color: row.color ?? "",
    defects: row.defects ?? "",
    score: row.score !== undefined && row.score !== "" ? Number(row.score) : 0,
    observations: Array.isArray(row.observations) ? row.observations : []
  };
}
