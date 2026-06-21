import { findSimilarTiles } from "./similarity-search.js";
import { parseIngredients, diffIngredients, getRecipeVersion, ensureRecipeCollections } from "./recipe-repository.js";
import { getDefectSummaryForTiles, getHighFrequencyDefects, groupByKiln, groupByAshSource, collectAllTileDefects, countByDefectName } from "./defect-statistics.js";
import { normalizeFiringCurve, generateRisks, calcTotalDuration, calcHeatingRates, KILN_PROFILES } from "./firing-calc.js";
import { getCollections } from "./db.js";
import { DEFECT_CATALOG, normalizeDefectName, tryParseDefectText } from "./defect-validate.js";

const LOW_SCORE_THRESHOLD = 70;
const HIGH_SCORE_THRESHOLD = 80;
const GOOD_SCORE_THRESHOLD = 75;

const DEFECT_REMEDY_RULES = {
  流釉: {
    recipe: [
      { ingredient: "长石", direction: "decrease", reason: "长石熔融温度低，含量过高会导致釉面过熔流淌" },
      { ingredient: "石英", direction: "increase", reason: "石英提高釉面耐火度，减少高温流动性" }
    ],
    firing: [
      { param: "peakTemp", direction: "decrease", amount: 10, reason: "降低峰值温度，减少釉料熔融时间" },
      { param: "holdMinutes", direction: "decrease", amount: 10, reason: "缩短高温保温时间，防止釉面过熔" }
    ],
    note: "流釉通常与釉料高温粘度过低有关，可同时检查施釉厚度是否超标"
  },
  针孔: {
    recipe: [
      { ingredient: "高岭", direction: "increase", reason: "高岭土增加釉面悬浮性，减少气泡排出后留下的针孔" },
      { ingredient: "长石", direction: "decrease", reason: "适量减少熔剂，防止釉面过早封闭气体" }
    ],
    firing: [
      { param: "holdMinutes", direction: "increase", amount: 15, reason: "延长保温时间，让气泡充分排出" },
      { param: "heatingRate", direction: "decrease", stage: "high", reason: "高温阶段放慢升温，给气体排出留足时间" }
    ],
    note: "针孔通常因釉面封闭后气体无法排出，建议检查施釉前坯体清洁度"
  },
  缩釉: {
    recipe: [
      { ingredient: "高岭", direction: "increase", reason: "增加高岭土提升釉料附着力，减少釉面收缩开裂" },
      { ingredient: "红土", direction: "decrease", reason: "红土塑性过高可能导致釉面收缩率过大" }
    ],
    firing: [
      { param: "heatingRate", direction: "decrease", stage: "mid", reason: "中温阶段放慢升温，避免釉面急剧收缩" }
    ],
    note: "缩釉常与釉料附着力不足有关，建议加强施釉前的坯体预处理（补水、素烧）"
  },
  色差: {
    recipe: [
      { ingredient: "红土", direction: "adjust", reason: "红土含量波动会导致发色不稳，建议精确配比" },
      { ingredient: "灰", direction: "stable", reason: "灰源成分波动是主要色差来源，建议同一批次使用相同灰源" }
    ],
    firing: [
      { param: "peakTemp", direction: "stable", reason: "精确控制峰值温度，±20℃范围会显著影响发色" },
      { param: "atmosphere", direction: "stable", reason: "稳定烧成气氛（氧化/还原），气氛波动直接影响釉色" }
    ],
    note: "色差常与灰源矿物成分波动相关，建议建立灰源入库检测流程"
  },
  开片: {
    recipe: [
      { ingredient: "石英", direction: "decrease", reason: "减少石英含量，降低釉层膨胀系数差" },
      { ingredient: "长石", direction: "increase", reason: "增加长石调节釉层热膨胀系数与坯体匹配" }
    ],
    firing: [
      { param: "coolingRate", direction: "decrease", reason: "放慢冷却速率，减少因热应力导致的开裂" }
    ],
    note: "若追求开片艺术效果，此规则可忽略；若非预期缺陷建议调整配方膨胀系数"
  },
  气泡: {
    recipe: [
      { ingredient: "长石", direction: "decrease", reason: "减少长石避免高温分解产生过多气体" },
      { ingredient: "高岭", direction: "increase", reason: "增加高岭提升釉层透气性" }
    ],
    firing: [
      { param: "holdMinutes", direction: "increase", amount: 20, reason: "延长保温时间，使气泡充分排出破裂" },
      { param: "heatingRate", direction: "decrease", stage: "low", reason: "低温阶段缓慢升温，排除坯体吸附水和结构水" }
    ],
    note: "气泡问题常与坯体含水率和升温速率相关，建议素烧后施釉"
  },
  开裂: {
    recipe: [
      { ingredient: "红土", direction: "decrease", reason: "减少高塑性粘土，降低坯体收缩率" },
      { ingredient: "石英", direction: "increase", reason: "增加瘠性原料，改善坯体干燥和烧成收缩" }
    ],
    firing: [
      { param: "heatingRate", direction: "decrease", stage: "low", reason: "低温阶段升温过快来不及排水导致炸裂" },
      { param: "coolingRate", direction: "decrease", reason: "冷却过快产生热应力，573℃石英相变区需特别注意缓冷" }
    ],
    note: "坯裂多与热震相关，建议检查坯体厚度均匀性和窑内温差"
  },
  无光: {
    recipe: [
      { ingredient: "长石", direction: "increase", reason: "增加熔剂促进釉面充分熔融玻璃化" },
      { ingredient: "灰", direction: "increase", reason: "草木灰中碱金属可增强助熔效果" }
    ],
    firing: [
      { param: "peakTemp", direction: "increase", amount: 20, reason: "提高峰值温度，确保釉料充分熔融" },
      { param: "holdMinutes", direction: "increase", amount: 15, reason: "延长保温，使釉面充分反应玻化" }
    ],
    note: "无光釉也可能是艺术效果，需确认是否预期目标"
  },
  斑点: {
    recipe: [
      { ingredient: "红土", direction: "decrease", reason: "红土中的铁钛矿物易形成深色斑点，建议过筛细化" },
      { ingredient: "灰", direction: "sift", reason: "灰源中未燃尽碳粒和杂质是斑点主要来源，需严格过筛" }
    ],
    firing: [],
    note: "斑点多与原料杂质相关，建议加强原料预处理（球磨、过筛、除铁）"
  },
  橘皮: {
    recipe: [
      { ingredient: "长石", direction: "increase", reason: "增加熔剂降低高温粘度，改善釉面流平性" }
    ],
    firing: [
      { param: "holdMinutes", direction: "increase", amount: 15, reason: "延长保温改善釉面流平" },
      { param: "peakTemp", direction: "adjust", reason: "适当调整峰值温度平衡流平与防止过熔" }
    ],
    note: "橘皮与釉面高温粘度和表面张力相关，可结合施釉均匀性调整"
  },
  缺釉: {
    recipe: [
      { ingredient: "高岭", direction: "increase", reason: "提升釉料附着性能" }
    ],
    firing: [],
    note: "缺釉多为施釉工艺问题（漏涂、气泡破裂），建议检查施釉操作"
  },
  釉缕: {
    recipe: [
      { ingredient: "长石", direction: "decrease", reason: "降低釉料高温流动性" }
    ],
    firing: [
      { param: "peakTemp", direction: "decrease", amount: 10, reason: "降低峰值温度减少釉料流淌" },
      { param: "holdMinutes", direction: "decrease", amount: 10, reason: "缩短保温时间" }
    ],
    note: "釉缕是流釉的局部表现，施釉厚度不均和边缘积聚是常见诱因"
  }
};

