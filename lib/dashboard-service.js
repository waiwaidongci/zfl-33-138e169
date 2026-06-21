import {
  computeTotalStats,
  collectRecentObservations,
  groupByAshSourceWithScores,
  groupDefectsByPeakTemp,
  findLowScoreTiles,
  getPeakTempRanges,
  classifyPeakTemp
} from "./dashboard-utils.js";
import {
  collectAllTileDefects,
  countByDefectName,
  countBySeverity,
  getHighFrequencyDefects
} from "./defect-statistics.js";
import { getCollections } from "./db.js";

export function buildDashboardOverview(db, options = {}) {
  const coll = getCollections(db);
  const tiles = (coll && coll.tiles) ? coll.tiles : [];
  const daysBack = Math.max(1, Math.min(365, Number(options.daysBack) || 30));
  const lowScoreThreshold = Math.max(0, Math.min(100, Number(options.lowScoreThreshold) || 75));
  const lowScoreLimit = Math.max(1, Math.min(50, Number(options.lowScoreLimit) || 10));
  const recentObsLimit = Math.max(1, Math.min(50, Number(options.recentObsLimit) || 10));
  const ashSource = options.ashSource || null;
  const kiln = options.kiln || null;

  let filteredTiles = tiles;
  if (ashSource) {
    filteredTiles = filteredTiles.filter(t => (t.ashSource || "").includes(ashSource));
  }
  if (kiln) {
    filteredTiles = filteredTiles.filter(t => t.kiln === kiln);
  }

  const totalStats = computeTotalStats(filteredTiles);
  const allDefects = collectAllTileDefects(filteredTiles);
  const topDefects = countByDefectName(allDefects)
    .filter(d => d.count > 0)
    .slice(0, 5);
  const severityCounts = countBySeverity(allDefects);
  const recentObservations = collectRecentObservations(filteredTiles, daysBack, recentObsLimit);
  const ashSourceScores = groupByAshSourceWithScores(filteredTiles);
  const defectsByPeakTemp = groupDefectsByPeakTemp(filteredTiles);
  const lowScoreTiles = findLowScoreTiles(filteredTiles, lowScoreThreshold, lowScoreLimit);
  const peakTempRanges = getPeakTempRanges();

  const topPerformingAshSources = [...ashSourceScores]
    .filter(g => g.averageScore !== null && g.scoredCount >= 2)
    .sort((a, b) => b.averageScore - a.averageScore)
    .slice(0, 3);

  const worstPerformingAshSources = [...ashSourceScores]
    .filter(g => g.averageScore !== null && g.scoredCount >= 2)
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 3);

  const generatedAt = new Date().toISOString();
  const scope = {
    ashSource: ashSource || null,
    kiln: kiln || null,
    daysBack,
    lowScoreThreshold,
    totalCandidates: tiles.length,
    totalInScope: filteredTiles.length
  };

  return {
    generatedAt,
    scope,
    overview: {
      ...totalStats,
      topDefects,
      severityCounts
    },
    recentObservations,
    byAshSource: ashSourceScores,
    byPeakTemp: defectsByPeakTemp,
    peakTempRanges,
    lowScoreTiles,
    highlights: {
      topPerformingAshSources,
      worstPerformingAshSources,
      highDefectTempRanges: defectsByPeakTemp
        .filter(r => r.defectRate >= 30 && r.tileCount >= 2)
        .sort((a, b) => b.defectRate - a.defectRate)
        .slice(0, 3)
    }
  };
}

export function getDashboardOverview(db, options = {}) {
  return buildDashboardOverview(db, options);
}

const VALID_SCOPE_TYPES = new Set(["ashSource", "kiln", "tempRange"]);

function filterTilesByScope(tiles, scope) {
  if (!scope || !scope.type || !VALID_SCOPE_TYPES.has(scope.type)) {
    return [];
  }
  const value = scope.value || "";
  if (!value) return [];
  switch (scope.type) {
    case "ashSource":
      return tiles.filter(t => (t.ashSource || "").includes(value));
    case "kiln":
      return tiles.filter(t => (t.kiln || "") === value);
    case "tempRange": {
      const ranges = getPeakTempRanges();
      const matched = ranges.find(r => r.label === value);
      if (!matched) return [];
      return tiles.filter(t => {
        const temp = Number(t.peakTemp) || 0;
        const max = matched.max !== null ? matched.max : Infinity;
        return temp >= matched.min && temp <= max;
      });
    }
    default:
      return [];
  }
}

