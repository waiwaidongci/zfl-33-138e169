import {
  ensureRecipeCollections,
  listRecipes,
  listRecipeVersions,
  getRecipe,
  getRecipeVersion,
  diffIngredients,
  buildIngredientsSummary
} from "./recipe-repository.js";
import { ensureInventoryCollection } from "./inventory-repository.js";
import { getDefectSummaryForTiles, getHighFrequencyDefects } from "./defect-statistics.js";
import { getCollections } from "./db.js";

export function buildTilesByVersionIndex(db) {
  const coll = getCollections(db);
  const index = {};
  if (!coll.tiles) return index;
  for (const tile of coll.tiles) {
    const key = tile.recipeVersionId || tile.recipe || "__unassigned__";
    index[key] ||= [];
    index[key].push(tile);
  }
  return index;
}

export function summarizeTiles(tiles) {
  if (!tiles || tiles.length === 0) {
    return {
      count: 0,
      totalScore: 0,
      averageScore: 0,
      maxScore: 0,
      minScore: 0,
      ashSources: [],
      bodies: [],
      defectSummary: {
        totalTiles: 0,
        tilesWithDefects: 0,
        defectRate: 0,
        topDefects: [],
        severeDefectCount: 0,
        totalDefectTags: 0
      }
    };
  }
  const scores = tiles.map(t => Number(t.score || 0)).filter(s => s > 0);
  const ashSources = [...new Set(tiles.map(t => t.ashSource).filter(Boolean))];
  const bodies = [...new Set(tiles.map(t => t.body).filter(Boolean))];
  const totalScore = scores.reduce((a, b) => a + b, 0);
  const defectSummary = getDefectSummaryForTiles(tiles);
  return {
    count: tiles.length,
    totalScore,
    averageScore: scores.length > 0 ? Number((totalScore / scores.length).toFixed(1)) : 0,
    maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    minScore: scores.length > 0 ? Math.min(...scores) : 0,
    ashSources,
    bodies,
    defectSummary
  };
}

export function getRecipeVersionReport(db) {
  ensureRecipeCollections(db);
  const tilesByVersion = buildTilesByVersionIndex(db);
  const recipes = listRecipes(db);

  return recipes.map(recipe => {
    const versions = listRecipeVersions(db, recipe.id);
    const versionStats = versions.map(version => {
      const tiles = tilesByVersion[version.id] || [];
      return {
        versionId: version.id,
        version: version.version,
        text: version.text,
        note: version.note,
        createdAt: version.createdAt,
        ...summarizeTiles(tiles)
      };
    });

    const allTilesForRecipe = versions.flatMap(v => tilesByVersion[v.id] || []);
    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      description: recipe.description,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      versionCount: versions.length,
      latestVersion: versions.length > 0 ? versions[versions.length - 1].version : 0,
      ...summarizeTiles(allTilesForRecipe),
      versions: versionStats
    };
  });
}

export function getSingleRecipeReport(db, recipeId) {
  ensureRecipeCollections(db);
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return null;

  const tilesByVersion = buildTilesByVersionIndex(db);
  const versions = listRecipeVersions(db, recipeId);

  const versionStats = versions.map(version => {
    const tiles = tilesByVersion[version.id] || [];
    return {
      versionId: version.id,
      version: version.version,
      text: version.text,
      note: version.note,
      createdAt: version.createdAt,
      ...summarizeTiles(tiles)
    };
  });

  const allTiles = versions.flatMap(v => tilesByVersion[v.id] || []);
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    description: recipe.description,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
    versionCount: versions.length,
    latestVersion: versions.length > 0 ? versions[versions.length - 1].version : 0,
    ...summarizeTiles(allTiles),
    versions: versionStats
  };
}

export function getSingleVersionReport(db, versionId) {
  ensureRecipeCollections(db);
  ensureInventoryCollection(db);
  const version = getRecipeVersion(db, versionId);
  if (!version) return null;

  const recipe = getRecipe(db, version.recipeId);
  const tilesByVersion = buildTilesByVersionIndex(db);
  const tiles = tilesByVersion[versionId] || [];

  const materialBatchUsage = {};
  for (const tile of tiles) {
    if (Array.isArray(tile.materialBatchRefs)) {
      for (const ref of tile.materialBatchRefs) {
        const key = ref.batchNo;
        if (!materialBatchUsage[key]) {
          materialBatchUsage[key] = { batchNo: ref.batchNo, ingredientName: ref.ingredientName, tileIds: [], totalDeducted: 0, unit: ref.unit || "" };
        }
        materialBatchUsage[key].tileIds.push(tile.id);
        materialBatchUsage[key].totalDeducted = Number((materialBatchUsage[key].totalDeducted + (ref.deducted || 0)).toFixed(2));
      }
    }
  }

  const defectSummary = getDefectSummaryForTiles(tiles);

  return {
    recipeId: version.recipeId,
    recipeName: recipe ? recipe.name : null,
    versionId: version.id,
    version: version.version,
    text: version.text,
    note: version.note,
    ingredients: version.ingredients,
    createdAt: version.createdAt,
    parentVersionId: version.parentVersionId,
    ...summarizeTiles(tiles),
    defectSummary,
    highFrequencyDefects: getHighFrequencyDefects(tiles, 5),
    materialBatchUsage: Object.values(materialBatchUsage),
    tiles: tiles.map(t => ({
      id: t.id,
      body: t.body,
      ashSource: t.ashSource,
      peakTemp: t.peakTemp,
      color: t.color,
      defects: t.defects,
      defectTags: t.defectTags || [],
      score: t.score,
      batchWeight: t.batchWeight || null,
      materialBatchRefs: t.materialBatchRefs || []
    }))
  };
}

