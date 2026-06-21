import { parseContent } from "./parse.js";
import { validateRows } from "./validate.js";
import { loadDb, saveDb, getExistingIds, insertTiles, getPlanIds, insertPlan, updatePlan, deletePlan, getCollections } from "./db.js";
import { isMultipart, getBoundary, parseMultipart, detectFormatFromFilename, readRawBodyBuffer } from "./multipart.js";
import { normalizeFiringCurve, generateRisks, findSimilarCurves, calcTotalDuration, calcHeatingRates } from "./firing-calc.js";
import { getRecipeVersion, getRecipeVersionByText, insertRecipeVersion, insertRecipe, generateRecipeId, generateRecipeVersionId, parseIngredients, getNextVersionNumber, ensureRecipeCollections } from "./recipe-repository.js";
import { getRecipeVersionReport } from "./reports.js";
import { validateStockForDeduction, ensureInventoryCollection, findStockByNameAndBatchNo } from "./inventory-repository.js";
import { findSimilarTiles } from "./similarity-search.js";
import { validateDefectTags, tryParseDefectText } from "./defect-validate.js";
import { INITIAL_STATUS, TILE_STATUSES, TILE_STATUS_LABELS, isValidStatus } from "./tile-status-machine.js";
import { createStatusRecord } from "./tile-status-history.js";
import { handleUpdateTileWithStatus, handleTransitionStatus, executeStatusTransition } from "./tile-status-routes.js";
import { validateFieldsForStatus } from "./tile-permission-rules.js";
import { ensureBatchCollection, generateBatchId, getBatch, insertBatch, addTileToBatch } from "./batch-repository.js";

const previewCache = new Map();
let cacheCounter = 0;

export function previewCacheSet(token, rows) {
  previewCache.set(token, rows);
}

export function previewCacheDelete(token) {
  previewCache.delete(token);
}

export function previewCacheGet(token) {
  return previewCache.get(token);
}

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

export async function validateTileBusinessRules(db, input, { autoCreateRecipe = true } = {}) {
  const errors = [];
  const result = {
    valid: true,
    errors,
    recipeVersion: null,
    defectTags: [],
    materialBatchRefs: null,
    batchWeight: null
  };

  if (!input.body || !input.recipe) {
    errors.push("body 和 recipe 为必填字段");
    result.valid = false;
    return result;
  }

  const version = autoCreateRecipe
    ? await resolveOrCreateRecipeVersion(db, input.recipe, input.recipeVersionId)
    : (input.recipeVersionId ? getRecipeVersion(db, input.recipeVersionId) : getRecipeVersionByText(db, input.recipe));
  result.recipeVersion = version;

  const defectValidation = validateDefectTags(input.defectTags);
  if (!defectValidation.valid) {
    errors.push(...defectValidation.errors.map(e => `defectTags校验失败: ${e}`));
  } else {
    let defectTags = defectValidation.normalized;
    const defectsText = input.defects || "";
    if (defectTags.length === 0 && defectsText) {
      defectTags = tryParseDefectText(defectsText);
    }
    result.defectTags = defectTags;
  }

  let materialBatchRefs = input.materialBatchRefs || null;
  let batchWeight = input.batchWeight || null;

  if (materialBatchRefs && batchWeight) {
    ensureInventoryCollection(db);
    const ingredients = version ? version.ingredients : parseIngredients(input.recipe);
    const validation = validateStockForDeduction(db, materialBatchRefs, ingredients, batchWeight);
    if (!validation.valid) {
      errors.push(...validation.errors.map(e => `库存不足: ${e.message}`));
    } else {
      materialBatchRefs = validation.deductions.map(d => ({
        ingredientName: d.ingredientName,
        batchNo: d.batchNo,
        unit: d.unit
      }));
    }
    result.materialBatchRefs = materialBatchRefs;
    result.batchWeight = Number(batchWeight);
  } else if (materialBatchRefs && !batchWeight) {
    errors.push("提供了materialBatchRefs但缺少batchWeight");
  } else if (!materialBatchRefs && batchWeight) {
    errors.push("提供了batchWeight但缺少materialBatchRefs");
  }

  result.valid = errors.length === 0;
  return result;
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
      "GET /tiles?ashSource=&minTemp=&maxTemp=&kiln=&minScore=&maxScore=&hasDefects=&sort=&recipeVersionId=&status=&batchId=",
      "POST /tiles",
      "GET /tiles/:id",
      "PATCH /tiles/:id",
      "POST /tiles/:id/observations",
      "POST /tiles/similar",
      "GET /tiles/:id/defect-tags",
      "PATCH /tiles/:id/defect-tags",
      "POST /tiles/:id/defect-tags",
      "DELETE /tiles/:id/defect-tags",
      "GET /tiles/:id/status",
      "PATCH /tiles/:id/status",
      "GET /tiles/:id/status-history",
      "POST /tiles/batch-status",
      "GET /tile-status/info",
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
      "GET /recipes/:id/versions/:versionId/report",
      "GET /batches?kiln=&status=&plannedDate=&targetAtmosphere=",
      "POST /batches",
      "GET /batches/:id",
      "POST /batches/:id/tiles",
      "DELETE /batches/:id/tiles",
      "PATCH /batches/:id/status",
      "POST /batches/:id/observations",
      "GET /batches/:id/summary",
      "GET /inventory?name=&batchNo=&lowStock=",
      "POST /inventory",
      "GET /inventory/summary",
      "GET /inventory/:id",
      "PATCH /inventory/:id",
      "DELETE /inventory/:id",
      "GET /inventory/batch-no/:batchNo/tiles",
      "GET /inventory/batch-no/:batchNo/summary",
      "GET /defects/catalog",
      "GET /defects/stats/overall",
      "GET /defects/stats/by-kiln?kiln=",
      "GET /defects/stats/by-ash-source?ashSource=",
      "GET /defects/high-frequency?topN=&kiln=&ashSource=",
      "GET /defects/query/tiles?name=&severity=&kiln=&ashSource=",
      "POST /defects/migrate",
      "GET /dashboard/overview?daysBack=&lowScoreThreshold=&lowScoreLimit=&recentObsLimit=&ashSource=&kiln=",
      "GET /dashboard/summary?ashSource=&kiln=",
      "GET /dashboard/recent-observations?daysBack=&limit=&ashSource=&kiln=",
      "GET /dashboard/ash-source-scores?ashSource=&kiln=",
      "GET /dashboard/defects-by-peak-temp?ashSource=&kiln=",
      "GET /dashboard/low-score-tiles?threshold=&limit=&ashSource=&kiln=",
      "GET /dashboard/compare?baselineType=&baselineValue=&targetType=&targetValue=&lowScoreThreshold="
    ]
  };
}

