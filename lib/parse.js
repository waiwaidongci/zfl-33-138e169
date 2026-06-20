export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = parseValue(values[idx] ?? ""); });
    rows.push({ __line: i + 1, ...row });
  }
  return { headers: headers.map(h => h.trim()), rows };
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

function parseValue(val) {
  const s = val.trim();
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
  return {
    headers: Array.from(data.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())),
    rows: data.map((r, i) => ({ __line: i + 1, ...r }))
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
