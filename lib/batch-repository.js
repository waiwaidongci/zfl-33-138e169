import { getCollections } from "./db.js";
import {
  collectAllTileDefects,
  countBySeverity,
  groupByAshSource,
  groupByRecipeVersion,
  groupByScoreRange
} from "./defect-statistics.js";

const VALID_STATUSES = ["planned", "loading", "firing", "cooling", "completed"];

export function ensureBatchCollection(db) {
  const coll = getCollections(db);
  if (!coll.batches) coll.batches = [];
}

export function getBatchIds(db) {
  ensureBatchCollection(db);
  const coll = getCollections(db);
  return new Set(coll.batches.map(b => b.id));
}

export function generateBatchId(db) {
  ensureBatchCollection(db);
  let counter = getCollections(db).batches.length + 1;
  let id;
  const existing = getBatchIds(db);
  do {
    id = `BATCH-${String(counter).padStart(3, "0")}`;
    counter++;
  } while (existing.has(id));
  return id;
}

export function getBatch(db, id) {
  ensureBatchCollection(db);
  const coll = getCollections(db);
  return coll.batches.find(b => b.id === id) || null;
}

export function insertBatch(db, batch) {
  ensureBatchCollection(db);
  const coll = getCollections(db);
  coll.batches.push(batch);
  return batch;
}

export function updateBatch(db, id, updates) {
  ensureBatchCollection(db);
  const coll = getCollections(db);
  const idx = coll.batches.findIndex(b => b.id === id);
  if (idx < 0) return null;
  coll.batches[idx] = { ...coll.batches[idx], ...updates };
  return coll.batches[idx];
}

export function listBatches(db, filters) {
  ensureBatchCollection(db);
  const coll = getCollections(db);
  let rows = coll.batches.slice();
  if (filters.kiln) rows = rows.filter(b => b.kiln === filters.kiln);
  if (filters.status) rows = rows.filter(b => b.status === filters.status);
  if (filters.plannedDate) rows = rows.filter(b => b.plannedDate === filters.plannedDate);
  if (filters.targetAtmosphere) rows = rows.filter(b => b.targetAtmosphere === filters.targetAtmosphere);
  return rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function isValidStatusTransition(current, next) {
  if (!VALID_STATUSES.includes(next)) return false;
  const idx = VALID_STATUSES.indexOf(current);
  const nextIdx = VALID_STATUSES.indexOf(next);
  return nextIdx === idx || nextIdx === idx + 1;
}

export function addTileToBatch(db, batchId, tileId) {
  const batch = getBatch(db, batchId);
  if (!batch) return null;
  if (batch.tileIds.includes(tileId)) return { duplicate: true, batch };
  batch.tileIds.push(tileId);
  batch.updatedAt = new Date().toISOString().slice(0, 10);
  return { duplicate: false, batch };
}

export function removeTileFromBatch(db, batchId, tileId) {
  const batch = getBatch(db, batchId);
  if (!batch) return null;
  const idx = batch.tileIds.indexOf(tileId);
  if (idx < 0) return { notFound: true, batch };
  batch.tileIds.splice(idx, 1);
  batch.updatedAt = new Date().toISOString().slice(0, 10);
  return { notFound: false, batch };
}

export function addBatchObservation(db, batchId, observation) {
  const batch = getBatch(db, batchId);
  if (!batch) return null;
  batch.observations.push(observation);
  batch.updatedAt = new Date().toISOString().slice(0, 10);
  return batch;
}

export function generateBatchSummary(db, batchId) {
  const batch = getBatch(db, batchId);
  if (!batch) return null;
  const coll = getCollections(db);

  const tiles = batch.tileIds
    .map(tid => coll.tiles.find(t => t.id === tid))
    .filter(Boolean);

  const totalTiles = tiles.length;
  const scoredTiles = tiles.filter(t => t.score > 0);
  const avgScore = scoredTiles.length > 0
    ? Number((scoredTiles.reduce((s, t) => s + t.score, 0) / scoredTiles.length).toFixed(1))
    : 0;
  const maxScore = scoredTiles.length > 0 ? Math.max(...scoredTiles.map(t => t.score)) : 0;
  const minScore = scoredTiles.length > 0 ? Math.min(...scoredTiles.map(t => t.score)) : 0;

  const defectSummary = {};
  for (const t of tiles) {
    if (t.defects) {
      for (const d of t.defects.split(/[,，、]/)) {
        const trimmed = d.trim();
        if (trimmed) defectSummary[trimmed] = (defectSummary[trimmed] || 0) + 1;
      }
    }
  }

  const colorSummary = {};
  for (const t of tiles) {
    if (t.color) {
      colorSummary[t.color] = (colorSummary[t.color] || 0) + 1;
    }
  }

  const missingTileIds = batch.tileIds.filter(tid => !coll.tiles.find(t => t.id === tid));

  const allDefects = collectAllTileDefects(tiles);
  const defectBySeverity = countBySeverity(allDefects);
  const byAshSource = groupByAshSource(tiles);
  const byRecipeVersion = groupByRecipeVersion(tiles, db);
  const byScoreRange = groupByScoreRange(tiles);

  return {
    batchId: batch.id,
    batchName: batch.name,
    kiln: batch.kiln,
    plannedDate: batch.plannedDate,
    targetAtmosphere: batch.targetAtmosphere,
    status: batch.status,
    totalTiles,
    scoredTiles: scoredTiles.length,
    avgScore,
    maxScore,
    minScore,
    defectSummary,
    colorSummary,
    missingTileIds,
    observations: batch.observations,
    defectBySeverity,
    groupByAshSource: byAshSource,
    groupByRecipeVersion: byRecipeVersion,
    groupByScoreRange: byScoreRange,
    tiles: tiles.map(t => ({
      id: t.id,
      body: t.body,
      recipe: t.recipe,
      recipeVersionId: t.recipeVersionId || null,
      ashSource: t.ashSource,
      peakTemp: t.peakTemp,
      color: t.color,
      defects: t.defects,
      score: t.score
    }))
  };
}