export async function handleListTiles(url, db) {
  const coll = getCollections(db);
  let rows = coll.tiles;
  const ashSource = url.searchParams.get("ashSource");
  const minTemp = Number(url.searchParams.get("minTemp") || 0);
  const maxTemp = Number(url.searchParams.get("maxTemp") || 0);
  const recipeVersionId = url.searchParams.get("recipeVersionId");
  const status = url.searchParams.get("status");
  const batchId = url.searchParams.get("batchId");
  const kiln = url.searchParams.get("kiln");
  const minScore = Number(url.searchParams.get("minScore") || 0);
  const maxScore = Number(url.searchParams.get("maxScore") || 0);
  const hasDefects = url.searchParams.get("hasDefects");
  const sort = url.searchParams.get("sort");
  if (ashSource) rows = rows.filter(t => t.ashSource.includes(ashSource));
  if (minTemp) rows = rows.filter(t => Number(t.peakTemp) >= minTemp);
  if (maxTemp) rows = rows.filter(t => Number(t.peakTemp) <= maxTemp);
  if (recipeVersionId) rows = rows.filter(t => t.recipeVersionId === recipeVersionId);
  if (status) rows = rows.filter(t => t.status === status);
  if (batchId) rows = rows.filter(t => t.batchId === batchId);
  if (kiln) rows = rows.filter(t => t.kiln === kiln);
  if (minScore) rows = rows.filter(t => Number(t.score) >= minScore);
  if (maxScore) rows = rows.filter(t => Number(t.score) <= maxScore);
  if (hasDefects === "true") {
    rows = rows.filter(t => (Array.isArray(t.defectTags) && t.defectTags.length > 0) || (typeof t.defects === "string" && t.defects.trim().length > 0));
  } else if (hasDefects === "false") {
    rows = rows.filter(t => !(Array.isArray(t.defectTags) && t.defectTags.length > 0) && !(typeof t.defects === "string" && t.defects.trim().length > 0));
  }
  if (sort) {
    const desc = sort.startsWith("-");
    const field = desc ? sort.slice(1) : sort;
    const sortable = ["score", "peakTemp", "id"];
    if (sortable.includes(field)) {
      rows = rows.slice().sort((a, b) => {
        const va = field === "id" ? a.id : Number(a[field] || 0);
        const vb = field === "id" ? b.id : Number(b[field] || 0);
        if (va < vb) return desc ? 1 : -1;
        if (va > vb) return desc ? -1 : 1;
        return 0;
      });
    }
  }
  return { status: 200, data: rows.map(t => enrichTileWithRecipe(t, db)) };
}

export async function handleCreateTile(input, db) {
  const coll = getCollections(db);

  const validation = await validateTileBusinessRules(db, input, { autoCreateRecipe: true });

  if (!validation.valid) {
    const hasStockError = validation.errors.some(e => e.includes("库存不足"));
    if (hasStockError) {
      return { status: 409, data: { error: "insufficient_stock", message: "原料库存不足，无法创建试片", details: validation.errors } };
    }
    const hasDefectError = validation.errors.some(e => e.includes("defectTags校验失败"));
    if (hasDefectError) {
      return { status: 400, data: { error: "invalid_defect_tags", errors: validation.errors } };
    }
    return { status: 400, data: { error: "missing_required", message: validation.errors.join("; ") } };
  }

  const defectsText = input.defects || "";

  const tile = {
    id: input.id || `AG-${Date.now()}`,
    body: input.body,
    recipe: input.recipe,
    recipeVersionId: validation.recipeVersion ? validation.recipeVersion.id : (input.recipeVersionId || null),
    ashSource: input.ashSource,
    glazeThickness: input.glazeThickness,
    kiln: input.kiln,
    firingCurve: input.firingCurve || [],
    peakTemp: Number(input.peakTemp || 0),
    color: input.color || "",
    defects: defectsText,
    defectTags: validation.defectTags,
    score: Number(input.score || 0),
    observations: [],
    materialBatchRefs: validation.materialBatchRefs,
    batchWeight: validation.batchWeight,
    status: INITIAL_STATUS,
    statusHistory: [
      createStatusRecord(
        null,
        INITIAL_STATUS,
        "system",
        `创建试片，初始状态为 '${TILE_STATUS_LABELS[INITIAL_STATUS]}'`
      )
    ],
    batchId: null,
    inventoryDeducted: false,
    inventoryReserved: false,
    inventoryConsumed: false,
    reservationIds: []
  };
  coll.tiles.push(tile);
  await saveDb(db);
  return { status: 201, data: enrichTileWithRecipe(tile, db) };
}

