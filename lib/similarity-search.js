const WEIGHTS = {
  body: 20,
  ashSource: 20,
  peakTemp: 25,
  recipe: 20,
  colorKeywords: 7,
  defectKeywords: 5,
  score: 3
};

const TEMP_WEIGHT_NEAR = 1.0;
const TEMP_WEIGHT_MID = 0.5;
const TEMP_WEIGHT_FAR = 0.1;
const TEMP_THRESHOLD_NEAR = 20;
const TEMP_THRESHOLD_MID = 50;

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[，,。.;；:：！!？?、]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function extractIngredientNames(recipeText) {
  if (!recipeText) return [];
  const tokens = tokenize(recipeText);
  const names = [];
  for (const tok of tokens) {
    const m = tok.match(/^([^\d.]+)/);
    if (m && m[1]) names.push(m[1]);
  }
  return names;
}

function parseKeywords(keywords) {
  if (!keywords) return [];
  if (Array.isArray(keywords)) return keywords.map(k => String(k).trim()).filter(Boolean);
  return tokenize(keywords);
}

function calcBodyMatch(queryBody, tileBody) {
  if (!queryBody) return { matched: false, score: 0, reason: null };
  if (!tileBody) return { matched: false, score: 0, reason: null };
  const q = String(queryBody).trim();
  const t = String(tileBody).trim();
  if (q === t) {
    return { matched: true, score: 100, reason: `坯体完全匹配: "${q}"` };
  }
  if (t.includes(q) || q.includes(t)) {
    return { matched: true, score: 70, reason: `坯体部分匹配: 查询"${q}" vs 历史"${t}"` };
  }
  return { matched: false, score: 0, reason: `坯体不匹配: 查询"${q}" vs 历史"${t}"` };
}

function calcAshSourceMatch(queryAsh, tileAsh) {
  if (!queryAsh) return { matched: false, score: 0, reason: null };
  if (!tileAsh) return { matched: false, score: 0, reason: null };
  const q = String(queryAsh).trim();
  const t = String(tileAsh).trim();
  if (q === t) {
    return { matched: true, score: 100, reason: `香灰来源完全匹配: "${q}"` };
  }
  const qTokens = tokenize(q);
  const tTokens = tokenize(t);
  const overlap = qTokens.filter(tk => tTokens.includes(tk));
  if (overlap.length > 0) {
    const ratio = (overlap.length * 2) / (qTokens.length + tTokens.length);
    return {
      matched: true,
      score: Math.round(ratio * 80),
      reason: `香灰来源部分匹配: 共有词[${overlap.join("、")}]，重合度${(ratio * 100).toFixed(0)}%`
    };
  }
  return { matched: false, score: 0, reason: `香灰来源不匹配: 查询"${q}" vs 历史"${t}"` };
}

function calcPeakTempDiff(queryTemp, tileTemp) {
  if (!queryTemp || queryTemp <= 0) return { diff: null, score: 0, reason: null };
  if (!tileTemp || tileTemp <= 0) return { diff: null, score: 0, reason: null };
  const q = Number(queryTemp);
  const t = Number(tileTemp);
  const diff = Math.abs(q - t);

  let weight;
  if (diff <= TEMP_THRESHOLD_NEAR) {
    weight = TEMP_WEIGHT_NEAR;
  } else if (diff <= TEMP_THRESHOLD_MID) {
    weight = TEMP_WEIGHT_MID;
  } else {
    weight = TEMP_WEIGHT_FAR;
  }

  let score;
  if (diff === 0) {
    score = 100;
  } else if (diff <= TEMP_THRESHOLD_NEAR) {
    score = Math.round(100 - (diff / TEMP_THRESHOLD_NEAR) * 30);
  } else if (diff <= TEMP_THRESHOLD_MID) {
    score = Math.round(70 - ((diff - TEMP_THRESHOLD_NEAR) / (TEMP_THRESHOLD_MID - TEMP_THRESHOLD_NEAR)) * 40);
  } else {
    score = Math.max(0, Math.round(30 - ((diff - TEMP_THRESHOLD_MID) / 100) * 30));
  }

  let level;
  if (diff === 0) level = "完全一致";
  else if (diff <= TEMP_THRESHOLD_NEAR) level = "非常接近";
  else if (diff <= TEMP_THRESHOLD_MID) level = "接近";
  else level = "差异较大";

  return {
    diff,
    score,
    weight,
    reason: `峰值温度${level}: 查询${q}℃ vs 历史${t}℃，温差${diff}℃`
  };
}

function calcRecipeSimilarity(queryRecipe, tileRecipe) {
  if (!queryRecipe) return { overlapRatio: 0, matchedIngredients: [], score: 0, reason: null };
  if (!tileRecipe) return { overlapRatio: 0, matchedIngredients: [], score: 0, reason: null };

  const qIngredients = extractIngredientNames(queryRecipe);
  const tIngredients = extractIngredientNames(tileRecipe);

  if (qIngredients.length === 0 || tIngredients.length === 0) {
    return { overlapRatio: 0, matchedIngredients: [], score: 0, reason: null };
  }

  const matched = [];
  for (const qi of qIngredients) {
    for (const ti of tIngredients) {
      if (qi === ti || ti.includes(qi) || qi.includes(ti)) {
        if (!matched.includes(qi)) matched.push(qi);
        break;
      }
    }
  }

  const overlapRatio = matched.length / Math.max(qIngredients.length, tIngredients.length);
  const score = Math.round(overlapRatio * 100);

  return {
    overlapRatio,
    matchedIngredients: matched,
    score,
    reason: matched.length > 0
      ? `配方原料重合: 共有[${matched.join("、")}]，重合度${(overlapRatio * 100).toFixed(0)}% (查询${qIngredients.length}种 vs 历史${tIngredients.length}种)`
      : `配方无共同原料: 查询[${qIngredients.join("、")}] vs 历史[${tIngredients.join("、")}]`
  };
}