const ASH_SOURCE_PATTERNS = {
  "松灰": { typicalTemp: 1240, typicalAshRange: [38, 45], notes: "松灰含钾较高，助熔性强，需控制含量防止流釉" },
  "稻灰": { typicalTemp: 1260, typicalAshRange: [35, 42], notes: "稻灰含硅较高，釉面偏乳白，需注意保温时间" },
  "竹灰": { typicalTemp: 1245, typicalAshRange: [38, 46], notes: "竹灰含钾磷，釉色温润，适合还原气氛" },
  "木灰": { typicalTemp: 1255, typicalAshRange: [45, 55], notes: "木灰成分差异大，建议稳定来源批次" },
  "柴灰": { typicalTemp: 1260, typicalAshRange: [40, 50], notes: "柴灰成分复杂，含未燃尽碳粒，需严格过筛除碳" }
};

function getTileDefects(tile) {
  const tags = tile.defectTags || [];
  if (tags.length > 0) {
    return tags.map(t => t.name).filter(Boolean);
  }
  const parsed = tryParseDefectText(tile.defects || "");
  return parsed.map(t => t.name);
}

function normalizeTileForSearch(tile) {
  const defects = getTileDefects(tile);
  return {
    body: tile.body || "",
    ashSource: tile.ashSource || "",
    peakTemp: tile.peakTemp || 0,
    recipe: tile.recipe || "",
    color: tile.color || "",
    defects: tile.defects || "",
    defectKeywords: defects.length > 0 ? defects : undefined,
    score: tile.score || 0
  };
}

function parseFiringInputFromTile(tile) {
  const hasCurve = Array.isArray(tile.firingCurve) && tile.firingCurve.length > 0;
  let holdMinutes = 0;
  let heatingStages = [];

  if (hasCurve && tile.firingCurve.length >= 2) {
    const curve = tile.firingCurve;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].temp === curve[i - 1].temp) {
        holdMinutes += curve[i].minutes - curve[i - 1].minutes;
      } else {
        const tempDiff = curve[i].temp - curve[i - 1].temp;
        const timeDiff = curve[i].minutes - curve[i - 1].minutes;
        if (timeDiff > 0 && tempDiff > 0) {
          const rate = Math.round(tempDiff / (timeDiff / 60));
          heatingStages.push({
            endTemp: curve[i].temp,
            rate,
            minutes: timeDiff
          });
        }
      }
    }
  }

  return {
    peakTemp: tile.peakTemp || 0,
    kiln: tile.kiln || "",
    holdMinutes,
    heatingStages,
    firingCurve: hasCurve ? tile.firingCurve : undefined
  };
}

function classifyTilesByScore(tiles) {
  const high = tiles.filter(t => Number(t.score || 0) >= HIGH_SCORE_THRESHOLD);
  const good = tiles.filter(t => {
    const s = Number(t.score || 0);
    return s >= GOOD_SCORE_THRESHOLD && s < HIGH_SCORE_THRESHOLD;
  });
  const low = tiles.filter(t => {
    const s = Number(t.score || 0);
    return s > 0 && s < LOW_SCORE_THRESHOLD;
  });
  const unscored = tiles.filter(t => !t.score || Number(t.score) === 0);
  return { high, good, low, unscored };
}

