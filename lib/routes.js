import { parseContent } from "./parse.js";
import { validateRows } from "./validate.js";
import { loadDb, saveDb, getExistingIds, insertTiles, getPlanIds, insertPlan, updatePlan, deletePlan } from "./db.js";
import { isMultipart, getBoundary, parseMultipart, detectFormatFromFilename, readRawBodyBuffer } from "./multipart.js";
import { normalizeFiringCurve, generateRisks, findSimilarCurves, calcTotalDuration, calcHeatingRates } from "./firing-calc.js";
import { getRecipeVersion, getRecipeVersionByText, insertRecipeVersion, insertRecipe, generateRecipeId, generateRecipeVersionId, parseIngredients, getNextVersionNumber, ensureRecipeCollections } from "./recipe-repository.js";
import { getRecipeVersionReport } from "./reports.js";

const previewCache = new Map();
let cacheCounter = 0;

function enrichTileWithRecipe(tile, db) {
  ensureRecipeCollections(db);
  const result = { ...tile };
  if (tile.recipeVersionId) {
    const version = getRecipeVersion(db, tile.recipeVersionId);
    if (version) {
      result.recipeVersion = {
        id: version.id,
        version: version.version,
        text: version.text,
        ingredients: version.ingredients,
        recipeId: version.recipeId
      };
    }
  }
  return result;
}

async function resolveOrCreateRecipeVersion(db, recipeText, recipeVersionId) {
  ensureRecipeCollections(db);
  if (recipeVersionId) {
    const existing = getRecipeVersion(db, recipeVersionId);
    if (existing) return existing;
  }
  if (!recipeText) return null;

  let version = getRecipeVersionByText(db, recipeText);
  if (version) return version;

  const today = new Date().toISOString().slice(0, 10);
  const recipeId = generateRecipeId(db);
  const recipe = {
    id: recipeId,
    name: `配方-${recipeId}`,
    description: "从试片创建时自动生成",
    createdAt: today,
    updatedAt: today
  };
  insertRecipe(db, recipe);

  const versionId = generateRecipeVersionId(db);
  version = {
    id: versionId,
    recipeId: recipeId,
    version: 1,
    text: recipeText,
    ingredients: parseIngredients(recipeText),
    note: "从试片创建时自动生成初始版本",
    createdAt: today,
    parentVersionId: null
  };
  insertRecipeVersion(db, version);
  return version;
}

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
      "POST /import/commit",
      "POST /firing-plans/calculate",
      "GET /firing-plans",
      "POST /firing-plans",
      "GET /firing-plans/:id",
      "PATCH /firing-plans/:id",
      "DELETE /firing-plans/:id",
      "POST /firing-plans/:id/apply",
      "GET /recipes?includeStats=",
      "POST /recipes",
      "GET /recipes/:id",
      "PATCH /recipes/:id",
      "DELETE /recipes/:id",
      "GET /recipes/:id/versions",
      "POST /recipes/:id/versions",
      "GET /recipes/:id/versions/:versionId",
      "POST /recipes/:id/versions/:versionId/copy",
      "GET /recipes/:id/report",
      "GET /recipes/:id/versions/:versionId/report"
    ]
  };
}

export async function handleListTiles(url, db) {
  let rows = db.tiles;
  const ashSource = url.searchParams.get("ashSource");
  const minTemp = Number(url.searchParams.get("minTemp") || 0);
  const recipeVersionId = url.searchParams.get("recipeVersionId");
  if (ashSource) rows = rows.filter(t => t.ashSource.includes(ashSource));
  if (minTemp) rows = rows.filter(t => Number(t.peakTemp) >= minTemp);
  if (recipeVersionId) rows = rows.filter(t => t.recipeVersionId === recipeVersionId);
  return { status: 200, data: rows.map(t => enrichTileWithRecipe(t, db)) };
}

export async function handleCreateTile(input, db) {
  if (!input.body || !input.recipe) {
    return { status: 400, data: { error: "missing_required", message: "body 和 recipe 为必填字段" } };
  }
  const version = await resolveOrCreateRecipeVersion(db, input.recipe, input.recipeVersionId);
  const tile = {
    id: input.id || `AG-${Date.now()}`,
    body: input.body,
    recipe: input.recipe,
    recipeVersionId: version ? version.id : (input.recipeVersionId || null),
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
  return { status: 201, data: enrichTileWithRecipe(tile, db) };
}

export async function handleGetTile(id, db) {
  const tile = db.tiles.find(t => t.id === id);
  return tile ? { status: 200, data: enrichTileWithRecipe(tile, db) } : { status: 404, data: { error: "tile_not_found" } };
}

export async function handleAddObservation(id, input, db) {
  const tile = db.tiles.find(t => t.id === id);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };
  tile.observations.push({ at: input.at || new Date().toISOString().slice(0, 10), note: input.note });
  if (input.score !== undefined) tile.score = Number(input.score);
  await saveDb(db);
  return { status: 201, data: enrichTileWithRecipe(tile, db) };
}