export async function handleGetTile(id, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);
  return tile ? { status: 200, data: enrichTileWithRecipe(tile, db) } : { status: 404, data: { error: "tile_not_found" } };
}

export async function handleUpdateTile(id, input, db) {
  return handleUpdateTileWithStatus(id, input, db);
}

export async function handleAddObservation(id, input, db) {
  const coll = getCollections(db);
  const tile = coll.tiles.find(t => t.id === id);
  if (!tile) return { status: 404, data: { error: "tile_not_found" } };

  const fields = ["observations"];
  if (input.score !== undefined) fields.push("score");
  const validation = validateFieldsForStatus(tile.status, fields);
  if (!validation.valid) {
    return {
      status: 400,
      data: {
        error: "fields_not_allowed",
        message: validation.errors.map(e => e.message).join("; "),
        currentStatus: tile.status,
        allowedFields: validation.allowedFields
      }
    };
  }

  tile.observations.push({ at: input.at || new Date().toISOString().slice(0, 10), note: input.note });
  if (input.score !== undefined) tile.score = Number(input.score);
  await saveDb(db);
  return { status: 201, data: enrichTileWithRecipe(tile, db) };
}

export async function handleRecipesReport(db) {
  const coll = getCollections(db);
  const data = getRecipeVersionReport(db);
  if (data.length > 0) {
    return { status: 200, data };
  }
  const grouped = {};
  for (const tile of coll.tiles) {
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

    const businessValidation = buildBusinessValidation(result.importable, db);

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
        parseErrors: parsed.parseErrors,
        errorSummary: result.errorSummary,
        errors: result.errors.slice(0, 20),
        previewToken: token,
        previewRows: result.importable.slice(0, 5),
        businessValidation
      }
    };
  } catch (err) {
    return { status: 400, data: { error: "parse_failed", message: err.message } };
  }
}

function classifyRiskLevel(stockAvailable, stockRequired) {
  if (stockRequired <= 0) return "none";
  const ratio = stockAvailable / stockRequired;
  if (ratio >= 2) return "low";
  if (ratio >= 1) return "medium";
  if (ratio >= 0.5) return "high";
  return "critical";
}

