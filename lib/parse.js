const ARRAY_FIELDS = ["firingCurve", "observations", "defectTags", "materialBatchRefs"];
const NUMBER_FIELDS = ["peakTemp", "score", "batchWeight"];

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  const parseErrors = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      const field = h.trim();
      const rawValue = values[idx] ?? "";
      try {
        row[field] = parseValueForField(rawValue, field);
      } catch (e) {
        parseErrors.push({
          line: i + 1,
          field,
          value: rawValue,
          error: e.message
        });
        row[field] = rawValue;
      }
    });
    rows.push({ __line: i + 1, ...row });
  }
  return {
    headers: headers.map(h => h.trim()),
    rows,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined
  };
}

function splitCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseValueForField(val, field) {
  const s = val.trim();
  if (s === "") return "";

  if (ARRAY_FIELDS.includes(field)) {
    return parseArrayField(s, field);
  }

  if (NUMBER_FIELDS.includes(field)) {
    const num = Number(s);
    if (isNaN(num)) {
      throw new Error(`字段 '${field}' 必须为数字，当前值: '${s}'`);
    }
    return num;
  }

  return parseValue(s);
}

function parseArrayField(s, field) {
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed)) {
        throw new Error(`字段 '${field}' 必须为数组`);
      }
      return parsed;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`字段 '${field}' JSON 解析失败: ${e.message}`);
      }
      throw e;
    }
  }

  if (field === "defectTags" && s && !s.startsWith("[")) {
    return parseDefectTagsFromString(s);
  }

  if (field === "materialBatchRefs" && s && !s.startsWith("[")) {
    return parseMaterialBatchRefsFromString(s);
  }

  if (s && !s.startsWith("[") && !s.startsWith("{")) {
    return s.split(/[,，;；]/).map(item => item.trim()).filter(item => item !== "");
  }

  return parseValue(s);
}

function parseDefectTagsFromString(s) {
  const items = s.split(/[,，;；]/).map(item => item.trim()).filter(item => item !== "");
  return items.map(item => {
    const parts = item.split(/[:：]/).map(p => p.trim());
    const name = parts[0];
    const severity = parts[1] || "medium";
    return { name, severity };
  });
}

function parseMaterialBatchRefsFromString(s) {
  const items = s.split(/[,，;；]/).map(item => item.trim()).filter(item => item !== "");
  return items.map(item => {
    const parts = item.split(/[:：]/).map(p => p.trim());
    if (parts.length >= 2) {
      return { ingredientName: parts[0], batchNo: parts[1] };
    }
    return { ingredientName: parts[0], batchNo: "" };
  });
}

function parseValue(s) {
  if (s === "") return "";
  try {
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      return JSON.parse(s);
    }
  } catch (_) {}
  if (!isNaN(Number(s)) && s !== "") return Number(s);
  return s;
}

export function parseJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON root must be an array of records");

  const parseErrors = [];
  const rows = data.map((r, i) => {
    const normalized = { __line: i + 1 };
    Object.keys(r).forEach(field => {
      const rawValue = r[field];
      try {
        if (typeof rawValue === "string") {
          normalized[field] = parseValueForField(rawValue, field);
        } else {
          if (ARRAY_FIELDS.includes(field) && !Array.isArray(rawValue) && rawValue !== null && rawValue !== undefined) {
            throw new Error(`字段 '${field}' 必须为数组`);
          }
          if (NUMBER_FIELDS.includes(field) && rawValue !== null && rawValue !== undefined && rawValue !== "") {
            const num = Number(rawValue);
            if (isNaN(num)) {
              throw new Error(`字段 '${field}' 必须为数字`);
            }
            normalized[field] = num;
          } else {
            normalized[field] = rawValue;
          }
        }
      } catch (e) {
        parseErrors.push({
          line: i + 1,
          field,
          value: rawValue,
          error: e.message
        });
        normalized[field] = rawValue;
      }
    });
    return normalized;
  });

  return {
    headers: Array.from(data.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())),
    rows,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined
  };
}

export function detectFormat(content, contentType) {
  if (contentType) {
    if (contentType.includes("json")) return "json";
    if (contentType.includes("csv")) return "csv";
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "csv";
}

export function parseContent(content, contentType) {
  const fmt = detectFormat(content, contentType);
  if (fmt === "json") return { format: "json", ...parseJSON(content) };
  return { format: "csv", ...parseCSV(content) };
}
