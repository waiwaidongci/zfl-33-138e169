import {
  getDashboardOverview,
  getDashboardCompare
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

export async function handleGetDashboardCompare(url, db) {
  const baselineType = url.searchParams.get("baselineType");
  const baselineValue = url.searchParams.get("baselineValue");
  const targetType = url.searchParams.get("targetType");
  const targetValue = url.searchParams.get("targetValue");

  const missing = [];
  if (!baselineType) missing.push("baselineType");
  if (!baselineValue) missing.push("baselineValue");
  if (!targetType) missing.push("targetType");
  if (!targetValue) missing.push("targetValue");

  if (missing.length > 0) {
    return {
      status: 400,
      data: {
        error: "missing_required",
        message: `缺少必填参数: ${missing.join(", ")}`,
        required: [
          "baselineType (ashSource|kiln|tempRange)",
          "baselineValue",
          "targetType (ashSource|kiln|tempRange)",
          "targetValue"
        ]
      }
    };
  }

  const validTypes = ["ashSource", "kiln", "tempRange"];
  if (!validTypes.includes(baselineType)) {
    return {
      status: 400,
      data: {
        error: "invalid_baseline_type",
        message: `baselineType 必须是: ${validTypes.join(", ")}`,
        got: baselineType
      }
    };
  }
  if (!validTypes.includes(targetType)) {
    return {
      status: 400,
      data: {
        error: "invalid_target_type",
        message: `targetType 必须是: ${validTypes.join(", ")}`,
        got: targetType
      }
    };
  }

  try {
    const result = getDashboardCompare(db, {
      baseline: { type: baselineType, value: baselineValue },
      target: { type: targetType, value: targetValue },
      lowScoreThreshold: Math.max(0, Math.min(100, safeNum(url.searchParams.get("lowScoreThreshold"), 75)))
    });
    return { status: 200, data: result };
  } catch (err) {
    return {
      status: 400,
      data: { error: "compare_failed", message: err.message }
    };
  }
}
