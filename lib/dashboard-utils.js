const PEAK_TEMP_RANGES = [
  { label: "< 1200°C", min: 0, max: 1199.99 },
  { label: "1200-1220°C", min: 1200, max: 1219.99 },
  { label: "1220-1240°C", min: 1220, max: 1239.99 },
  { label: "1240-1260°C", min: 1240, max: 1259.99 },
  { label: "1260-1280°C", min: 1260, max: 1279.99 },
  { label: "≥ 1280°C", min: 1280, max: Infinity }
];

export function getPeakTempRanges() {
  return PEAK_TEMP_RANGES.map(r => ({ label: r.label, min: r.min, max: isFinite(r.max) ? r.max : null }));
}

export function classifyPeakTemp(peakTemp) {
  const t = Number(peakTemp) || 0;
  for (const range of PEAK_TEMP_RANGES) {
    if (t >= range.min && t <= range.max) return range.label;
  }
  return PEAK_TEMP_RANGES[PEAK_TEMP_RANGES.length - 1].label;
}

export function collectRecentObservations(tiles, daysBack = 30, limit = 10) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const all = [];
  for (const tile of tiles) {
    if (!Array.isArray(tile.observations)) continue;
    for (const obs of tile.observations) {
      if (!obs || !obs.at) continue;
      const atStr = String(obs.at).slice(0, 10);
      if (atStr >= cutoffStr) {
        all.push({
          tileId: tile.id,
          tileBody: tile.body || "",
          ashSource: tile.ashSource || "",
          kiln: tile.kiln || "",
          at: atStr,
          note: obs.note || ""
        });
      }
    }
  }

  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, limit);
}

export function groupByAshSourceWithScores(tiles) {
  const groups = {};
  for (const tile of tiles) {
    const source = tile.ashSource || "未指定";
    if (!groups[source]) {
      groups[source] = {
        ashSource: source,
        tileCount: 0,
        totalScore: 0,
        scoredCount: 0,
        tilesWithDefects: 0,
        defectCount: 0
      };
    }
    groups[source].tileCount++;
    const score = Number(tile.score);
    if (!isNaN(score) && score > 0) {
      groups[source].totalScore += score;
      groups[source].scoredCount++;
    }
    const tags = tile.defectTags || [];
    if (tags.length > 0) {
      groups[source].tilesWithDefects++;
      groups[source].defectCount += tags.length;
    }
  }

  return Object.values(groups)
    .map(g => ({
      ashSource: g.ashSource,
      tileCount: g.tileCount,
      averageScore: g.scoredCount > 0 ? Number((g.totalScore / g.scoredCount).toFixed(1)) : null,
      scoredCount: g.scoredCount,
      tilesWithDefects: g.tilesWithDefects,
      defectRate: g.tileCount > 0 ? Number(((g.tilesWithDefects / g.tileCount) * 100).toFixed(1)) : 0,
      defectDensity: g.tileCount > 0 ? Number((g.defectCount / g.tileCount).toFixed(2)) : 0
    }))
    .sort((a, b) => b.tileCount - a.tileCount);
}

export function groupDefectsByPeakTemp(tiles) {
  const buckets = {};
  for (const range of PEAK_TEMP_RANGES) {
    buckets[range.label] = {
      range: range.label,
      tileCount: 0,
      tilesWithDefects: 0,
      totalDefects: 0,
      bySeverity: { mild: 0, medium: 0, severe: 0 },
      byDefect: {}
    };
  }

  for (const tile of tiles) {
    const label = classifyPeakTemp(tile.peakTemp);
    const bucket = buckets[label];
    if (!bucket) continue;

    bucket.tileCount++;
    const tags = tile.defectTags || [];
    if (tags.length > 0) {
      bucket.tilesWithDefects++;
    }
    for (const tag of tags) {
      bucket.totalDefects++;
      const sev = tag.severity || "medium";
      if (bucket.bySeverity[sev] !== undefined) bucket.bySeverity[sev]++;
      const name = tag.name || "未分类";
      bucket.byDefect[name] = (bucket.byDefect[name] || 0) + 1;
    }
  }

  return PEAK_TEMP_RANGES.map(r => {
    const b = buckets[r.label];
    return {
      range: b.range,
      tileCount: b.tileCount,
      tilesWithDefects: b.tilesWithDefects,
      defectRate: b.tileCount > 0 ? Number(((b.tilesWithDefects / b.tileCount) * 100).toFixed(1)) : 0,
      totalDefects: b.totalDefects,
      averageDefectsPerTile: b.tileCount > 0 ? Number((b.totalDefects / b.tileCount).toFixed(2)) : 0,
      bySeverity: Object.entries(b.bySeverity).map(([key, count]) => ({ key, count })),
      topDefects: Object.entries(b.byDefect)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    };
  });
}