function findSimilarSuccessTiles(tile, allTiles, options = {}) {
  const topN = options.topN || 5;
  const minSimilarity = options.minSimilarity || 30;

  const others = allTiles.filter(t => t.id !== tile.id);
  if (others.length === 0) {
    return { tiles: [], searchQuery: normalizeTileForSearch(tile), note: "无历史数据可对比" };
  }

  const scoredOthers = others.filter(t => Number(t.score || 0) > 0);
  const { high, good } = classifyTilesByScore(scoredOthers);
  const successTiles = [...high, ...good];

  let searchPool = successTiles.length >= 3 ? successTiles : scoredOthers;

  const query = normalizeTileForSearch(tile);
  const similar = findSimilarTiles(query, searchPool, { topN: Math.max(topN * 2, 10), minScore: minSimilarity });

  const enriched = similar.results
    .filter(r => r.similarityScore >= minSimilarity)
    .map(r => {
      const defects = getTileDefects(r.tile);
      return {
        tileId: r.tile.id,
        tile: {
          id: r.tile.id,
          body: r.tile.body,
          recipe: r.tile.recipe,
          ashSource: r.tile.ashSource,
          kiln: r.tile.kiln,
          peakTemp: r.tile.peakTemp,
          color: r.tile.color,
          defects: r.tile.defects,
          defectTags: r.tile.defectTags || [],
          defectNames: defects,
          score: r.tile.score,
          observations: r.tile.observations || []
        },
        similarityScore: r.similarityScore,
        reasons: r.reasons,
        fieldMatches: r.fieldMatches,
        details: r.details,
        scoreClass: Number(r.tile.score) >= HIGH_SCORE_THRESHOLD ? "high" :
                    Number(r.tile.score) >= GOOD_SCORE_THRESHOLD ? "good" : "normal"
      };
    })
    .sort((a, b) => {
      const classOrder = { high: 3, good: 2, normal: 1 };
      const classDiff = classOrder[b.scoreClass] - classOrder[a.scoreClass];
      if (classDiff !== 0) return classDiff;
      return b.similarityScore - a.similarityScore;
    })
    .slice(0, topN);

  const notes = [];
  if (successTiles.length < 3) {
    notes.push(`成功样片数量较少（仅 ${successTiles.length} 片），参考范围已扩展至所有有评分的历史试片`);
  }
  if (enriched.length < topN) {
    notes.push(`仅找到 ${enriched.length} 个相似样片（目标 ${topN} 个），推荐置信度有所降低`);
  }

  return {
    tiles: enriched,
    searchQuery: query,
    searchPoolSize: searchPool.length,
    successPoolSize: successTiles.length,
    notes: notes.length > 0 ? notes : undefined
  };
}