export function buildBusinessValidation(rows, db) {
  ensureRecipeCollections(db);
  ensureInventoryCollection(db);

  const defectTagDetails = [];
  const recipeVersionDetails = [];
  const inventoryRiskDetails = [];

  let defectValidCount = 0;
  let defectInvalidCount = 0;
  let recipeMatchedCount = 0;
  let recipeUnmatchedCount = 0;
  let recipeWillCreateCount = 0;
  let rowsWithRefs = 0;
  let riskFreeCount = 0;
  let atRiskCount = 0;
  let highRiskCount = 0;
  let criticalRiskCount = 0;

  for (const row of rows) {
    const line = row.__line;
    const id = row.id;

    const dtResult = validateDefectTags(row.defectTags);
    if (dtResult.valid) {
      defectValidCount++;
      defectTagDetails.push({
        line, id, valid: true,
        tags: dtResult.normalized.map(t => ({
          name: t.name,
          severity: t.severity,
          severityLabel: t.severity === "mild" ? "轻微" : t.severity === "severe" ? "严重" : "中等"
        }))
      });
    } else {
      defectInvalidCount++;
      defectTagDetails.push({ line, id, valid: false, errors: dtResult.errors });
    }

    let versionMatched = false;
    let willCreate = false;
    let matchInfo = {};
    let resolvedVersion = null;

    if (row.recipeVersionId) {
      const existing = getRecipeVersion(db, row.recipeVersionId);
      if (existing) {
        versionMatched = true;
        recipeMatchedCount++;
        resolvedVersion = existing;
        matchInfo = {
          versionId: existing.id,
          recipeId: existing.recipeId,
          version: existing.version,
          ingredientCount: existing.ingredients ? existing.ingredients.length : 0
        };
      } else {
        recipeUnmatchedCount++;
        matchInfo = { versionId: row.recipeVersionId, reason: "未找到该配方版本" };
      }
    } else if (row.recipe) {
      const byText = getRecipeVersionByText(db, row.recipe);
      if (byText) {
        versionMatched = true;
        recipeMatchedCount++;
        resolvedVersion = byText;
        matchInfo = {
          versionId: byText.id,
          recipeId: byText.recipeId,
          version: byText.version,
          matchedByText: true,
          ingredientCount: byText.ingredients ? byText.ingredients.length : 0
        };
      } else {
        willCreate = true;
        recipeWillCreateCount++;
        const parsedIngredients = parseIngredients(row.recipe);
        matchInfo = {
          willCreate: true,
          recipe: row.recipe,
          parsedIngredientCount: parsedIngredients.length
        };
      }
    } else {
      recipeUnmatchedCount++;
      matchInfo = { reason: "无配方信息" };
    }
    recipeVersionDetails.push({ line, id, matched: versionMatched, willCreate, ...matchInfo });

    if (row.materialBatchRefs && row.batchWeight) {
      rowsWithRefs++;
      const ingredients = resolvedVersion && resolvedVersion.ingredients
        ? resolvedVersion.ingredients
        : parseIngredients(row.recipe);
      const validation = validateStockForDeduction(db, row.materialBatchRefs, ingredients, row.batchWeight);
      if (validation.valid) {
        riskFreeCount++;
        const deductionsWithRisk = validation.deductions.map(d => {
          const stock = findStockByNameAndBatchNo(db, d.ingredientName, d.batchNo);
          const available = stock ? stock.quantity : 0;
          return {
            ingredientName: d.ingredientName,
            batchNo: d.batchNo,
            requiredQuantity: d.requiredQuantity,
            availableQuantity: available,
            unit: d.unit,
            riskLevel: classifyRiskLevel(available, d.requiredQuantity),
            riskLabel: classifyRiskLevel(available, d.requiredQuantity) === "low" ? "充足" :
                      classifyRiskLevel(available, d.requiredQuantity) === "medium" ? "适中" :
                      classifyRiskLevel(available, d.requiredQuantity) === "high" ? "紧张" : "严重不足"
          };
        });
        const maxRisk = deductionsWithRisk.reduce((max, d) => {
          const levels = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
          return levels[d.riskLevel] > levels[max] ? d.riskLevel : max;
        }, "none");
        inventoryRiskDetails.push({
          line, id, hasRisk: false,
          overallRiskLevel: maxRisk,
          overallRiskLabel: maxRisk === "low" ? "充足" : maxRisk === "medium" ? "适中" : maxRisk === "high" ? "紧张" : "严重不足",
          deductions: deductionsWithRisk
        });
      } else {
        atRiskCount++;
        const hasInsufficient = validation.errors.some(e => e.error === "insufficient_stock");
        const hasNotFound = validation.errors.some(e => e.error === "stock_not_found");
        const hasNoRef = validation.errors.some(e => e.error === "no_batch_ref");
        if (hasInsufficient) highRiskCount++;
        if (hasNotFound || hasNoRef) criticalRiskCount++;
        inventoryRiskDetails.push({
          line, id, hasRisk: true,
          riskType: hasNotFound ? "stock_not_found" : hasInsufficient ? "insufficient_stock" : hasNoRef ? "no_batch_ref" : "unknown",
          errors: validation.errors.map(e => e.message)
        });
      }
    } else if (row.materialBatchRefs || row.batchWeight) {
      inventoryRiskDetails.push({
        line, id, hasRisk: true,
        riskType: "incomplete_fields",
        errors: [
          row.materialBatchRefs && !row.batchWeight ? "提供了materialBatchRefs但缺少batchWeight" :
          !row.materialBatchRefs && row.batchWeight ? "提供了batchWeight但缺少materialBatchRefs" :
          "库存扣减字段不完整"
        ]
      });
      atRiskCount++;
    }
  }

  const overallRisk = atRiskCount > 0
    ? (criticalRiskCount > 0 ? "critical" : highRiskCount > 0 ? "high" : "medium")
    : (rowsWithRefs > 0 ? "low" : "none");

  const overallRiskLabel = overallRisk === "critical" ? "有严重风险" :
                          overallRisk === "high" ? "有较高风险" :
                          overallRisk === "medium" ? "有一定风险" :
                          overallRisk === "low" ? "风险较低" : "无风险";

  return {
    summary: {
      totalRows: rows.length,
      rowsWithBusinessValidation: rowsWithRefs,
      overallRisk,
      overallRiskLabel,
      canCommit: defectInvalidCount === 0 && recipeUnmatchedCount === 0 && criticalRiskCount === 0
    },
    defectTagResults: {
      validCount: defectValidCount,
      invalidCount: defectInvalidCount,
      details: defectTagDetails
    },
    recipeVersionMatches: {
      matchedCount: recipeMatchedCount,
      unmatchedCount: recipeUnmatchedCount,
      willCreateCount: recipeWillCreateCount,
      details: recipeVersionDetails
    },
    inventoryRisks: {
      rowsWithRefs,
      riskFreeCount,
      atRiskCount,
      highRiskCount,
      criticalRiskCount,
      details: inventoryRiskDetails
    }
  };
}

