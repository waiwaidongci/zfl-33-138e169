import {
  computeTotalStats,
  collectRecentObservations,
  groupByAshSourceWithScores,
  groupDefectsByPeakTemp,
  findLowScoreTiles,
  getPeakTempRanges
} from "./dashboard-utils.js";
import {
  collectAllTileDefects,
  countByDefectName,
  countBySeverity
} from "./defect-statistics.js";

export function buildDashboardOverview(db, options = {}) {
  const tiles = (db && db.tiles) ? db.tiles : [];
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
