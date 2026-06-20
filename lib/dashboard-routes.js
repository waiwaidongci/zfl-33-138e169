import {
  getDashboardOverview
} from "./dashboard-service.js";
import {
  getPeakTempRanges,
  computeTotalStats,
  collectRecentObservations,
  groupByAshSourceWithScores,
  groupDefectsByPeakTemp,
  findLowScoreTiles
} from "./dashboard-utils.js";
import { getCollections } from "./db.js";

function safeNum(v, fallback) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export async function handleGetDashboardOverview(url, db) {
  const options = {
    daysBack: safeNum(url.searchParams.get("daysBack"), 30),
    lowScoreThreshold: safeNum(url.searchParams.get("lowScoreThreshold"), 75),
    lowScoreLimit: safeNum(url.searchParams.get("lowScoreLimit"), 10),
    recentObsLimit: safeNum(url.searchParams.get("recentObsLimit"), 10),
    ashSource: url.searchParams.get("ashSource") || null,
    kiln: url.searchParams.get("kiln") || null
  };
  const result = getDashboardOverview(db, options);
  return { status: 200, data: result };
}

export async function handleGetDashboardSummary(url, db) {
  const coll = getCollections(db);
  if (!coll || !coll.tiles) {
    return { status: 200, data: computeTotalStats([]) };
  }
  const ashSource = url.searchParams.get("ashSource");
  const kiln = url.searchParams.get("kiln");
  let tiles = coll.tiles;
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  return { status: 200, data: computeTotalStats(tiles) };
}

export async function handleGetRecentObservations(url, db) {
  const coll = getCollections(db);
  if (!coll || !coll.tiles) {
    return { status: 200, data: [] };
  }
  const daysBack = Math.max(1, Math.min(365, safeNum(url.searchParams.get("daysBack"), 30)));
  const limit = Math.max(1, Math.min(100, safeNum(url.searchParams.get("limit"), 10)));
  const ashSource = url.searchParams.get("ashSource");
  const kiln = url.searchParams.get("kiln");
  let tiles = coll.tiles;
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  return {
    status: 200,
    data: {
      daysBack,
      limit,
      scope: { ashSource: ashSource || null, kiln: kiln || null },
      observations: collectRecentObservations(tiles, daysBack, limit)
    }
  };
}

export async function handleGetAshSourceScores(url, db) {
  const coll = getCollections(db);
  if (!coll || !coll.tiles) {
    return { status: 200, data: [] };
  }
  const ashSource = url.searchParams.get("ashSource");
  const kiln = url.searchParams.get("kiln");
  let tiles = coll.tiles;
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  return { status: 200, data: groupByAshSourceWithScores(tiles) };
}

export async function handleGetDefectsByPeakTemp(url, db) {
  const coll = getCollections(db);
  if (!coll || !coll.tiles) {
    return { status: 200, data: { ranges: getPeakTempRanges(), buckets: [] } };
  }
  const ashSource = url.searchParams.get("ashSource");
  const kiln = url.searchParams.get("kiln");
  let tiles = coll.tiles;
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  return {
    status: 200,
    data: {
      ranges: getPeakTempRanges(),
      buckets: groupDefectsByPeakTemp(tiles)
    }
  };
}

export async function handleGetLowScoreTiles(url, db) {
  const coll = getCollections(db);
  if (!coll || !coll.tiles) {
    return { status: 200, data: { threshold: 75, tiles: [] } };
  }
  const threshold = Math.max(0, Math.min(100, safeNum(url.searchParams.get("threshold"), 75)));
  const limit = Math.max(1, Math.min(50, safeNum(url.searchParams.get("limit"), 10)));
  const ashSource = url.searchParams.get("ashSource");
  const kiln = url.searchParams.get("kiln");
  let tiles = coll.tiles;
  if (ashSource) tiles = tiles.filter(t => (t.ashSource || "").includes(ashSource));
  if (kiln) tiles = tiles.filter(t => t.kiln === kiln);
  const results = findLowScoreTiles(tiles, threshold, limit);
  return {
    status: 200,
    data: {
      threshold,
      limit,
      scope: { ashSource: ashSource || null, kiln: kiln || null },
      count: results.length,
      tiles: results
    }
  };
}