export function findLowScoreTiles(tiles, threshold = 75, limit = 10) {
  const scored = tiles
    .filter(t => {
      const s = Number(t.score);
      return !isNaN(s) && s > 0 && s <= threshold;
    })
    .map(t => {
      const defectCount = (t.defectTags || []).length;
      const hasSevere = (t.defectTags || []).some(d => d.severity === "severe");
      const latestObs = Array.isArray(t.observations) && t.observations.length > 0
        ? t.observations[t.observations.length - 1]
        : null;
      return {
        id: t.id,
        body: t.body || "",
        recipe: t.recipe || "",
        ashSource: t.ashSource || "",
        kiln: t.kiln || "",
        peakTemp: Number(t.peakTemp) || 0,
        color: t.color || "",
        score: Number(t.score),
        defects: t.defects || "",
        defectTags: t.defectTags || [],
        defectCount,
        hasSevere,
        latestObservation: latestObs
          ? { at: String(latestObs.at).slice(0, 10), note: latestObs.note || "" }
          : null,
        attentionScore: calcAttentionScore(t)
      };
    });

  scored.sort((a, b) => {
    if (b.hasSevere !== a.hasSevere) return b.hasSevere ? 1 : -1;
    if (b.attentionScore !== a.attentionScore) return b.attentionScore - a.attentionScore;
    return a.score - b.score;
  });

  return scored.slice(0, limit);
}

function calcAttentionScore(tile) {
  let score = 0;
  const s = Number(tile.score) || 0;
  if (s > 0) {
    if (s <= 60) score += 40;
    else if (s <= 70) score += 30;
    else if (s <= 75) score += 20;
  }
  const tags = tile.defectTags || [];
  for (const tag of tags) {
    if (tag.severity === "severe") score += 25;
    else if (tag.severity === "medium") score += 10;
    else score += 3;
  }
  return score;
}

export function computeTotalStats(tiles) {
  const totalTiles = tiles.length;
  let totalScore = 0;
  let scoredCount = 0;
  let tilesWithDefects = 0;
  let totalDefectCount = 0;

  for (const tile of tiles) {
    const s = Number(tile.score);
    if (!isNaN(s) && s > 0) {
      totalScore += s;
      scoredCount++;
    }
    const tags = tile.defectTags || [];
    if (tags.length > 0) tilesWithDefects++;
    totalDefectCount += tags.length;
  }

  const avgScore = scoredCount > 0 ? Number((totalScore / scoredCount).toFixed(1)) : null;
  const defectRate = totalTiles > 0 ? Number(((tilesWithDefects / totalTiles) * 100).toFixed(1)) : 0;

  const scoreDistribution = {
    excellent: 0,
    good: 0,
    pass: 0,
    low: 0,
    unscored: 0
  };
  for (const tile of tiles) {
    const s = Number(tile.score);
    if (isNaN(s) || s <= 0) {
      scoreDistribution.unscored++;
    } else if (s >= 85) {
      scoreDistribution.excellent++;
    } else if (s >= 75) {
      scoreDistribution.good++;
    } else if (s >= 60) {
      scoreDistribution.pass++;
    } else {
      scoreDistribution.low++;
    }
  }

  return {
    totalTiles,
    scoredCount,
    unscoredCount: totalTiles - scoredCount,
    averageScore: avgScore,
    scoreDistribution,
    tilesWithDefects,
    defectRate,
    totalDefectCount,
    averageDefectsPerTile: totalTiles > 0 ? Number((totalDefectCount / totalTiles).toFixed(2)) : 0
  };
}