function analyzeRiskFactors(tile, allTiles) {
  const risks = [];
  const evidence = [];

  const defects = getTileDefects(tile);
  defects.forEach(d => {
    const rule = DEFECT_REMEDY_RULES[d];
    if (rule && rule.note) {
      risks.push({
        category: "defect",
        defectName: d,
        description: rule.note,
        level: "warning"
      });
    }
  });

  const others = allTiles.filter(t => t.id !== tile.id);
  const groupedByKiln = groupByKiln(others);
  if (tile.kiln) {
    const kilnGroup = groupedByKiln.find(g => g.kiln === tile.kiln);
    if (kilnGroup && kilnGroup.defectRate > 40) {
      risks.push({
        category: "kiln",
        kiln: tile.kiln,
        description: `窑炉 ${tile.kiln} 历史缺陷率 ${kilnGroup.defectRate}%，偏高（>40%），建议检查窑炉温控和气氛控制`,
        level: kilnGroup.defectRate > 60 ? "danger" : "warning",
        evidenceRef: `窑炉 ${tile.kiln} 共 ${kilnGroup.tileCount} 片试片，${kilnGroup.tilesWithDefects} 片有缺陷`
      });
      evidence.push({
        type: "kiln_stats",
        data: kilnGroup
      });
    }
  }

  const groupedByAsh = groupByAshSource(others);
  if (tile.ashSource) {
    const ashGroup = groupedByAsh.find(g => g.ashSource === tile.ashSource);
    if (ashGroup && ashGroup.defectRate > 40) {
      risks.push({
        category: "ashSource",
        ashSource: tile.ashSource,
        description: `灰源 ${tile.ashSource} 历史缺陷率 ${ashGroup.defectRate}%，偏高（>40%），建议检测灰源成分或预处理质量`,
        level: ashGroup.defectRate > 60 ? "danger" : "warning",
        evidenceRef: `灰源 ${tile.ashSource} 共 ${ashGroup.tileCount} 片试片，${ashGroup.tilesWithDefects} 片有缺陷`
      });
      evidence.push({
        type: "ash_source_stats",
        data: ashGroup
      });
    }
  }

  const firingInput = parseFiringInputFromTile(tile);
  if (firingInput.peakTemp > 0) {
    try {
      const curve = normalizeFiringCurve(firingInput);
      const firingRisks = generateRisks(firingInput, curve);
      firingRisks.forEach(fr => {
        risks.push({
          category: "firing",
          level: fr.level,
          description: fr.message,
          code: fr.code
        });
      });

      const othersWithCurves = others.filter(t => Array.isArray(t.firingCurve) && t.firingCurve.length > 0 && t.peakTemp > 0);
      if (othersWithCurves.length >= 3 && firingInput.kiln) {
        const sameKiln = othersWithCurves.filter(t => t.kiln === firingInput.kiln);
        if (sameKiln.length >= 3) {
          const avgPeak = sameKiln.reduce((s, t) => s + Number(t.peakTemp), 0) / sameKiln.length;
          const peakDiff = Math.abs(Number(firingInput.peakTemp) - avgPeak);
          if (peakDiff > 50) {
            risks.push({
              category: "firing",
              level: peakDiff > 100 ? "danger" : "warning",
              description: `峰值温度 ${firingInput.peakTemp}℃ 与窑炉 ${firingInput.kiln} 历史平均 ${Math.round(avgPeak)}℃ 相差 ${Math.round(peakDiff)}℃，超出常规范围`,
              evidenceRef: `基于 ${sameKiln.length} 片同窑炉试片统计`
            });
            evidence.push({
              type: "kiln_temp_stats",
              data: { kiln: firingInput.kiln, avgPeak: Math.round(avgPeak), sampleCount: sameKiln.length }
            });
          }
        }
      }
    } catch (_) {}
  }

  const parsedRecipe = parseIngredients(tile.recipe || "");
  if (parsedRecipe.length === 0 && tile.recipe && tile.recipe.trim().length > 0) {
    risks.push({
      category: "recipe",
      level: "info",
      description: "配方文本未能完全解析，建议使用标准格式（原料名+百分比，空格分隔）以便精确分析",
      evidenceRef: `当前配方: "${tile.recipe}"`
    });
  }

  if (!tile.ashSource || String(tile.ashSource).trim() === "") {
    risks.push({
      category: "metadata",
      level: "info",
      description: "未记录灰源信息，无法分析灰源相关风险，建议补充录入"
    });
  }
  if (!tile.kiln || String(tile.kiln).trim() === "") {
    risks.push({
      category: "metadata",
      level: "info",
      description: "未记录窑炉信息，无法进行窑炉相关分析，建议补充录入"
    });
  }
  if (!tile.peakTemp || Number(tile.peakTemp) <= 0) {
    risks.push({
      category: "metadata",
      level: "info",
      description: "未记录峰值温度，无法评估烧成参数风险，建议补充录入"
    });
  }

  return {
    risks: risks.sort((a, b) => {
      const order = { danger: 0, warning: 1, info: 2 };
      return (order[a.level] ?? 3) - (order[b.level] ?? 3);
    }),
    evidence
  };
}