export function diffTilePerformance(summaryA, summaryB) {
  const sA = summaryA || summarizeTiles([]);
  const sB = summaryB || summarizeTiles([]);

  const delta = (a, b) => b - a;
  const deltaPct = (a, b) => a !== 0 ? Number((((b - a) / a) * 100).toFixed(2)) : null;

  return {
    tileCount: {
      baseline: sA.count,
      target: sB.count,
      delta: delta(sA.count, sB.count)
    },
    scoredTileCount: {
      baseline: sA.count && sA.averageScore > 0 ? sA.count : 0,
      target: sB.count && sB.averageScore > 0 ? sB.count : 0,
      delta: delta(
        sA.count && sA.averageScore > 0 ? sA.count : 0,
        sB.count && sB.averageScore > 0 ? sB.count : 0
      )
    },
    averageScore: {
      baseline: sA.averageScore || null,
      target: sB.averageScore || null,
      delta: sA.averageScore && sB.averageScore
        ? Number(delta(sA.averageScore, sB.averageScore).toFixed(2))
        : null,
      deltaPct: sA.averageScore && sB.averageScore
        ? deltaPct(sA.averageScore, sB.averageScore)
        : null
    },
    maxScore: {
      baseline: sA.maxScore || null,
      target: sB.maxScore || null,
      delta: sA.maxScore && sB.maxScore ? delta(sA.maxScore, sB.maxScore) : null
    },
    minScore: {
      baseline: sA.minScore || null,
      target: sB.minScore || null,
      delta: sA.minScore && sB.minScore ? delta(sA.minScore, sB.minScore) : null
    },
    ashSources: {
      baseline: sA.ashSources,
      target: sB.ashSources,
      added: sB.ashSources.filter(a => !sA.ashSources.includes(a)),
      removed: sA.ashSources.filter(a => !sB.ashSources.includes(a))
    },
    bodies: {
      baseline: sA.bodies,
      target: sB.bodies,
      added: sB.bodies.filter(b => !sA.bodies.includes(b)),
      removed: sA.bodies.filter(b => !sB.bodies.includes(b))
    }
  };
}

function diffDefects(defectSummaryA, defectSummaryB, highFreqA, highFreqB) {
  const dA = defectSummaryA || getDefectSummaryForTiles([]);
  const dB = defectSummaryB || getDefectSummaryForTiles([]);
  const hfA = highFreqA || [];
  const hfB = highFreqB || [];

  const mapA = new Map(hfA.map(d => [d.name, d.count]));
  const mapB = new Map(hfB.map(d => [d.name, d.count]));

  const allNames = new Set([...mapA.keys(), ...mapB.keys()]);
  const defectDeltas = [];

  for (const name of allNames) {
    const baseline = mapA.get(name) || 0;
    const target = mapB.get(name) || 0;
    const delta = target - baseline;
    const deltaPct = baseline !== 0 ? Number((((target - baseline) / baseline) * 100).toFixed(2)) : null;
    defectDeltas.push({ name, baseline, target, delta, deltaPct });
  }

  defectDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    totalTiles: {
      baseline: dA.totalTiles,
      target: dB.totalTiles,
      delta: dB.totalTiles - dA.totalTiles
    },
    tilesWithDefects: {
      baseline: dA.tilesWithDefects,
      target: dB.tilesWithDefects,
      delta: dB.tilesWithDefects - dA.tilesWithDefects
    },
    defectRate: {
      baseline: dA.defectRate,
      target: dB.defectRate,
      delta: Number((dB.defectRate - dA.defectRate).toFixed(2)),
      deltaPct: dA.defectRate !== 0
        ? Number((((dB.defectRate - dA.defectRate) / dA.defectRate) * 100).toFixed(2))
        : null
    },
    severeDefectCount: {
      baseline: dA.severeDefectCount || 0,
      target: dB.severeDefectCount || 0,
      delta: (dB.severeDefectCount || 0) - (dA.severeDefectCount || 0)
    },
    totalDefectTags: {
      baseline: dA.totalDefectTags || 0,
      target: dB.totalDefectTags || 0,
      delta: (dB.totalDefectTags || 0) - (dA.totalDefectTags || 0)
    },
    topDefectsDelta: defectDeltas,
    addedDefects: defectDeltas.filter(d => d.baseline === 0 && d.target > 0).map(d => d.name),
    resolvedDefects: defectDeltas.filter(d => d.baseline > 0 && d.target === 0).map(d => d.name)
  };
}