function calcKeywordMatch(queryKeywords, tileField, fieldName) {
  const keywords = parseKeywords(queryKeywords);
  if (keywords.length === 0) return { matchedKeywords: [], score: 0, reason: null };
  if (!tileField) return { matchedKeywords: [], score: 0, reason: `${fieldName}关键词未命中` };

  const tileText = String(tileField).toLowerCase();
  const matched = keywords.filter(kw => tileText.includes(String(kw).toLowerCase()));

  if (matched.length === 0) {
    return {
      matchedKeywords: [],
      score: 0,
      reason: `${fieldName}关键词未命中: [${keywords.join("、")}]`
    };
  }

  const ratio = matched.length / keywords.length;
  const score = Math.round(ratio * 100);

  return {
    matchedKeywords: matched,
    score,
    reason: `${fieldName}关键词命中[${matched.join("、")}]，覆盖率${(ratio * 100).toFixed(0)}%`
  };
}

function calcScoreDiff(queryScore, tileScore) {
  if (queryScore === undefined || queryScore === null || Number(queryScore) <= 0) {
    return { diff: null, score: 0, reason: null };
  }
  if (!tileScore || Number(tileScore) <= 0) {
    return { diff: null, score: 0, reason: null };
  }
  const q = Number(queryScore);
  const t = Number(tileScore);
  const diff = Math.abs(q - t);
  const score = Math.max(0, Math.round(100 - diff * 2));

  return {
    diff,
    score,
    reason: `评分差${diff}分: 查询${q}分 vs 历史${t}分`
  };
}

export function findSimilarTiles(query, allTiles, options = {}) {
  const topN = options.topN || 5;
  const minScore = options.minScore || 0;

  if (!allTiles || allTiles.length === 0) {
    return { query, results: [], explanations: [] };
  }

  const results = [];

  for (const tile of allTiles) {
    const bodyResult = calcBodyMatch(query.body, tile.body);
    const ashResult = calcAshSourceMatch(query.ashSource, tile.ashSource);
    const tempResult = calcPeakTempDiff(query.peakTemp, tile.peakTemp);
    const recipeResult = calcRecipeSimilarity(query.recipe, tile.recipe);
    const colorResult = calcKeywordMatch(query.colorKeywords || query.color, tile.color, "颜色");
    const defectResult = calcKeywordMatch(query.defectKeywords || query.defects, tile.defects, "缺陷");
    const scoreResult = calcScoreDiff(query.score, tile.score);

    const reasons = [];
    let weightedSum = 0;
    let totalWeight = 0;

    if (query.body) {
      weightedSum += bodyResult.score * WEIGHTS.body;
      totalWeight += WEIGHTS.body;
      if (bodyResult.reason) reasons.push(bodyResult.reason);
    }

    if (query.ashSource) {
      weightedSum += ashResult.score * WEIGHTS.ashSource;
      totalWeight += WEIGHTS.ashSource;
      if (ashResult.reason) reasons.push(ashResult.reason);
    }

    if (query.peakTemp && query.peakTemp > 0) {
      const tempWeight = (tempResult.weight !== undefined ? tempResult.weight : 1) * WEIGHTS.peakTemp;
      weightedSum += tempResult.score * tempWeight;
      totalWeight += tempWeight;
      if (tempResult.reason) reasons.push(tempResult.reason);
    }

    if (query.recipe) {
      weightedSum += recipeResult.score * WEIGHTS.recipe;
      totalWeight += WEIGHTS.recipe;
      if (recipeResult.reason) reasons.push(recipeResult.reason);
    }

    if (query.colorKeywords || query.color) {
      weightedSum += colorResult.score * WEIGHTS.colorKeywords;
      totalWeight += WEIGHTS.colorKeywords;
      if (colorResult.reason) reasons.push(colorResult.reason);
    }

    if (query.defectKeywords || query.defects) {
      weightedSum += defectResult.score * WEIGHTS.defectKeywords;
      totalWeight += WEIGHTS.defectKeywords;
      if (defectResult.reason) reasons.push(defectResult.reason);
    }

    if (query.score && query.score > 0) {
      weightedSum += scoreResult.score * WEIGHTS.score;
      totalWeight += WEIGHTS.score;
      if (scoreResult.reason) reasons.push(scoreResult.reason);
    }

    const similarityScore = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(1)) : 0;

    if (similarityScore < minScore) continue;

    const fieldMatches = {
      body: bodyResult.matched,
      ashSource: ashResult.matched,
      peakTemp: tempResult.diff !== null ? tempResult.diff : null,
      recipe: recipeResult.matchedIngredients,
      colorKeywords: colorResult.matchedKeywords,
      defectKeywords: defectResult.matchedKeywords,
      score: scoreResult.diff !== null ? scoreResult.diff : null
    };

    const details = {
      bodyScore: bodyResult.score,
      ashSourceScore: ashResult.score,
      peakTempScore: tempResult.score,
      peakTempDiff: tempResult.diff,
      recipeScore: recipeResult.score,
      recipeOverlapRatio: recipeResult.overlapRatio,
      colorKeywordsScore: colorResult.score,
      defectKeywordsScore: defectResult.score,
      scoreDiff: scoreResult.diff,
      scoreDiffScore: scoreResult.score
    };

    results.push({
      tile,
      similarityScore,
      reasons,
      fieldMatches,
      details
    });
  }

  results.sort((a, b) => b.similarityScore - a.similarityScore);

  return {
    query,
    results: results.slice(0, topN),
    weights: WEIGHTS
  };
}
