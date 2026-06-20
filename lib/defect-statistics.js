import { DEFECT_CATALOG, SEVERITY_LABELS } from "./defect-validate.js";
import { getCollections } from "./db.js";
import { getRecipeVersion } from "./recipe-repository.js";

function ensureTileDefectTags(tile) {
  if (!tile.defectTags) {
    return [];
  }
  return tile.defectTags;
}

export function collectAllTileDefects(tiles) {
  const allDefects = [];
  for (const tile of tiles) {
    const tags = ensureTileDefectTags(tile);
    for (const tag of tags) {
      allDefects.push({
        tileId: tile.id,
        kiln: tile.kiln || "",
        ashSource: tile.ashSource || "",
        recipeVersionId: tile.recipeVersionId || null,
        recipe: tile.recipe || "",
        name: tag.name,
        severity: tag.severity || "medium",
        note: tag.note || ""
      });
    }
  }
  return allDefects;
}

export function countByDefectName(defects) {
  const counts = {};
  for (const d of DEFECT_CATALOG) {
    counts[d.name] = 0;
  }
  for (const d of defects) {
    if (counts[d.name] !== undefined) {
      counts[d.name]++;
    } else {
      counts[d.name] = 1;
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function countBySeverity(defects) {
  const counts = { mild: 0, medium: 0, severe: 0 };
  for (const d of defects) {
    const s = d.severity || "medium";
    if (counts[s] !== undefined) {
      counts[s]++;
    } else {
      counts.medium++;
    }
  }
  return Object.entries(counts).map(([key, count]) => ({
    key,
    label: SEVERITY_LABELS[key] || key,
    count
  }));
}

export function groupByKiln(tiles) {
  const groups = {};
  for (const tile of tiles) {
    const kiln = tile.kiln || "未指定";
    if (!groups[kiln]) {
      groups[kiln] = { kiln, tileCount: 0, tilesWithDefects: 0, defects: [], defectCounts: {}, severityCounts: { mild: 0, medium: 0, severe: 0 } };
    }
    groups[kiln].tileCount++;
    const tags = ensureTileDefectTags(tile);
    if (tags.length > 0) {
      groups[kiln].tilesWithDefects++;
    }
    for (const tag of tags) {
      groups[kiln].defects.push({ tileId: tile.id, name: tag.name, severity: tag.severity, note: tag.note });
      groups[kiln].defectCounts[tag.name] = (groups[kiln].defectCounts[tag.name] || 0) + 1;
      const s = tag.severity || "medium";
      if (groups[kiln].severityCounts[s] !== undefined) {
        groups[kiln].severityCounts[s]++;
      }
    }
  }

  return Object.values(groups).map(g => ({
    kiln: g.kiln,
    tileCount: g.tileCount,
    tilesWithDefects: g.tilesWithDefects,
    defectRate: g.tileCount > 0 ? Number(((g.tilesWithDefects / g.tileCount) * 100).toFixed(1)) : 0,
    defectCounts: Object.entries(g.defectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    severityCounts: Object.entries(g.severityCounts).map(([key, count]) => ({
      key,
      label: SEVERITY_LABELS[key] || key,
      count
    }))
  })).sort((a, b) => b.tileCount - a.tileCount);
}

export function groupByAshSource(tiles) {
  const groups = {};
  for (const tile of tiles) {
    const source = tile.ashSource || "未指定";
    if (!groups[source]) {
      groups[source] = { ashSource: source, tileCount: 0, tilesWithDefects: 0, defects: [], defectCounts: {}, severityCounts: { mild: 0, medium: 0, severe: 0 } };
    }
    groups[source].tileCount++;
    const tags = ensureTileDefectTags(tile);
    if (tags.length > 0) {
      groups[source].tilesWithDefects++;
    }
    for (const tag of tags) {
      groups[source].defects.push({ tileId: tile.id, name: tag.name, severity: tag.severity, note: tag.note });
      groups[source].defectCounts[tag.name] = (groups[source].defectCounts[tag.name] || 0) + 1;
      const s = tag.severity || "medium";
      if (groups[source].severityCounts[s] !== undefined) {
        groups[source].severityCounts[s]++;
      }
    }
  }

  return Object.values(groups).map(g => ({
    ashSource: g.ashSource,
    tileCount: g.tileCount,
    tilesWithDefects: g.tilesWithDefects,
    defectRate: g.tileCount > 0 ? Number(((g.tilesWithDefects / g.tileCount) * 100).toFixed(1)) : 0,
    defectCounts: Object.entries(g.defectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    severityCounts: Object.entries(g.severityCounts).map(([key, count]) => ({
      key,
      label: SEVERITY_LABELS[key] || key,
      count
    }))
  })).sort((a, b) => b.tileCount - a.tileCount);
}

export function getOverallStats(db) {
  const coll = getCollections(db);
  if (!db || !coll.tiles) {
    return {
      totalTiles: 0,
      tilesWithDefects: 0,
      defectRate: 0,
      defectCounts: [],
      severityCounts: [],
      byKiln: [],
      byAshSource: []
    };
  }

  const tiles = coll.tiles;
  const allDefects = collectAllTileDefects(tiles);
  const tilesWithDefects = tiles.filter(t => ensureTileDefectTags(t).length > 0).length;

  return {
    totalTiles: tiles.length,
    tilesWithDefects,
    defectRate: tiles.length > 0 ? Number(((tilesWithDefects / tiles.length) * 100).toFixed(1)) : 0,
    defectCounts: countByDefectName(allDefects).filter(d => d.count > 0),
    severityCounts: countBySeverity(allDefects),
    byKiln: groupByKiln(tiles),
    byAshSource: groupByAshSource(tiles)
  };
}

export function getHighFrequencyDefects(tiles, topN = 5) {
  if (!tiles || tiles.length === 0) return [];
  const allDefects = collectAllTileDefects(tiles);
  return countByDefectName(allDefects)
    .filter(d => d.count > 0)
    .slice(0, topN);
}

export function getDefectSummaryForTiles(tiles) {
  if (!tiles || tiles.length === 0) {
    return {
      totalTiles: 0,
      tilesWithDefects: 0,
      defectRate: 0,
      topDefects: []
    };
  }
  const allDefects = collectAllTileDefects(tiles);
  const tilesWithDefects = tiles.filter(t => ensureTileDefectTags(t).length > 0).length;
  const defectCounts = countByDefectName(allDefects).filter(d => d.count > 0);
  const severeCount = allDefects.filter(d => d.severity === "severe").length;

  return {
    totalTiles: tiles.length,
    tilesWithDefects,
    defectRate: tiles.length > 0 ? Number(((tilesWithDefects / tiles.length) * 100).toFixed(1)) : 0,
    topDefects: defectCounts.slice(0, 5),
    severeDefectCount: severeCount,
    totalDefectTags: allDefects.length
  };
}

export function groupByRecipeVersion(tiles, db) {
  const groups = {};
  for (const tile of tiles) {
    const versionId = tile.recipeVersionId || null;
    let versionInfo = { id: null, version: null, text: tile.recipe || "" };
    if (versionId && db) {
      const v = getRecipeVersion(db, versionId);
      if (v) {
        versionInfo = { id: v.id, version: v.version, text: v.text || tile.recipe || "" };
      } else {
        versionInfo = { id: versionId, version: null, text: tile.recipe || "" };
      }
    }
    const key = versionId || "__unassigned__";
    const label = versionInfo.id
      ? `${versionInfo.text || ""}${versionInfo.version ? ` (v${versionInfo.version})` : ""}`.trim()
      : "未绑定配方版本";
    if (!groups[key]) {
      groups[key] = {
        recipeVersionId: versionInfo.id,
        recipeVersion: versionInfo.version,
        recipeText: versionInfo.text,
        label,
        tileCount: 0,
        scoredTiles: 0,
        avgScore: 0,
        maxScore: 0,
        minScore: 0,
        tilesWithDefects: 0,
        defectCounts: {},
        severityCounts: { mild: 0, medium: 0, severe: 0 }
      };
    }
    groups[key].tileCount++;
    if (tile.score > 0) {
      groups[key].scoredTiles++;
      groups[key].avgScore += tile.score;
      groups[key].maxScore = Math.max(groups[key].maxScore, tile.score);
      groups[key].minScore = groups[key].minScore === 0 ? tile.score : Math.min(groups[key].minScore, tile.score);
    }
    const tags = ensureTileDefectTags(tile);
    if (tags.length > 0) {
      groups[key].tilesWithDefects++;
    }
    for (const tag of tags) {
      groups[key].defectCounts[tag.name] = (groups[key].defectCounts[tag.name] || 0) + 1;
      const s = tag.severity || "medium";
      if (groups[key].severityCounts[s] !== undefined) {
        groups[key].severityCounts[s]++;
      }
    }
  }

  return Object.values(groups).map(g => ({
    recipeVersionId: g.recipeVersionId,
    recipeVersion: g.recipeVersion,
    recipeText: g.recipeText,
    label: g.label,
    tileCount: g.tileCount,
    scoredTiles: g.scoredTiles,
    avgScore: g.scoredTiles > 0 ? Number((g.avgScore / g.scoredTiles).toFixed(1)) : 0,
    maxScore: g.maxScore,
    minScore: g.minScore,
    tilesWithDefects: g.tilesWithDefects,
    defectRate: g.tileCount > 0 ? Number(((g.tilesWithDefects / g.tileCount) * 100).toFixed(1)) : 0,
    defectCounts: Object.entries(g.defectCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    severityCounts: Object.entries(g.severityCounts).map(([key, count]) => ({
      key,
      label: SEVERITY_LABELS[key] || key,
      count
    }))
  })).sort((a, b) => b.tileCount - a.tileCount);
}

const SCORE_RANGES = [
  { key: "unscored", label: "未评分", min: null, max: 0 },
  { key: "fail", label: "<60 分", min: 1, max: 59 },
  { key: "pass", label: "60-69 分", min: 60, max: 69 },
  { key: "good", label: "70-79 分", min: 70, max: 79 },
  { key: "excellent", label: "80-89 分", min: 80, max: 89 },
  { key: "outstanding", label: "≥90 分", min: 90, max: 100 }
];

export function groupByScoreRange(tiles) {
  const groups = {};
  for (const r of SCORE_RANGES) {
    groups[r.key] = {
      key: r.key,
      label: r.label,
      min: r.min,
      max: r.max,
      tileCount: 0,
      tileIds: []
    };
  }
  for (const tile of tiles) {
    const score = tile.score || 0;
    let rangeKey;
    if (score === 0) {
      rangeKey = "unscored";
    } else if (score < 60) {
      rangeKey = "fail";
    } else if (score <= 69) {
      rangeKey = "pass";
    } else if (score <= 79) {
      rangeKey = "good";
    } else if (score <= 89) {
      rangeKey = "excellent";
    } else {
      rangeKey = "outstanding";
    }
    groups[rangeKey].tileCount++;
    groups[rangeKey].tileIds.push(tile.id);
  }

  return Object.values(groups);
}

export { SCORE_RANGES };