function buildTilePerformanceSummary(perfDiff) {
  const summaries = [];

  if (perfDiff.tileCount.delta !== 0) {
    const sign = perfDiff.tileCount.delta > 0 ? "增加" : "减少";
    summaries.push(`试片数量${sign} ${Math.abs(perfDiff.tileCount.delta)} 片 (${perfDiff.tileCount.baseline} → ${perfDiff.tileCount.target})`);
  } else {
    summaries.push(`试片数量无变化 (${perfDiff.tileCount.baseline} 片)`);
  }

  if (perfDiff.averageScore.delta !== null) {
    const sign = perfDiff.averageScore.delta > 0 ? "提升" : "下降";
    summaries.push(`平均分${sign} ${Math.abs(perfDiff.averageScore.delta)} 分 (${perfDiff.averageScore.baseline} → ${perfDiff.averageScore.target})`);
  } else if (perfDiff.averageScore.baseline === null && perfDiff.averageScore.target !== null) {
    summaries.push(`新增评分数据，平均分 ${perfDiff.averageScore.target} 分`);
  } else if (perfDiff.averageScore.baseline !== null && perfDiff.averageScore.target === null) {
    summaries.push(`评分数据缺失，原平均分 ${perfDiff.averageScore.baseline} 分`);
  } else {
    summaries.push("暂无评分数据");
  }

  if (perfDiff.maxScore.delta !== null) {
    const sign = perfDiff.maxScore.delta > 0 ? "提升" : "下降";
    summaries.push(`最高分${sign} ${Math.abs(perfDiff.maxScore.delta)} 分 (${perfDiff.maxScore.baseline} → ${perfDiff.maxScore.target})`);
  }

  if (perfDiff.ashSources.added.length > 0) {
    summaries.push(`新增灰源: ${perfDiff.ashSources.added.join("、")}`);
  }
  if (perfDiff.ashSources.removed.length > 0) {
    summaries.push(`移除灰源: ${perfDiff.ashSources.removed.join("、")}`);
  }

  if (perfDiff.bodies.added.length > 0) {
    summaries.push(`新增坯体: ${perfDiff.bodies.added.join("、")}`);
  }
  if (perfDiff.bodies.removed.length > 0) {
    summaries.push(`移除坯体: ${perfDiff.bodies.removed.join("、")}`);
  }

  return summaries;
}

function buildDefectsSummary(defectDiff) {
  const summaries = [];

  const rateSign = defectDiff.defectRate.delta > 0 ? "上升" : "下降";
  if (defectDiff.defectRate.delta !== 0) {
    summaries.push(`缺陷率${rateSign} ${Math.abs(defectDiff.defectRate.delta)}% (${defectDiff.defectRate.baseline}% → ${defectDiff.defectRate.target}%)`);
  } else {
    summaries.push(`缺陷率无变化 (${defectDiff.defectRate.baseline}%)`);
  }

  if (defectDiff.severeDefectCount.delta !== 0) {
    const sign = defectDiff.severeDefectCount.delta > 0 ? "增加" : "减少";
    summaries.push(`严重缺陷${sign} ${Math.abs(defectDiff.severeDefectCount.delta)} 个`);
  }

  if (defectDiff.addedDefects.length > 0) {
    summaries.push(`新增缺陷类型: ${defectDiff.addedDefects.join("、")}`);
  }
  if (defectDiff.resolvedDefects.length > 0) {
    summaries.push(`消除缺陷类型: ${defectDiff.resolvedDefects.join("、")}`);
  }

  const topChanges = defectDiff.topDefectsDelta
    .filter(d => d.delta !== 0)
    .slice(0, 3);
  for (const d of topChanges) {
    const sign = d.delta > 0 ? "+" : "";
    summaries.push(`${d.name}: ${d.baseline} → ${d.target} (${sign}${d.delta})`);
  }

  return summaries;
}