export async function handleImportCommit(input, db) {
  const { previewToken, confirm = false, duplicateStrategy = "skip" } = input;
  if (!previewToken) return { status: 400, data: { error: "missing_preview_token" } };
  const rows = previewCache.get(previewToken);
  if (!rows) return { status: 404, data: { error: "preview_token_expired" } };
  if (!confirm) return { status: 400, data: { error: "confirm_required", message: "请设置confirm=true确认导入" } };

  ensureRecipeCollections(db);
  ensureInventoryCollection(db);

  const validated = [];
  const businessErrors = [];
  const stockDeductionMap = new Map();

  for (const row of rows) {
    const tile = { ...row };

    const validation = await validateTileBusinessRules(db, tile, { autoCreateRecipe: true });

    if (!validation.valid) {
      businessErrors.push({ id: tile.id, errors: validation.errors });
      continue;
    }

    tile.recipeVersionId = validation.recipeVersion ? validation.recipeVersion.id : (tile.recipeVersionId || null);
    tile.defectTags = validation.defectTags;
    tile.materialBatchRefs = validation.materialBatchRefs;
    tile.batchWeight = validation.batchWeight;

    if (validation._stockDeductions) {
      stockDeductionMap.set(tile.id, validation._stockDeductions);
    }

    if (!tile.status || !isValidStatus(tile.status)) {
      tile.status = INITIAL_STATUS;
    }
    if (!tile.statusHistory || !Array.isArray(tile.statusHistory) || tile.statusHistory.length === 0) {
      tile.statusHistory = [
        createStatusRecord(
          null,
          tile.status,
          "import",
          `导入试片，初始状态为 '${TILE_STATUS_LABELS[tile.status] || tile.status}'`
        )
      ];
    }
    if (tile.batchId === undefined) {
      tile.batchId = null;
    }
    if (tile.inventoryDeducted === undefined) {
      tile.inventoryDeducted = false;
    }
    if (tile.inventoryReserved === undefined) {
      tile.inventoryReserved = false;
    }
    if (tile.inventoryConsumed === undefined) {
      tile.inventoryConsumed = false;
    }
    if (tile.reservationIds === undefined) {
      tile.reservationIds = [];
    }

    validated.push(tile);
  }

  const coll = getCollections(db);
  let result;
  if (duplicateStrategy === "overwrite") {
    const existing = getExistingIds(db);
    const overwriteIds = validated.filter(r => existing.has(r.id)).map(r => r.id);
    coll.tiles = coll.tiles.filter(t => !overwriteIds.includes(t.id));
    result = insertTiles(db, validated);
    result.overwritten = overwriteIds;
  } else {
    result = insertTiles(db, validated);
  }

  const inserted = result.inserted;
  for (const tile of inserted) {
    const stockDeductions = stockDeductionMap.get(tile.id);
    if (stockDeductions && !tile.inventoryReserved && !tile.inventoryConsumed) {
      tile.inventoryDeducted = false;
    }
  }

  await saveDb(db);
  previewCache.delete(previewToken);

  return {
    status: 200,
    data: {
      insertedCount: inserted.length,
      skippedCount: result.skipped.length,
      overwrittenCount: result.overwritten ? result.overwritten.length : 0,
      businessErrorCount: businessErrors.length,
      insertedIds: inserted.map(t => t.id),
      skippedIds: result.skipped.map(t => t.id),
      overwrittenIds: result.overwritten || [],
      businessErrors
    }
  };
}

export async function handleCalcFiringPlan(input, db) {
  const coll = getCollections(db);
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
  const similarCurves = findSimilarCurves(calcInput, firingCurve, coll.tiles);
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
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  let rows = coll.firingPlans;
  const kiln = url.searchParams.get("kiln");
  const status = url.searchParams.get("status");
  if (kiln) rows = rows.filter(p => p.kiln === kiln);
  if (status) rows = rows.filter(p => p.status === status);
  return { status: 200, data: rows };
}

export async function handleCreatePlan(input, db) {
  const coll = getCollections(db);
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
  const similarCurves = findSimilarCurves(calcInput, firingCurve, coll.tiles);
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
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  const plan = coll.firingPlans.find(p => p.id === id);
  return plan ? { status: 200, data: plan } : { status: 404, data: { error: "plan_not_found" } };
}

export async function handleUpdatePlan(id, input, db) {
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  const existing = coll.firingPlans.find(p => p.id === id);
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
    const similarCurves = findSimilarCurves(calcInput, firingCurve, coll.tiles);
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
  const coll = getCollections(db);
  if (!coll.firingPlans) coll.firingPlans = [];
  const plan = coll.firingPlans.find(p => p.id === id);
  if (!plan) return { status: 404, data: { error: "plan_not_found" } };

  if (plan.status === "applied" && plan.appliedBatchId) {
    return {
      status: 409,
      data: {
        error: "plan_already_applied",
        message: `该烧成规划已应用于批次 ${plan.appliedBatchId}，不可重复应用`,
        appliedBatchId: plan.appliedBatchId
      }
    };
  }

  if (input.applyMode === "batch") {
    return handleApplyPlanAsBatch(id, input, db, plan);
  }

  return handleApplyPlanAsSingleTile(id, input, db, plan);
}

async function handleApplyPlanAsSingleTile(id, input, db, plan) {
  if (!input.body || !input.recipe) {
    return { status: 400, data: { error: "missing_required", message: "创建试片需要 body 和 recipe 字段" } };
  }

  const coll = getCollections(db);

  const defectValidation = validateDefectTags(input.defectTags);
  if (!defectValidation.valid) {
    return { status: 400, data: { error: "invalid_defect_tags", errors: defectValidation.errors } };
  }

  let defectTags = defectValidation.normalized;
  const defectsText = input.defects || "";
  if (defectTags.length === 0 && defectsText) {
    defectTags = tryParseDefectText(defectsText);
  }

  const now = new Date().toISOString().slice(0, 10);
  const version = await resolveOrCreateRecipeVersion(db, input.recipe, input.recipeVersionId);

  let materialBatchRefs = input.materialBatchRefs || null;
  let batchWeight = input.batchWeight || null;

  if (materialBatchRefs && batchWeight) {
    ensureInventoryCollection(db);
    const ingredients = version ? version.ingredients : parseIngredients(input.recipe);
    const validation = validateStockForDeduction(db, materialBatchRefs, ingredients, batchWeight);
    if (!validation.valid) {
      return { status: 409, data: { error: "insufficient_stock", message: "原料库存不足，无法创建试片", details: validation.errors } };
    }
    materialBatchRefs = validation.deductions.map(d => ({
      ingredientName: d.ingredientName,
      batchNo: d.batchNo,
      unit: d.unit
    }));
  }

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
    defects: defectsText,
    defectTags: defectTags,
    score: Number(input.score || 0),
    observations: [{
      at: now,
      note: `本试片基于烧成规划 ${plan.id} (${plan.name}) 创建，规划保温 ${plan.holdMinutes} 分钟，风险提示: ${plan.riskCount.danger}D/${plan.riskCount.warning}W/${plan.riskCount.info}I`
    }],
    fromPlanId: plan.id,
    materialBatchRefs: materialBatchRefs,
    batchWeight: batchWeight,
    status: INITIAL_STATUS,
    statusHistory: [
      createStatusRecord(
        null,
        INITIAL_STATUS,
        "system",
        `基于烧成规划创建试片，初始状态为 '${TILE_STATUS_LABELS[INITIAL_STATUS]}'`
      )
    ],
    batchId: null,
    inventoryDeducted: false,
    inventoryReserved: false,
    inventoryConsumed: false,
    reservationIds: []
  };

  coll.tiles.push(tile);
  updatePlan(db, id, { status: "applied", appliedTileId: tile.id, updatedAt: now });
  await saveDb(db);
  return { status: 201, data: { tile: enrichTileWithRecipe(tile, db), planId: plan.id } };
}

