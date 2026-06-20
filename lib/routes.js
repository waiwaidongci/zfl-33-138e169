import { parseContent } from "./parse.js";
import { validateRows } from "./validate.js";
import { loadDb, saveDb, getExistingIds, insertTiles } from "./db.js";

const previewCache = new Map();
let cacheCounter = 0;

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonBody(req) {
  const text = await readRawBody(req);
  return text ? JSON.parse(text) : {};
}

export function routesInfo() {
  return {
    service: "香灰釉试片实验室API",
    endpoints: [
      "GET /tiles?ashSource=&minTemp=",
      "POST /tiles",
      "GET /tiles/:id",
      "POST /tiles/:id/observations",
      "GET /reports/recipes",
      "POST /import/preview",
      "POST /import/commit"
    ]
  };
}

export async function handleListTiles(url, db) {
  let rows = db.tiles;
  const ashSource = url.searchParams.get("ashSource");
  const minTemp = Number(url.searchParams.get("minTemp") || 0);
  if (ashSource) rows = rows.filter(t => t.ashSource.includes(ashSource));
  if (minTemp) rows = rows.filter(t => Number(t.peakTemp) >= minTemp);
  return { status: 200, data: rows };
}

export async function handleCreateTile(input, db) {
  const tile = {
    id: input.id || `AG-${Date.now()}`,
    body: input.body,
    recipe: input.recipe,
    ashSource: input.ashSource,
    glazeThickness: input.glazeThickness,
    kiln: input.kiln,
    firingCurve: input.firingCurve || [],
    peakTemp: Number(input.peakTemp || 0),
    color: input.color || "",
    defects: input.defects || "",
    score: Number(input.score || 0),
    observations: []
  };
  db.tiles.push(tile);
  await saveDb(db);
  return { status: 201, data: tile };
}

export async function handleGetTile(id, db) {
  const tile = db.tiles.find(t => t.id === id);
  return tile ? { status: 200, data: tile } : { status: 404, data: { error: "tile_not_found" } };
}

export async function handleAddObservation(id, input, db) {
  const tile = db.tiles.find(t => t.id === id);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };
  tile.observations.push({ at: input.at || new Date().toISOString().slice(0, 10), note: input.note });
  if (input.score !== undefined) tile.score = Number(input.score);
  await saveDb(db);
  return { status: 201, data: tile };
}

export async function handleRecipesReport(db) {
  const grouped = {};
  for (const tile of db.tiles) {
    grouped[tile.recipe] ||= { recipe: tile.recipe, count: 0, totalScore: 0, ashSources: new Set() };
    grouped[tile.recipe].count += 1;
    grouped[tile.recipe].totalScore += Number(tile.score || 0);
    grouped[tile.recipe].ashSources.add(tile.ashSource);
  }
  const data = Object.values(grouped).map(g => ({
    recipe: g.recipe,
    count: g.count,
    averageScore: Number((g.totalScore / g.count).toFixed(1)),
    ashSources: [...g.ashSources]
  }));
  return { status: 200, data };
}

export async function handleImportPreview(req) {
  const raw = await readRawBody(req);
  const contentType = req.headers["content-type"] || "";
  try {
    const parsed = parseContent(raw, contentType);
    const db = await loadDb();
    const existingIds = getExistingIds(db);
    const result = validateRows(parsed, existingIds);

    const token = `prev_${++cacheCounter}_${Date.now()}`;
    previewCache.set(token, result.importable);
    setTimeout(() => previewCache.delete(token), 10 * 60 * 1000);

    return {
      status: 200,
      data: {
        format: parsed.format,
        headers: result.headers,
        counts: result.counts,
        duplicateIds: result.duplicateIds,
        errorSummary: result.errorSummary,
        errors: result.errors.slice(0, 20),
        previewToken: token,
        previewRows: result.importable.slice(0, 5)
      }
    };
  } catch (err) {
    return { status: 400, data: { error: "parse_failed", message: err.message } };
  }
}

export async function handleImportCommit(input) {
  const { previewToken, confirm = false, duplicateStrategy = "skip" } = input;
  if (!previewToken) return { status: 400, data: { error: "missing_preview_token" } };
  const rows = previewCache.get(previewToken);
  if (!rows) return { status: 404, data: { error: "preview_token_expired" } };
  if (!confirm) return { status: 400, data: { error: "confirm_required", message: "请设置confirm=true确认导入" } };

  const db = await loadDb();
  let result;
  if (duplicateStrategy === "overwrite") {
    const existing = getExistingIds(db);
    const overwriteIds = rows.filter(r => existing.has(r.id)).map(r => r.id);
    db.tiles = db.tiles.filter(t => !overwriteIds.includes(t.id));
    result = insertTiles(db, rows);
    result.overwritten = overwriteIds;
  } else {
    result = insertTiles(db, rows);
  }
  await saveDb(db);
  previewCache.delete(previewToken);

  return {
    status: 200,
    data: {
      insertedCount: result.inserted.length,
      skippedCount: result.skipped.length,
      overwrittenCount: result.overwritten ? result.overwritten.length : 0,
      insertedIds: result.inserted.map(t => t.id),
      skippedIds: result.skipped.map(t => t.id),
      overwrittenIds: result.overwritten || []
    }
  };
}