export function getRecipeVersionDiff(db, versionIdA, versionIdB) {
  ensureRecipeCollections(db);

  const versionA = getRecipeVersion(db, versionIdA);
  const versionB = getRecipeVersion(db, versionIdB);

  if (!versionA || !versionB) {
    const missing = [];
    if (!versionA) missing.push(versionIdA);
    if (!versionB) missing.push(versionIdB);
    return {
      error: "versions_not_found",
      message: `找不到版本: ${missing.join("、")}`,
      missingVersions: missing
    };
  }

  if (versionA.recipeId !== versionB.recipeId) {
    return {
      error: "cross_recipe_diff_not_allowed",
      message: "仅支持对比同一配方下的版本",
      recipeIdA: versionA.recipeId,
      recipeIdB: versionB.recipeId
    };
  }

  const recipe = getRecipe(db, versionA.recipeId);
  const tilesByVersion = buildTilesByVersionIndex(db);

  const tilesA = tilesByVersion[versionIdA] || [];
  const tilesB = tilesByVersion[versionIdB] || [];

  const summaryA = summarizeTiles(tilesA);
  const summaryB = summarizeTiles(tilesB);

  const defectSummaryA = getDefectSummaryForTiles(tilesA);
  const defectSummaryB = getDefectSummaryForTiles(tilesB);

  const highFreqA = getHighFrequencyDefects(tilesA, 10);
  const highFreqB = getHighFrequencyDefects(tilesB, 10);

  const ingredientDiff = diffIngredients(versionA.ingredients, versionB.ingredients);
  const perfDiff = diffTilePerformance(summaryA, summaryB);
  const defectDiff = diffDefects(defectSummaryA, defectSummaryB, highFreqA, highFreqB);

  const ingredientsSummary = buildIngredientsSummary(ingredientDiff);
  const performanceSummary = buildTilePerformanceSummary(perfDiff);
  const defectsSummary = buildDefectsSummary(defectDiff);

  const overallDirection = {
    scoreTrend: perfDiff.averageScore.delta > 0 ? "improved" : perfDiff.averageScore.delta < 0 ? "declined" : "stable",
    defectTrend: defectDiff.defectRate.delta < 0 ? "improved" : defectDiff.defectRate.delta > 0 ? "declined" : "stable",
    recommendation: []
  };

  if (perfDiff.averageScore.delta > 5) {
    overallDirection.recommendation.push("配方调整效果显著，建议推广该优化方向");
  } else if (perfDiff.averageScore.delta > 0) {
    overallDirection.recommendation.push("配方有改善，可继续优化保持趋势");
  } else if (perfDiff.averageScore.delta < -5) {
    overallDirection.recommendation.push("配方表现明显下降，建议回滚或重新调整");
  }

  if (defectDiff.defectRate.delta < -5) {
    overallDirection.recommendation.push("缺陷率显著改善，该调整方向值得深入研究");
  } else if (defectDiff.defectRate.delta > 5) {
    overallDirection.recommendation.push("缺陷率上升明显，需关注新增缺陷类型");
  }

  if (ingredientDiff.added.length > 0) {
    overallDirection.recommendation.push(`新增原料${ingredientDiff.added.map(a => a.name).join("、")}需关注其烧成表现`);
  }
  if (ingredientDiff.removed.length > 0) {
    overallDirection.recommendation.push(`移除原料${ingredientDiff.removed.map(r => r.name).join("、")}可能影响釉面特性`);
  }

  if (overallDirection.recommendation.length === 0) {
    overallDirection.recommendation.push("配方表现稳定，可继续积累更多试片数据以验证效果");
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      recipe: recipe ? { id: recipe.id, name: recipe.name } : null,
      baseline: {
        versionId: versionA.id,
        version: versionA.version,
        text: versionA.text,
        note: versionA.note,
        createdAt: versionA.createdAt
      },
      target: {
        versionId: versionB.id,
        version: versionB.version,
        text: versionB.text,
        note: versionB.note,
        createdAt: versionB.createdAt
      }
    },
    ingredients: {
      baseline: versionA.ingredients,
      target: versionB.ingredients,
      diff: ingredientDiff
    },
    tilePerformance: {
      baseline: summaryA,
      target: summaryB,
      diff: perfDiff
    },
    defects: {
      baseline: {
        summary: defectSummaryA,
        topDefects: highFreqA
      },
      target: {
        summary: defectSummaryB,
        topDefects: highFreqB
      },
      diff: defectDiff
    },
    summary: {
      ingredients: ingredientsSummary,
      performance: performanceSummary,
      defects: defectsSummary,
      overallDirection
    },
    tiles: {
      baseline: tilesA.map(t => ({
        id: t.id,
        body: t.body,
        ashSource: t.ashSource,
        peakTemp: t.peakTemp,
        color: t.color,
        score: t.score,
        defectTags: t.defectTags || []
      })),
      target: tilesB.map(t => ({
        id: t.id,
        body: t.body,
        ashSource: t.ashSource,
        peakTemp: t.peakTemp,
        color: t.color,
        score: t.score,
        defectTags: t.defectTags || []
      }))
    }
  };
}