function generateRecipeRecommendations(tile, similarTiles, allTiles) {
  const recommendations = [];
  const evidenceBasis = [];

  const currentIngredients = parseIngredients(tile.recipe || "");
  if (currentIngredients.length === 0) {
    recommendations.push({
      type: "recipe",
      action: "meta",
      message: "当前配方文本无法解析为结构化原料配比，建议补充标准格式配方以获得精准调整建议",
      confidence: "low"
    });
    return { recommendations, evidenceBasis };
  }

  const defectNames = getTileDefects(tile);
  defectNames.forEach(d => {
    const rule = DEFECT_REMEDY_RULES[d];
    if (!rule) return;
    rule.recipe.forEach(rr => {
      const existing = currentIngredients.find(i => i.name.includes(rr.ingredient) || rr.ingredient.includes(i.name));
      let recommendation = {
        type: "recipe",
        ingredient: rr.ingredient,
        direction: rr.direction,
        defectRelated: d,
        reason: rr.reason,
        confidence: "medium"
      };
      if (existing) {
        recommendation.currentPercentage = existing.percentage;
        recommendation.matchedIngredient = existing.name;
        if (rr.direction === "increase") {
          recommendation.suggestedRange = [existing.percentage, Math.min(existing.percentage + 8, 60)];
          recommendation.suggestionText = `建议 ${existing.name} 从 ${existing.percentage}% 提升至 ${existing.percentage + 5}~${Math.min(existing.percentage + 8, 60)}%`;
        } else if (rr.direction === "decrease") {
          recommendation.suggestedRange = [Math.max(existing.percentage - 8, 0), existing.percentage];
          recommendation.suggestionText = `建议 ${existing.name} 从 ${existing.percentage}% 降至 ${Math.max(existing.percentage - 8, 0)}~${existing.percentage - 5}%`;
        } else if (rr.direction === "adjust") {
          recommendation.suggestionText = `建议精确控制 ${existing.name} (${existing.percentage}%) 配比，批次间波动控制在 ±2% 以内`;
        } else if (rr.direction === "stable") {
          recommendation.suggestionText = `建议保持 ${existing.name} 来源稳定，批次间成分波动会直接影响釉色`;
        } else if (rr.direction === "sift") {
          recommendation.suggestionText = `建议 ${existing.name} 过 200 目筛并去除杂质，预处理对减少斑点至关重要`;
        }
      } else {
        recommendation.suggestionText = `配方中未检测到 ${rr.ingredient}，可考虑少量引入或检查配方命名`;
        recommendation.confidence = "low";
      }
      if (recommendation.suggestionText) {
        recommendations.push(recommendation);
        evidenceBasis.push({
          rule: `DEFECT_REMEDY_RULES[${d}].recipe`,
          source: "缺陷整改知识库",
          defect: d,
          recommendation
        });
      }
    });
  });

  if (similarTiles.length > 0) {
    const topMatches = similarTiles.filter(s => s.similarityScore >= 40).slice(0, 3);
    const topIngredients = topMatches.map(s => parseIngredients(s.tile.recipe)).filter(arr => arr.length > 0);

    if (topIngredients.length >= 1) {
      const avgIngredients = new Map();
      topIngredients.forEach(ingArr => {
        ingArr.forEach(i => {
          if (!avgIngredients.has(i.name)) avgIngredients.set(i.name, { total: 0, count: 0 });
          avgIngredients.get(i.name).total += i.percentage;
          avgIngredients.get(i.name).count += 1;
        });
      });

      avgIngredients.forEach((val, name) => {
        const avgPct = Number((val.total / val.count).toFixed(1));
        const current = currentIngredients.find(i => i.name.includes(name) || name.includes(i.name));
        if (current && Math.abs(current.percentage - avgPct) >= 5) {
          const alreadyRecommended = recommendations.some(r =>
            r.matchedIngredient === current.name || r.ingredient === name
          );
          if (!alreadyRecommended) {
            const diff = Number((avgPct - current.percentage).toFixed(1));
            const matchTiles = topMatches.filter(m => {
              const ing = parseIngredients(m.tile.recipe).find(i => i.name.includes(name) || name.includes(i.name));
              return ing;
            });
            recommendations.push({
              type: "recipe",
              ingredient: name,
              matchedIngredient: current.name,
              currentPercentage: current.percentage,
              suggestedValue: avgPct,
              direction: diff > 0 ? "increase" : "decrease",
              delta: diff,
              reason: `参考 ${matchTiles.length} 个高分配方形的平均配比，${current.name} 平均 ${avgPct}%`,
              confidence: "medium",
              suggestionText: `参考高分样片经验，建议 ${current.name} 从 ${current.percentage}% 调整至约 ${avgPct}%（${diff > 0 ? '+' : ''}${diff}%）`,
              similarTileIds: matchTiles.map(m => m.tileId)
            });
            evidenceBasis.push({
              rule: "AVERAGE_OF_SUCCESSFUL_RECIPES",
              source: "历史高分配方统计",
              tileIds: matchTiles.map(m => m.tileId),
              avgPct,
              sampleCount: val.count
            });
          }
        }
      });
    }
  }

  if (tile.ashSource) {
    Object.entries(ASH_SOURCE_PATTERNS).forEach(([keyword, pattern]) => {
      if (String(tile.ashSource).includes(keyword)) {
        const ashIngredient = currentIngredients.find(i => i.name.includes("灰"));
        if (ashIngredient) {
          const [minR, maxR] = pattern.typicalAshRange;
          if (ashIngredient.percentage < minR - 5 || ashIngredient.percentage > maxR + 5) {
            const alreadyR = recommendations.some(r => r.matchedIngredient === ashIngredient.name);
            if (!alreadyR) {
              recommendations.push({
                type: "recipe",
                ingredient: keyword,
                matchedIngredient: ashIngredient.name,
                currentPercentage: ashIngredient.percentage,
                typicalRange: pattern.typicalAshRange,
                reason: `${keyword} 典型配比范围 ${minR}~${maxR}%，当前 ${ashIngredient.percentage}% 超出经验范围`,
                confidence: "low",
                suggestionText: `参考 ${keyword} 经验范围，建议 ${ashIngredient.name} (${ashIngredient.percentage}%) 控制在 ${minR}~${maxR}% 区间内`,
                patternNote: pattern.notes
              });
            }
          }
        }
      }
    });
  }

  return {
    recommendations: recommendations.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3);
    }),
    evidenceBasis
  };
}

