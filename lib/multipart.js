export function isMultipart(contentType) {
  return contentType && contentType.includes("multipart/form-data");
}

export function getBoundary(contentType) {
  const match = contentType.match(/boundary=([^;]+)/);
  return match ? match[1].trim().replace(/^"|"$/g, "") : null;
}

export function parseMultipart(body, boundary) {
  const buffer = typeof body === "string" ? Buffer.from(body, "binary") : body;
  const delim = Buffer.from(`--${boundary}`);
  const endDelim = Buffer.from(`--${boundary}--`);

  const parts = [];
  let idx = buffer.indexOf(delim);
  if (idx < 0) return { fields: {}, files: {} };

  while (idx >= 0) {
    const nextIdx = buffer.indexOf(delim, idx + delim.length);
    if (nextIdx < 0) break;
    const chunk = buffer.slice(idx + delim.length, nextIdx);
    const isEnd = chunk.slice(0, 2).toString() === "--";
    if (!isEnd) {
      const part = parsePart(chunk);
      if (part) parts.push(part);
    }
    idx = nextIdx;
    if (buffer.slice(idx, idx + endDelim.length).equals(endDelim)) break;
  }

  const fields = {};
  const files = [];
  for (const p of parts) {
    if (p.filename !== null) files.push(p);
    else fields[p.name] = p.content;
  }
  return { fields, files };
}

function parsePart(chunk) {
  const headerEnd = chunk.indexOf(Buffer.from("\r\n\r\n"));
  if (headerEnd < 0) return null;
  const headerBuf = chunk.slice(0, headerEnd);
  const body = chunk.slice(headerEnd + 4);
  const headers = headerBuf.toString("utf8").split(/\r\n/).filter(Boolean);

  let name = null;
  let filename = null;
  let contentType = "application/octet-stream";
  for (const h of headers) {
    const lower = h.toLowerCase();
    if (lower.startsWith("content-disposition:")) {
      const n = h.match(/name="([^"]+)"/);
      if (n) name = n[1];
      const f = h.match(/filename="([^"]+)"/);
      if (f) filename = f[1];
    } else if (lower.startsWith("content-type:")) {
      contentType = h.split(":", 2)[1].trim();
    }
  }

  const content = filename !== null
    ? stripTrailingCrlf(body).toString("utf8")
    : stripTrailingCrlf(body).toString("utf8");

  return { name, filename, contentType, content };
}

function stripTrailingCrlf(buf) {
  let end = buf.length;
  if (end >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
  return buf.slice(0, end);
}

export function detectFormatFromFilename(filename) {
  if (!filename) return null;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

export async function readRawBodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