function buildScopeSummary(tiles, lowScoreThreshold = 75) {
  const totalStats = computeTotalStats(tiles);
  const allDefects = collectAllTileDefects(tiles);
  const topDefects = getHighFrequencyDefects(tiles, 5);
  const severityCounts = countBySeverity(allDefects);
  const lowScoreTiles = findLowScoreTiles(tiles, lowScoreThreshold, 50);

  return {
    tileCount: totalStats.totalTiles,
    scoredCount: totalStats.scoredCount,
    unscoredCount: totalStats.unscoredCount,
    averageScore: totalStats.averageScore,
    scoreDistribution: totalStats.scoreDistribution,
    tilesWithDefects: totalStats.tilesWithDefects,
    defectRate: totalStats.defectRate,
    totalDefectCount: totalStats.totalDefectCount,
    averageDefectsPerTile: totalStats.averageDefectsPerTile,
    topDefects,
    severityCounts,
    lowScoreTileCount: lowScoreTiles.length,
    lowScoreTiles: lowScoreTiles.map(t => ({
      id: t.id,
      body: t.body,
      recipe: t.recipe,
      ashSource: t.ashSource,
      kiln: t.kiln,
      peakTemp: t.peakTemp,
      score: t.score,
      defectCount: t.defectCount,
      hasSevere: t.hasSevere
    }))
  };
}

function calcNumDelta(target, baseline) {
  if (target === null && baseline === null) return null;
  const t = target === null ? 0 : Number(target);
  const b = baseline === null ? 0 : Number(baseline);
  return Number((t - b).toFixed(1));
}

function calcPctDelta(target, baseline) {
  if (baseline === null || baseline === 0) return null;
  const t = target === null ? 0 : Number(target);
  const b = Number(baseline);
  return Number((((t - b) / b) * 100).toFixed(1));
}

function mergeDefectLists(baselineDefects, targetDefects) {
  const map = new Map();
  for (const d of baselineDefects) {
    map.set(d.name, { name: d.name, baseline: d.count, target: 0 });
  }
  for (const d of targetDefects) {
    if (map.has(d.name)) {
      map.get(d.name).target = d.count;
    } else {
      map.set(d.name, { name: d.name, baseline: 0, target: d.count });
    }
  }
  return Array.from(map.values())
    .map(e => ({
      name: e.name,
      baseline: e.baseline,
      target: e.target,
      delta: e.target - e.baseline,
      deltaPct: e.baseline > 0 ? Number((((e.target - e.baseline) / e.baseline) * 100).toFixed(1)) : null
    }))
    .sort((a, b) => (b.target + b.baseline) - (a.target + a.baseline));
}

function diffLowScoreTiles(baselineTiles, targetTiles) {
  const baselineIds = new Set(baselineTiles.map(t => t.id));
  const targetIds = new Set(targetTiles.map(t => t.id));
  const common = targetTiles.filter(t => baselineIds.has(t.id));
  const onlyInBaseline = baselineTiles.filter(t => !targetIds.has(t.id));
  const onlyInTarget = targetTiles.filter(t => !baselineIds.has(t.id));
  return { common, onlyInBaseline, onlyInTarget };
}

function diffSeverityCounts(baselineSev, targetSev) {
  const bMap = new Map(baselineSev.map(s => [s.key, s.count]));
  const tMap = new Map(targetSev.map(s => [s.key, s.count]));
  const keys = Array.from(new Set([...bMap.keys(), ...tMap.keys()]));
  return keys.map(key => {
    const base = bMap.get(key) || 0;
    const tgt = tMap.get(key) || 0;
    const labelEntry = targetSev.find(s => s.key === key) || baselineSev.find(s => s.key === key);
    return {
      key,
      label: labelEntry ? labelEntry.label : key,
      baseline: base,
      target: tgt,
      delta: tgt - base
    };
  });
}