async function handleApplyPlanAsBatch(id, input, db, plan) {
  const { batchName, plannedDate, targetAtmosphere, tiles, operator } = input;

  if (!batchName) {
    return { status: 400, data: { error: "missing_required", message: "batchName 为必填字段" } };
  }
  if (!plannedDate) {
    return { status: 400, data: { error: "missing_required", message: "plannedDate 为必填字段" } };
  }
  if (!targetAtmosphere) {
    return { status: 400, data: { error: "missing_required", message: "targetAtmosphere 为必填字段" } };
  }
  if (!Array.isArray(tiles) || tiles.length === 0) {
    return { status: 400, data: { error: "missing_required", message: "tiles 必须为非空数组" } };
  }

  ensureBatchCollection(db);
  ensureInventoryCollection(db);

  const now = new Date().toISOString().slice(0, 10);
  const coll = getCollections(db);

  const tileResults = [];
  const stockDeductionMap = new Map();
  const createdTileIds = [];
  const errors = [];

  for (let i = 0; i < tiles.length; i++) {
    const tileInput = tiles[i];
    const result = await processBatchTile(tileInput, plan, db, stockDeductionMap, i);
    tileResults.push(result);
    if (result.success) {
      createdTileIds.push(result.tile.id);
      if (result.stockDeductions) {
        stockDeductionMap.set(result.tile.id, result.stockDeductions);
      }
    } else {
      errors.push({ index: i, ...result.error });
    }
  }

  if (errors.length > 0) {
    return {
      status: 400,
      data: {
        error: "tile_validation_failed",
        message: `${errors.length} 个试片验证失败`,
        errors,
        tileResults
      }
    };
  }

  const existingTileSnapshots = new Map();
  const stockSnapshots = new Map();
  let transactionSnapshotLength = 0;
  const originalPlanStatus = plan.status;
  const originalPlanAppliedBatchId = plan.appliedBatchId;
  const originalPlanAppliedTileIds = plan.appliedTileIds;
  const originalPlanUpdatedAt = plan.updatedAt;
  let batchId = null;
  let newTileIds = [];

  try {
    for (const result of tileResults) {
      if (result.success && result.isExisting) {
        existingTileSnapshots.set(result.tile.id, JSON.parse(JSON.stringify(result.tile)));
      }
    }

    const allStockItems = coll.materialStocks || [];
    for (const stock of allStockItems) {
      stockSnapshots.set(stock.batchNo, { quantity: stock.quantity, reservedQuantity: stock.reservedQuantity || 0 });
    }
    transactionSnapshotLength = (coll.inventoryTransactions || []).length;

    const batch = {
      id: generateBatchId(db),
      name: batchName,
      kiln: plan.kiln || "",
      plannedDate,
      targetAtmosphere,
      tileIds: createdTileIds,
      status: "planned",
      observations: [{
        at: now,
        note: `本批次基于烧成规划 ${plan.id} (${plan.name}) 一键生成，规划保温 ${plan.holdMinutes} 分钟，风险提示: ${plan.riskCount.danger}D/${plan.riskCount.warning}W/${plan.riskCount.info}I`
      }],
      createdAt: now,
      updatedAt: now
    };
    batchId = batch.id;
    insertBatch(db, batch);

    for (const result of tileResults) {
      if (result.success) {
        if (result.isExisting && result.tileUpdates) {
          Object.assign(result.tile, result.tileUpdates);
        }
        result.tile.batchId = batch.id;
        if (!result.isExisting) {
          coll.tiles.push(result.tile);
          newTileIds.push(result.tile.id);
        }
      }
    }

    const transitionResults = [];
    const transitionErrors = [];
    for (const result of tileResults) {
      if (result.success) {
        const transResult = await executeStatusTransition(
          result.tile.id,
          {
            targetStatus: TILE_STATUSES.PENDING_FIRING,
            note: `通过烧成规划一键生成批次 ${batch.id}，自动提交待烧成`,
            operator: operator || "system"
          },
          db
        );
        if (transResult.success) {
          transitionResults.push({ id: result.tile.id, ...transResult.response.data });
        } else {
          transitionErrors.push({ id: result.tile.id, ...transResult.response.data });
        }
      }
    }

    if (transitionErrors.length > 0) {
      throw {
        type: "transition_failed",
        transitionResults,
        transitionErrors
      };
    }

    updatePlan(db, id, {
      status: "applied",
      appliedBatchId: batch.id,
      appliedTileIds: createdTileIds,
      updatedAt: now
    });

    await saveDb(db);

    return {
      status: 201,
      data: {
        batch,
        planId: plan.id,
        tiles: tileResults.filter(r => r.success).map(r => enrichTileWithRecipe(r.tile, db)),
        transitions: transitionResults,
        stockDeductions: Array.from(stockDeductionMap.entries()).map(([tileId, deductions]) => ({
          tileId,
          deductions
        }))
      }
    };

  } catch (err) {
    for (const [tileId, snapshot] of existingTileSnapshots) {
      const tile = coll.tiles.find(t => t.id === tileId);
      if (tile) {
        Object.keys(tile).forEach(key => delete tile[key]);
        Object.assign(tile, snapshot);
      }
    }

    for (const [batchNo, snapshot] of stockSnapshots) {
      const stock = coll.materialStocks.find(s => s.batchNo === batchNo);
      if (stock) {
        stock.quantity = snapshot.quantity;
        stock.reservedQuantity = snapshot.reservedQuantity;
      }
    }

    if (coll.inventoryTransactions && coll.inventoryTransactions.length > transactionSnapshotLength) {
      coll.inventoryTransactions.splice(transactionSnapshotLength);
    }

    if (newTileIds.length > 0) {
      coll.tiles = coll.tiles.filter(t => !newTileIds.includes(t.id));
    }

    if (batchId) {
      coll.batches = coll.batches.filter(b => b.id !== batchId);
    }

    plan.status = originalPlanStatus;
    plan.appliedBatchId = originalPlanAppliedBatchId;
    plan.appliedTileIds = originalPlanAppliedTileIds;
    plan.updatedAt = originalPlanUpdatedAt;

    if (err.type === "transition_failed") {
      return {
        status: 409,
        data: {
          error: "status_transition_failed",
          message: `${err.transitionErrors.length} 个试片状态推进失败，所有操作已回滚`,
          transitionResults: err.transitionResults,
          transitionErrors: err.transitionErrors
        }
      };
    }

    return {
      status: 500,
      data: {
        error: "batch_apply_failed",
        message: "批次应用失败，所有操作已回滚",
        details: err.message || String(err)
      }
    };
  }
}