function generateFiringRecommendations(tile, similarTiles) {
  const recommendations = [];
  const evidenceBasis = [];

  const firingInput = parseFiringInputFromTile(tile);
  const defectNames = getTileDefects(tile);
  const hasValidPeak = firingInput.peakTemp > 0;

  if (!hasValidPeak) {
    recommendations.push({
      type: "firing",
      action: "meta",
      message: "缺少峰值温度等烧成参数记录，无法生成精确烧成调整建议，建议补充完整烧成曲线数据",
      confidence: "low"
    });
    return { recommendations, evidenceBasis };
  }

  defectNames.forEach(d => {
    const rule = DEFECT_REMEDY_RULES[d];
    if (!rule) return;
    rule.firing.forEach(fr => {
      let rec = {
        type: "firing",
        param: fr.param,
        direction: fr.direction,
        defectRelated: d,
        reason: fr.reason,
        confidence: "medium"
      };
      if (fr.amount !== undefined) {
        rec.amount = fr.amount;
      }
      if (fr.stage) {
        rec.stage = fr.stage;
      }

      if (fr.param === "peakTemp") {
        const delta = fr.direction === "increase" ? fr.amount : fr.direction === "decrease" ? -fr.amount : 0;
        rec.currentValue = firingInput.peakTemp;
        rec.suggestedValue = delta ? firingInput.peakTemp + delta : "精确控制 ±10℃ 内";
        rec.suggestionText = delta
          ? `建议峰值温度从 ${firingInput.peakTemp}℃ ${fr.direction === 'increase' ? '提升' : '降低'} 至 ${firingInput.peakTemp + delta}℃`
          : `建议精确控制峰值温度在 ${firingInput.peakTemp}℃ ±10℃ 范围内`;
      } else if (fr.param === "holdMinutes") {
        const delta = fr.direction === "increase" ? fr.amount : fr.direction === "decrease" ? -fr.amount : 0;
        rec.currentValue = firingInput.holdMinutes || 0;
        const newHold = Math.max(0, (firingInput.holdMinutes || 0) + (delta || 0));
        rec.suggestedValue = delta ? newHold : "保持稳定";
        rec.suggestionText = delta
          ? `建议高温保温时间从 ${firingInput.holdMinutes || 0} 分钟 ${fr.direction === 'increase' ? '延长' : '缩短'} 至 ${newHold} 分钟`
          : `建议保温时间保持稳定，避免批次间波动`;
      } else if (fr.param === "heatingRate") {
        const stageLabel = fr.stage === "low" ? "低温(25-600℃)" :
                           fr.stage === "mid" ? "中温(600-1000℃)" : "高温(1000℃以上)";
        rec.suggestionText = `建议 ${stageLabel} 阶段 ${fr.direction === 'decrease' ? '放慢' : '加快'} 升温速率`;
      } else if (fr.param === "coolingRate") {
        rec.suggestionText = `建议冷却阶段 ${fr.direction === 'decrease' ? '放慢' : '加快'} 冷却速率，尤其是 573℃ 相变区`;
      } else if (fr.param === "atmosphere") {
        rec.suggestionText = `建议稳定烧成气氛控制，避免氧化/还原交替波动`;
      }

      if (rec.suggestionText) {
        recommendations.push(rec);
        evidenceBasis.push({
          rule: `DEFECT_REMEDY_RULES[${d}].firing`,
          source: "缺陷整改知识库",
          defect: d,
          recommendation: rec
        });
      }
    });
  });

  if (similarTiles.length >= 2) {
    const topMatches = similarTiles.filter(s => s.similarityScore >= 40).slice(0, 5);
    const sameKiln = firingInput.kiln
      ? topMatches.filter(s => s.tile.kiln === firingInput.kiln && s.tile.peakTemp > 0)
      : [];
    const peakCandidates = sameKiln.length >= 2 ? sameKiln : topMatches.filter(s => s.tile.peakTemp > 0);

    if (peakCandidates.length >= 2) {
      const avgPeak = Math.round(peakCandidates.reduce((s, t) => s + Number(t.tile.peakTemp), 0) / peakCandidates.length);
      const peakDiff = avgPeak - firingInput.peakTemp;

      if (Math.abs(peakDiff) >= 15) {
        const alreadyHasPeak = recommendations.some(r => r.param === "peakTemp");
        if (!alreadyHasPeak) {
          recommendations.push({
            type: "firing",
            param: "peakTemp",
            currentValue: firingInput.peakTemp,
            suggestedValue: avgPeak,
            delta: peakDiff,
            direction: peakDiff > 0 ? "increase" : "decrease",
            reason: `参考 ${peakCandidates.length} 个相似高分样片的平均峰值温度 ${avgPeak}℃`,
            confidence: "medium",
            suggestionText: `参考高分样片经验，建议峰值温度从 ${firingInput.peakTemp}℃ ${peakDiff > 0 ? '提升' : '降低'} 至约 ${avgPeak}℃`,
            similarTileIds: peakCandidates.map(p => p.tileId)
          });
          evidenceBasis.push({
            rule: "AVERAGE_OF_SUCCESSFUL_PEAK_TEMPS",
            source: "历史高分样片峰值统计",
            tileIds: peakCandidates.map(p => p.tileId),
            avgPeak
          });
        }
      }
    }
  }

  if (hasValidPeak && firingInput.kiln) {
    const profile = KILN_PROFILES[firingInput.kiln];
    if (profile) {
      if (firingInput.peakTemp < profile.minTemp) {
        recommendations.push({
          type: "firing",
          param: "peakTemp",
          currentValue: firingInput.peakTemp,
          suggestedValue: profile.minTemp,
          direction: "increase",
          reason: `窑炉 ${profile.name}(${firingInput.kiln}) 常规工作下限 ${profile.minTemp}℃`,
          confidence: "medium",
          suggestionText: `当前 ${firingInput.peakTemp}℃ 低于窑炉 ${profile.name} 常规下限，建议至少提升至 ${profile.minTemp}℃ 以保证釉料充分熔融`
        });
      } else if (firingInput.peakTemp > profile.maxTemp) {
        recommendations.push({
          type: "firing",
          param: "peakTemp",
          currentValue: firingInput.peakTemp,
          suggestedValue: profile.maxTemp,
          direction: "decrease",
          reason: `窑炉 ${profile.name}(${firingInput.kiln}) 安全上限 ${profile.maxTemp}℃`,
          confidence: "high",
          suggestionText: `当前 ${firingInput.peakTemp}℃ 超过窑炉安全上限，建议降低至 ${profile.maxTemp}℃ 以下`
        });
      }
    }
  }

  return {
    recommendations: recommendations.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3);
    }),
    evidenceBasis
  };
}