export function buildCompareAnalysis(db, params = {}) {
  const coll = getCollections(db);
  const allTiles = (coll && coll.tiles) ? coll.tiles : [];
  const { baseline, target, lowScoreThreshold = 75 } = params;

  if (!baseline || !baseline.type || !baseline.value) {
    throw new Error("baseline scope 必须包含 type 和 value");
  }
  if (!target || !target.type || !target.value) {
    throw new Error("target scope 必须包含 type 和 value");
  }
  if (!VALID_SCOPE_TYPES.has(baseline.type)) {
    throw new Error(`baseline.type 必须是: ${Array.from(VALID_SCOPE_TYPES).join(", ")}`);
  }
  if (!VALID_SCOPE_TYPES.has(target.type)) {
    throw new Error(`target.type 必须是: ${Array.from(VALID_SCOPE_TYPES).join(", ")}`);
  }

  const baselineTiles = filterTilesByScope(allTiles, baseline);
  const targetTiles = filterTilesByScope(allTiles, target);

  const baselineSummary = buildScopeSummary(baselineTiles, lowScoreThreshold);
  const targetSummary = buildScopeSummary(targetTiles, lowScoreThreshold);

  const defectDelta = mergeDefectLists(baselineSummary.topDefects, targetSummary.topDefects);
  const lowScoreDiff = diffLowScoreTiles(baselineSummary.lowScoreTiles, targetSummary.lowScoreTiles);
  const severityDelta = diffSeverityCounts(baselineSummary.severityCounts, targetSummary.severityCounts);

  const delta = {
    tileCount: {
      baseline: baselineSummary.tileCount,
      target: targetSummary.tileCount,
      delta: targetSummary.tileCount - baselineSummary.tileCount
    },
    scoredCount: {
      baseline: baselineSummary.scoredCount,
      target: targetSummary.scoredCount,
      delta: targetSummary.scoredCount - baselineSummary.scoredCount
    },
    averageScore: {
      baseline: baselineSummary.averageScore,
      target: targetSummary.averageScore,
      delta: calcNumDelta(targetSummary.averageScore, baselineSummary.averageScore),
      deltaPct: calcPctDelta(targetSummary.averageScore, baselineSummary.averageScore)
    },
    defectRate: {
      baseline: baselineSummary.defectRate,
      target: targetSummary.defectRate,
      delta: calcNumDelta(targetSummary.defectRate, baselineSummary.defectRate),
      deltaPct: calcPctDelta(targetSummary.defectRate, baselineSummary.defectRate)
    },
    tilesWithDefects: {
      baseline: baselineSummary.tilesWithDefects,
      target: targetSummary.tilesWithDefects,
      delta: targetSummary.tilesWithDefects - baselineSummary.tilesWithDefects
    },
    totalDefectCount: {
      baseline: baselineSummary.totalDefectCount,
      target: targetSummary.totalDefectCount,
      delta: targetSummary.totalDefectCount - baselineSummary.totalDefectCount
    },
    lowScoreTileCount: {
      baseline: baselineSummary.lowScoreTileCount,
      target: targetSummary.lowScoreTileCount,
      delta: targetSummary.lowScoreTileCount - baselineSummary.lowScoreTileCount
    },
    severityDelta,
    topDefectsDelta: defectDelta,
    lowScoreTilesDiff: {
      commonCount: lowScoreDiff.common.length,
      onlyInBaselineCount: lowScoreDiff.onlyInBaseline.length,
      onlyInTargetCount: lowScoreDiff.onlyInTarget.length,
      common: lowScoreDiff.common,
      onlyInBaseline: lowScoreDiff.onlyInBaseline,
      onlyInTarget: lowScoreDiff.onlyInTarget
    },
    scoreDistribution: {
      baseline: baselineSummary.scoreDistribution,
      target: targetSummary.scoreDistribution
    }
  };

  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    scope: {
      baseline: { type: baseline.type, value: baseline.value, tileCount: baselineTiles.length },
      target: { type: target.type, value: target.value, tileCount: targetTiles.length },
      lowScoreThreshold
    },
    baseline: baselineSummary,
    target: targetSummary,
    delta
  };
}

export function getDashboardCompare(db, params = {}) {
  return buildCompareAnalysis(db, params);
}