async function processBatchTile(tileInput, plan, db, stockDeductionMap, index) {
  const coll = getCollections(db);

  if (tileInput.tileId) {
    const existingTile = coll.tiles.find(t => t.id === tileInput.tileId);
    if (!existingTile) {
      return {
        success: false,
        error: {
          error: "tile_not_found",
          message: `试片 ${tileInput.tileId} 不存在`
        }
      };
    }
    if (existingTile.status !== TILE_STATUSES.DRAFT) {
      return {
        success: false,
        error: {
          error: "invalid_tile_status",
          message: `试片 ${tileInput.tileId} 状态为 ${existingTile.status}，仅草稿状态可加入批次`,
          currentStatus: existingTile.status
        }
      };
    }
    if (existingTile.batchId) {
      return {
        success: false,
        error: {
          error: "tile_already_in_batch",
          message: `试片 ${tileInput.tileId} 已属于批次 ${existingTile.batchId}`,
          existingBatchId: existingTile.batchId
        }
      };
    }

    const tileUpdates = {
      firingCurve: plan.firingCurve,
      peakTemp: plan.peakTemp,
      kiln: plan.kiln || existingTile.kiln,
      fromPlanId: plan.id
    };

    const existingDeductions = stockDeductionMap.get(existingTile.id);
    if (tileInput.materialBatchRefs && tileInput.batchWeight && !existingDeductions) {
      ensureInventoryCollection(db);
      const version = existingTile.recipeVersionId
        ? getRecipeVersion(db, existingTile.recipeVersionId)
        : await resolveOrCreateRecipeVersion(db, existingTile.recipe, null);
      const ingredients = version ? version.ingredients : parseIngredients(existingTile.recipe);
      const validation = validateStockForDeduction(db, tileInput.materialBatchRefs, ingredients, tileInput.batchWeight);
      if (!validation.valid) {
        return {
          success: false,
          error: {
            error: "insufficient_stock",
            message: `试片 ${existingTile.id} 原料库存不足`,
            details: validation.errors
          }
        };
      }
      tileUpdates.materialBatchRefs = validation.deductions.map(d => ({
        ingredientName: d.ingredientName,
        batchNo: d.batchNo,
        unit: d.unit
      }));
      tileUpdates.batchWeight = Number(tileInput.batchWeight);
      return {
        success: true,
        tile: existingTile,
        tileUpdates,
        isExisting: true,
        stockDeductions: validation.deductions
      };
    }

    return { success: true, tile: existingTile, tileUpdates, isExisting: true };
  }

  if (!tileInput.body || !tileInput.recipe) {
    return {
      success: false,
      error: {
        error: "missing_required",
        message: `第 ${index} 个试片缺少 body 或 recipe 字段`
      }
    };
  }

  const defectValidation = validateDefectTags(tileInput.defectTags);
  if (!defectValidation.valid) {
    return {
      success: false,
      error: {
        error: "invalid_defect_tags",
        message: `第 ${index} 个试片缺陷标签无效`,
        details: defectValidation.errors
      }
    };
  }

  let defectTags = defectValidation.normalized;
  const defectsText = tileInput.defects || "";
  if (defectTags.length === 0 && defectsText) {
    defectTags = tryParseDefectText(defectsText);
  }

  const now = new Date().toISOString().slice(0, 10);
  const version = await resolveOrCreateRecipeVersion(db, tileInput.recipe, tileInput.recipeVersionId);

  let materialBatchRefs = tileInput.materialBatchRefs || null;
  let batchWeight = tileInput.batchWeight || null;
  let stockDeductions = null;

  if (materialBatchRefs && batchWeight) {
    ensureInventoryCollection(db);
    const ingredients = version ? version.ingredients : parseIngredients(tileInput.recipe);
    const validation = validateStockForDeduction(db, materialBatchRefs, ingredients, batchWeight);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          error: "insufficient_stock",
          message: `第 ${index} 个试片原料库存不足`,
          details: validation.errors
        }
      };
    }
    materialBatchRefs = validation.deductions.map(d => ({
      ingredientName: d.ingredientName,
      batchNo: d.batchNo,
      unit: d.unit
    }));
    stockDeductions = validation.deductions;
  }

  const tile = {
    id: tileInput.id || `AG-${Date.now()}-${index}`,
    body: tileInput.body,
    recipe: tileInput.recipe,
    recipeVersionId: version ? version.id : (tileInput.recipeVersionId || null),
    ashSource: tileInput.ashSource || "",
    glazeThickness: tileInput.glazeThickness || "",
    kiln: plan.kiln || tileInput.kiln || "",
    firingCurve: plan.firingCurve,
    peakTemp: plan.peakTemp,
    color: tileInput.color || "",
    defects: defectsText,
    defectTags: defectTags,
    score: Number(tileInput.score || 0),
    observations: [{
      at: now,
      note: `本试片基于烧成规划 ${plan.id} (${plan.name}) 一键生成批次时创建，规划保温 ${plan.holdMinutes} 分钟`
    }],
    fromPlanId: plan.id,
    materialBatchRefs,
    batchWeight,
    status: INITIAL_STATUS,
    statusHistory: [
      createStatusRecord(
        null,
        INITIAL_STATUS,
        "system",
        `基于烧成规划批次创建试片，初始状态为 '${TILE_STATUS_LABELS[INITIAL_STATUS]}'`
      )
    ],
    batchId: null,
    inventoryDeducted: false,
    inventoryReserved: false,
    inventoryConsumed: false,
    reservationIds: []
  };

  return { success: true, tile, stockDeductions };
}