function analyzeDefectPatterns(tile, allTiles) {
  const currentDefects = getTileDefects(tile);
  const others = allTiles.filter(t => t.id !== tile.id);

  const analysis = {
    currentDefects: currentDefects.map(d => {
      const rule = DEFECT_REMEDY_RULES[d];
      return {
        name: d,
        hasRemedy: !!rule,
        remedyOverview: rule ? {
          recipeCount: rule.recipe.length,
          firingCount: rule.firing.length,
          note: rule.note
        } : null
      };
    })
  };

  if (currentDefects.length > 0 && others.length >= 5) {
    const othersDefectMap = new Map();
    for (const t of others) {
      const dList = getTileDefects(t);
      for (const d of dList) {
        if (!othersDefectMap.has(d)) othersDefectMap.set(d, { total: 0, highScore: 0, tiles: [] });
        othersDefectMap.get(d).total++;
        if (Number(t.score || 0) >= HIGH_SCORE_THRESHOLD) {
          othersDefectMap.get(d).highScore++;
        }
        if (othersDefectMap.get(d).tiles.length < 3) {
          othersDefectMap.get(d).tiles.push({ id: t.id, score: t.score });
        }
      }
    }

    analysis.cooccurrenceRisk = currentDefects.map(d => {
      const stat = othersDefectMap.get(d);
      if (!stat || stat.total === 0) return null;
      const rateOthers = stat.highScore / stat.total;
      return {
        defect: d,
        occurrenceInHistory: stat.total,
        highScoreOccurrence: stat.highScore,
        highScoreRateAmongDefect: Number((rateOthers * 100).toFixed(1)),
        sampleTiles: stat.tiles,
        interpretation: rateOthers < 0.2
          ? `该缺陷在历史中出现 ${stat.total} 次，仅 ${stat.highScore} 次伴随高分，对评分负面影响较大`
          : rateOthers < 0.5
          ? `该缺陷与评分存在一定负相关，建议优先整改`
          : `该缺陷在高分样片中也有出现，可能为非关键影响因素或艺术效果`
      };
    }).filter(Boolean);
  }

  return analysis;
}

function buildOverallSummary(tile, similarResult, riskAnalysis, recipeRecs, firingRecs, defectPatterns) {
  const score = Number(tile.score || 0);
  const summary = {
    overallScore: score,
    scoreLevel: score === 0 ? "unscored" :
                 score < 60 ? "fail" :
                 score < 70 ? "pass" :
                 score < 80 ? "good" :
                 score < 90 ? "excellent" : "outstanding"
  };

  const keyPoints = [];
  const urgentActions = [];

  if (riskAnalysis.risks.length > 0) {
    const dangers = riskAnalysis.risks.filter(r => r.level === "danger");
    const warnings = riskAnalysis.risks.filter(r => r.level === "warning");
    if (dangers.length > 0) urgentActions.push(`${dangers.length} 项高风险因素需立即处理`);
    keyPoints.push(`识别到 ${dangers.length + warnings.length} 项风险因素（${dangers.length} 高风险 / ${warnings.length} 中风险）`);
  }

  if (similarResult.tiles.length > 0) {
    const topTile = similarResult.tiles[0];
    keyPoints.push(`找到 ${similarResult.tiles.length} 个相似成功样片参考，最接近样片 ${topTile.tileId} 相似度 ${topTile.similarityScore}分 / 评分 ${topTile.tile.score}分`);
  } else {
    keyPoints.push("历史数据有限，未找到足够相似样片，建议以缺陷整改规则为主进行调整");
  }

  if (recipeRecs.recommendations.length > 0) {
    const mediumPlus = recipeRecs.recommendations.filter(r => r.confidence !== "low").length;
    keyPoints.push(`配方调整建议 ${recipeRecs.recommendations.length} 条（${mediumPlus} 条中高置信度）`);
  }
  if (firingRecs.recommendations.length > 0) {
    const mediumPlus = firingRecs.recommendations.filter(r => r.confidence !== "low").length;
    keyPoints.push(`烧成调整建议 ${firingRecs.recommendations.length} 条（${mediumPlus} 条中高置信度）`);
  }

  if (defectPatterns.currentDefects.length === 0) {
    keyPoints.push("当前试片无明确缺陷标签，但评分偏低可能与配方烧成整体匹配度相关");
  }

  summary.keyPoints = keyPoints;
  summary.urgentActions = urgentActions;

  const priorityList = [];
  [...recipeRecs.recommendations, ...firingRecs.recommendations]
    .filter(r => r.confidence !== "low")
    .slice(0, 5)
    .forEach((r, i) => {
      priorityList.push({
        priority: i + 1,
        type: r.type,
        content: r.suggestionText || r.message || r.reason,
        relatedDefect: r.defectRelated || null,
        confidence: r.confidence
      });
    });
  summary.priorityActions = priorityList;

  return summary;
}