export async function handleRecipesReport(db) {
  const data = getRecipeVersionReport(db);
  if (data.length > 0) {
    return { status: 200, data };
  }
  const grouped = {};
  for (const tile of db.tiles) {
    grouped[tile.recipe] ||= { recipe: tile.recipe, count: 0, totalScore: 0, ashSources: new Set() };
    grouped[tile.recipe].count += 1;
    grouped[tile.recipe].totalScore += Number(tile.score || 0);
    grouped[tile.recipe].ashSources.add(tile.ashSource);
  }
  const fallbackData = Object.values(grouped).map(g => ({
    recipe: g.recipe,
    count: g.count,
    averageScore: Number((g.totalScore / g.count).toFixed(1)),
    ashSources: [...g.ashSources]
  }));
  return { status: 200, data: fallbackData };
}

export async function handleImportPreview(req) {
  const contentType = req.headers["content-type"] || "";
  try {
    let rawContent = "";
    let hintFormat = null;
    let sourceName = null;

    if (isMultipart(contentType)) {
      const boundary = getBoundary(contentType);
      if (!boundary) throw new Error("multipart boundary 缺失");
      const buf = await readRawBodyBuffer(req);
      const { fields, files } = parseMultipart(buf, boundary);
      const file = files[0];
      if (!file) throw new Error("未找到上传文件，字段名通常为 file");
      rawContent = file.content;
      hintFormat = detectFormatFromFilename(file.filename) || (file.contentType && file.contentType.includes("json") ? "json" : (file.contentType && file.contentType.includes("csv") ? "csv" : null));
      sourceName = file.filename;
      if (fields.duplicateStrategy) { /* reserved */ }
    } else {
      rawContent = await readRawBody(req);
    }

    const parsed = parseContent(rawContent, hintFormat ? (hintFormat === "json" ? "application/json" : "text/csv") : contentType);
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
        source: sourceName ? { type: "file", name: sourceName } : { type: "raw" },
        headers: result.headers,
        counts: result.counts,
        duplicateIds: result.duplicateIds,
        duplicateWithinImport: result.duplicateWithinImport,
        duplicateWithExisting: result.duplicateWithExisting,
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

export async function handleCalcFiringPlan(input, db) {
  const errors = [];
  if (!input.peakTemp || isNaN(Number(input.peakTemp))) {
    errors.push("peakTemp 必须为有效数字");
  }
  if (input.heatingStages !== undefined && !Array.isArray(input.heatingStages)) {
    errors.push("heatingStages 必须为数组");
  }
  if (input.holdMinutes !== undefined && isNaN(Number(input.holdMinutes))) {
    errors.push("holdMinutes 必须为数字");
  }
  if (errors.length > 0) return { status: 400, data: { error: "invalid_input", errors } };

  const peakTemp = Number(input.peakTemp);
  const holdMinutes = Number(input.holdMinutes || 0);
  const kiln = input.kiln || "";
  const heatingStages = Array.isArray(input.heatingStages) ? input.heatingStages : [];

  const calcInput = { peakTemp, holdMinutes, kiln, heatingStages };
  const firingCurve = normalizeFiringCurve(calcInput);
  const risks = generateRisks(calcInput, firingCurve);
  const similarCurves = findSimilarCurves(calcInput, firingCurve, db.tiles);
  const totalMinutes = calcTotalDuration(firingCurve);
  const heatingRates = calcHeatingRates(firingCurve);

  return {
    status: 200,
    data: {
      peakTemp,
      kiln,
      holdMinutes,
      heatingStages,
      firingCurve,
      totalDurationMinutes: totalMinutes,
      totalDurationHours: Number((totalMinutes / 60).toFixed(2)),
      heatingRates,
      risks,
      riskCount: {
        danger: risks.filter(r => r.level === "danger").length,
        warning: risks.filter(r => r.level === "warning").length,
        info: risks.filter(r => r.level === "info").length
      },
      similarCurves
    }
  };
}

export async function handleListPlans(url, db) {
  if (!db.firingPlans) db.firingPlans = [];
  let rows = db.firingPlans;
  const kiln = url.searchParams.get("kiln");
  const status = url.searchParams.get("status");
  if (kiln) rows = rows.filter(p => p.kiln === kiln);
  if (status) rows = rows.filter(p => p.status === status);
  return { status: 200, data: rows };
}

export async function handleCreatePlan(input, db) {
  if (!input.peakTemp || isNaN(Number(input.peakTemp))) {
    return { status: 400, data: { error: "invalid_input", message: "peakTemp 必须为有效数字" } };
  }

  const peakTemp = Number(input.peakTemp);
  const holdMinutes = Number(input.holdMinutes || 0);
  const kiln = input.kiln || "";
  const heatingStages = Array.isArray(input.heatingStages) ? input.heatingStages : [];
  const calcInput = { peakTemp, holdMinutes, kiln, heatingStages };
  const firingCurve = normalizeFiringCurve(calcInput);
  const risks = generateRisks(calcInput, firingCurve);
  const similarCurves = findSimilarCurves(calcInput, firingCurve, db.tiles);
  const totalMinutes = calcTotalDuration(firingCurve);
  const heatingRates = calcHeatingRates(firingCurve);

  const now = new Date().toISOString().slice(0, 10);
  const plan = {
    id: input.id || `FP-${Date.now()}`,
    name: input.name || `烧成规划-${now}`,
    status: "draft",
    kiln,
    peakTemp,
    holdMinutes,
    heatingStages,
    firingCurve,
    totalDurationMinutes: totalMinutes,
    heatingRates,
    risks,
    riskCount: {
      danger: risks.filter(r => r.level === "danger").length,
      warning: risks.filter(r => r.level === "warning").length,
      info: risks.filter(r => r.level === "info").length
    },
    similarCurves,
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now,
    appliedTileId: null
  };

  insertPlan(db, plan);
  await saveDb(db);
  return { status: 201, data: plan };
}

export async function handleGetPlan(id, db) {
  if (!db.firingPlans) db.firingPlans = [];
  const plan = db.firingPlans.find(p => p.id === id);
  return plan ? { status: 200, data: plan } : { status: 404, data: { error: "plan_not_found" } };
}

export async function handleUpdatePlan(id, input, db) {
  if (!db.firingPlans) db.firingPlans = [];
  const existing = db.firingPlans.find(p => p.id === id);
  if (!existing) return { status: 404, data: { error: "plan_not_found" } };

  const updates = { updatedAt: new Date().toISOString().slice(0, 10) };
  if (input.name !== undefined) updates.name = input.name;
  if (input.status !== undefined) updates.status = input.status;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.kiln !== undefined) updates.kiln = input.kiln;
  if (input.peakTemp !== undefined || input.holdMinutes !== undefined || input.heatingStages !== undefined || input.kiln !== undefined) {
    const peakTemp = Number(input.peakTemp ?? existing.peakTemp);
    const holdMinutes = Number(input.holdMinutes ?? existing.holdMinutes);
    const kiln = input.kiln ?? existing.kiln;
    const heatingStages = input.heatingStages ?? existing.heatingStages;
    const calcInput = { peakTemp, holdMinutes, kiln, heatingStages };
    const firingCurve = normalizeFiringCurve(calcInput);
    const risks = generateRisks(calcInput, firingCurve);
    const similarCurves = findSimilarCurves(calcInput, firingCurve, db.tiles);
    updates.peakTemp = peakTemp;
    updates.holdMinutes = holdMinutes;
    updates.heatingStages = heatingStages;
    updates.firingCurve = firingCurve;
    updates.totalDurationMinutes = calcTotalDuration(firingCurve);
    updates.heatingRates = calcHeatingRates(firingCurve);
    updates.risks = risks;
    updates.riskCount = {
      danger: risks.filter(r => r.level === "danger").length,
      warning: risks.filter(r => r.level === "warning").length,
      info: risks.filter(r => r.level === "info").length
    };
    updates.similarCurves = similarCurves;
  }

  const plan = updatePlan(db, id, updates);
  await saveDb(db);
  return { status: 200, data: plan };
}

export async function handleDeletePlan(id, db) {
  const ok = deletePlan(db, id);
  await saveDb(db);
  return ok ? { status: 200, data: { deleted: true, id } } : { status: 404, data: { error: "plan_not_found" } };
}

export async function handleApplyPlan(id, input, db) {
  if (!db.firingPlans) db.firingPlans = [];
  const plan = db.firingPlans.find(p => p.id === id);
  if (!plan) return { status: 404, data: { error: "plan_not_found" } };

  if (!input.body || !input.recipe) {
    return { status: 400, data: { error: "missing_required", message: "创建试片需要 body 和 recipe 字段" } };
  }

  const now = new Date().toISOString().slice(0, 10);
  const version = await resolveOrCreateRecipeVersion(db, input.recipe, input.recipeVersionId);
  const tile = {
    id: input.id || `AG-${Date.now()}`,
    body: input.body,
    recipe: input.recipe,
    recipeVersionId: version ? version.id : (input.recipeVersionId || null),
    ashSource: input.ashSource || "",
    glazeThickness: input.glazeThickness || "",
    kiln: plan.kiln || input.kiln || "",
    firingCurve: plan.firingCurve,
    peakTemp: plan.peakTemp,
    color: input.color || "",
    defects: input.defects || "",
    score: Number(input.score || 0),
    observations: [{
      at: now,
      note: `本试片基于烧成规划 ${plan.id} (${plan.name}) 创建，规划保温 ${plan.holdMinutes} 分钟，风险提示: ${plan.riskCount.danger}D/${plan.riskCount.warning}W/${plan.riskCount.info}I`
    }],
    fromPlanId: plan.id
  };

  db.tiles.push(tile);
  updatePlan(db, id, { status: "applied", appliedTileId: tile.id, updatedAt: now });
  await saveDb(db);
  return { status: 201, data: { tile: enrichTileWithRecipe(tile, db), planId: plan.id } };
}