export async function handleSimilarTiles(input, db) {
  const coll = getCollections(db);
  const query = {};

  if (input.body !== undefined && input.body !== null && String(input.body).trim() !== "") {
    query.body = String(input.body).trim();
  }
  if (input.ashSource !== undefined && input.ashSource !== null && String(input.ashSource).trim() !== "") {
    query.ashSource = String(input.ashSource).trim();
  }
  if (input.peakTemp !== undefined && input.peakTemp !== null && !isNaN(Number(input.peakTemp))) {
    const temp = Number(input.peakTemp);
    if (temp > 0) query.peakTemp = temp;
  }
  if (input.recipe !== undefined && input.recipe !== null && String(input.recipe).trim() !== "") {
    query.recipe = String(input.recipe).trim();
  }
  if (input.colorKeywords !== undefined && input.colorKeywords !== null) {
    if (Array.isArray(input.colorKeywords)) {
      const arr = input.colorKeywords.map(k => String(k).trim()).filter(Boolean);
      if (arr.length > 0) query.colorKeywords = arr;
    } else if (String(input.colorKeywords).trim() !== "") {
      query.colorKeywords = String(input.colorKeywords).trim();
    }
  }
  if (input.color !== undefined && input.color !== null && String(input.color).trim() !== "") {
    query.color = String(input.color).trim();
  }
  if (input.defectKeywords !== undefined && input.defectKeywords !== null) {
    if (Array.isArray(input.defectKeywords)) {
      const arr = input.defectKeywords.map(k => String(k).trim()).filter(Boolean);
      if (arr.length > 0) query.defectKeywords = arr;
    } else if (String(input.defectKeywords).trim() !== "") {
      query.defectKeywords = String(input.defectKeywords).trim();
    }
  }
  if (input.defects !== undefined && input.defects !== null && String(input.defects).trim() !== "") {
    query.defects = String(input.defects).trim();
  }
  if (input.score !== undefined && input.score !== null && !isNaN(Number(input.score))) {
    const s = Number(input.score);
    if (s > 0) query.score = s;
  }

  if (Object.keys(query).length === 0) {
    return {
      status: 400,
      data: {
        error: "empty_query",
        message: "至少提供一个查询条件：body, ashSource, peakTemp, recipe, colorKeywords/color, defectKeywords/defects, score"
      }
    };
  }

  const options = {};
  if (input.topN !== undefined && !isNaN(Number(input.topN))) {
    options.topN = Math.max(1, Math.min(50, Number(input.topN)));
  }
  if (input.minScore !== undefined && !isNaN(Number(input.minScore))) {
    options.minScore = Math.max(0, Math.min(100, Number(input.minScore)));
  }

  const result = findSimilarTiles(query, coll.tiles, options);

  const enrichedResults = result.results.map(r => ({
    tile: enrichTileWithRecipe(r.tile, db),
    similarityScore: r.similarityScore,
    reasons: r.reasons,
    fieldMatches: r.fieldMatches,
    details: r.details
  }));

  return {
    status: 200,
    data: {
      query: result.query,
      totalCandidates: coll.tiles.length,
      resultCount: enrichedResults.length,
      weights: result.weights,
      results: enrichedResults
    }
  };
}