export function generateExperimentReview(db, tileIdOrTile, options = {}) {
  const coll = getCollections(db);
  ensureRecipeCollections(db);

  let targetTile = null;
  if (typeof tileIdOrTile === "string") {
    targetTile = coll.tiles.find(t => t.id === tileIdOrTile) || null;
  } else if (tileIdOrTile && typeof tileIdOrTile === "object") {
    targetTile = tileIdOrTile;
  }

  if (!targetTile) {
    return {
      error: "tile_not_found",
      message: typeof tileIdOrTile === "string" ? `找不到试片: ${tileIdOrTile}` : "无效的试片数据"
    };
  }

  const allTiles = coll.tiles || [];
  const dataQuality = {
    totalHistoryTiles: allTiles.length,
    hasScore: targetTile.score && Number(targetTile.score) > 0,
    hasRecipe: !!targetTile.recipe && targetTile.recipe.trim().length > 0,
    hasAshSource: !!targetTile.ashSource && targetTile.ashSource.trim().length > 0,
    hasKiln: !!targetTile.kiln && targetTile.kiln.trim().length > 0,
    hasPeakTemp: !!targetTile.peakTemp && Number(targetTile.peakTemp) > 0,
    hasFiringCurve: Array.isArray(targetTile.firingCurve) && targetTile.firingCurve.length > 0,
    hasDefects: getTileDefects(targetTile).length > 0,
    recipeParseable: parseIngredients(targetTile.recipe || "").length > 0,
    warnings: []
  };

  if (allTiles.length < 10) {
    dataQuality.warnings.push(`历史数据量较小（仅 ${allTiles.length} 片），统计规律置信度偏低，建议结合经验判断`);
  }
  if (!dataQuality.hasScore) {
    dataQuality.warnings.push("当前试片尚未评分，推荐依据缺陷标签和参数分析");
  }
  if (dataQuality.hasRecipe && !dataQuality.recipeParseable) {
    dataQuality.warnings.push("配方文本格式不规范，原料占比无法精确解析，建议使用 '原料名+百分比' 空格分隔格式");
  }
  if (!dataQuality.hasPeakTemp) {
    dataQuality.warnings.push("峰值温度缺失，烧成参数分析受限，建议补充记录");
  }
  if (!dataQuality.hasFiringCurve && dataQuality.hasPeakTemp) {
    dataQuality.warnings.push("仅有峰值温度缺少完整烧成曲线，升温/冷却速率分析受限");
  }
  if (!dataQuality.hasAshSource) {
    dataQuality.warnings.push("灰源信息缺失，无法评估灰源相关影响");
  }

  const similarResult = findSimilarSuccessTiles(targetTile, allTiles, {
    topN: options.topSimilar || 5,
    minSimilarity: options.minSimilarity || 25
  });

  const riskAnalysis = analyzeRiskFactors(targetTile, allTiles);
  const recipeRecs = generateRecipeRecommendations(targetTile, similarResult.tiles, allTiles);
  const firingRecs = generateFiringRecommendations(targetTile, similarResult.tiles);
  const defectPatterns = analyzeDefectPatterns(targetTile, allTiles);
  const overallSummary = buildOverallSummary(targetTile, similarResult, riskAnalysis, recipeRecs, firingRecs, defectPatterns);

  const firingInput = parseFiringInputFromTile(targetTile);
  const firingContext = {
    peakTemp: firingInput.peakTemp || null,
    kiln: firingInput.kiln || null,
    holdMinutes: firingInput.holdMinutes || 0,
    heatingStagesCount: firingInput.heatingStages.length,
    hasCompleteCurve: dataQuality.hasFiringCurve
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      tileId: targetTile.id,
      options,
      dataQuality
    },
    targetTile: {
      id: targetTile.id,
      body: targetTile.body,
      recipe: targetTile.recipe,
      parsedIngredients: parseIngredients(targetTile.recipe || ""),
      ashSource: targetTile.ashSource,
      kiln: targetTile.kiln,
      peakTemp: targetTile.peakTemp,
      color: targetTile.color,
      defects: targetTile.defects,
      defectTags: targetTile.defectTags || [],
      defectNames: defectPatterns.currentDefects.map(d => d.name),
      score: targetTile.score,
      glazeThickness: targetTile.glazeThickness,
      firingContext,
      observations: targetTile.observations || []
    },
    overallSummary,
    similarSuccessfulTiles: {
      query: similarResult.searchQuery,
      searchPoolSize: similarResult.searchPoolSize || 0,
      successPoolSize: similarResult.successPoolSize || 0,
      count: similarResult.tiles.length,
      tiles: similarResult.tiles,
      notes: similarResult.notes || undefined
    },
    riskFactors: {
      totalRiskCount: riskAnalysis.risks.length,
      dangerCount: riskAnalysis.risks.filter(r => r.level === "danger").length,
      warningCount: riskAnalysis.risks.filter(r => r.level === "warning").length,
      infoCount: riskAnalysis.risks.filter(r => r.level === "info").length,
      risks: riskAnalysis.risks,
      evidence: riskAnalysis.evidence
    },
    defectPatterns,
    recipeRecommendations: {
      count: recipeRecs.recommendations.length,
      recommendations: recipeRecs.recommendations,
      evidenceBasis: recipeRecs.evidenceBasis
    },
    firingRecommendations: {
      count: firingRecs.recommendations.length,
      recommendations: firingRecs.recommendations,
      evidenceBasis: firingRecs.evidenceBasis
    },
    allEvidence: [
      ...recipeRecs.evidenceBasis,
      ...firingRecs.evidenceBasis,
      ...riskAnalysis.evidence.map(e => ({ rule: e.type, source: "历史统计数据", ...e }))
    ]
  };
}

export {
  findSimilarSuccessTiles,
  analyzeRiskFactors,
  generateRecipeRecommendations,
  generateFiringRecommendations,
  analyzeDefectPatterns,
  DEFECT_REMEDY_RULES,
  ASH_SOURCE_PATTERNS,
  LOW_SCORE_THRESHOLD,
  HIGH_SCORE_THRESHOLD,
  parseFiringInputFromTile,
  getTileDefects
};
