const KILN_PROFILES = {
  "K-1": { minTemp: 1180, maxTemp: 1280, maxHeatingRate: 180, name: "小型电窑" },
  "K-2": { minTemp: 1200, maxTemp: 1300, maxHeatingRate: 200, name: "中型气窑" },
  "K-3": { minTemp: 1220, maxTemp: 1320, maxHeatingRate: 220, name: "大型柴窑" }
};

const DEFAULT_KILN = { minTemp: 1100, maxTemp: 1350, maxHeatingRate: 200, name: "未知窑炉" };

const ROOM_TEMP = 25;

function getKilnProfile(kiln) {
  return KILN_PROFILES[kiln] || DEFAULT_KILN;
}

export function normalizeFiringCurve(input) {
  const { peakTemp, heatingStages = [], holdMinutes = 0 } = input;
  const curve = [];
  let currentTemp = ROOM_TEMP;
  let currentMinutes = 0;

  curve.push({ temp: currentTemp, minutes: currentMinutes });

  if (Array.isArray(heatingStages) && heatingStages.length > 0) {
    for (const stage of heatingStages) {
      const endTemp = Number(stage.endTemp || stage.temp || 0);
      const rate = Number(stage.rate || 0);
      const minutes = Number(stage.minutes || 0);

      if (endTemp <= currentTemp) continue;

      let stageMinutes = minutes;
      if (!stageMinutes && rate > 0) {
        stageMinutes = Math.round((endTemp - currentTemp) / rate * 60);
      }
      if (!stageMinutes) {
        stageMinutes = Math.round((endTemp - currentTemp) / 150 * 60);
      }

      currentMinutes += stageMinutes;
      currentTemp = endTemp;
      curve.push({ temp: currentTemp, minutes: currentMinutes });
    }
  } else {
    const defaultStages = [
      { endTemp: 600, rate: 180 },
      { endTemp: 900, rate: 150 },
      { endTemp: 1100, rate: 120 }
    ];
    for (const stage of defaultStages) {
      const endTemp = Math.min(stage.endTemp, peakTemp);
      if (endTemp <= currentTemp) continue;
      const stageMinutes = Math.round((endTemp - currentTemp) / stage.rate * 60);
      currentMinutes += stageMinutes;
      currentTemp = endTemp;
      curve.push({ temp: currentTemp, minutes: currentMinutes });
    }
  }

  if (peakTemp > currentTemp) {
    const diff = peakTemp - currentTemp;
    const defaultRate = 100;
    const stageMinutes = Math.round(diff / defaultRate * 60);
    currentMinutes += stageMinutes;
    currentTemp = peakTemp;
    curve.push({ temp: currentTemp, minutes: currentMinutes });
  }

  if (holdMinutes > 0) {
    currentMinutes += holdMinutes;
    curve.push({ temp: currentTemp, minutes: currentMinutes });
  }

  const deduped = [];
  const seenTimes = new Set();
  for (const p of curve) {
    if (!seenTimes.has(p.minutes)) {
      deduped.push(p);
      seenTimes.add(p.minutes);
    }
  }

  return deduped.sort((a, b) => a.minutes - b.minutes);
}

export function generateRisks(input, normalizedCurve) {
  const risks = [];
  const { peakTemp, kiln, holdMinutes = 0, heatingStages = [] } = input;
  const profile = getKilnProfile(kiln);

  if (peakTemp < 1000) {
    risks.push({ level: "warning", code: "PEAK_TEMP_LOW", message: "峰值温度 " + peakTemp + "℃ 偏低，釉料可能未能充分熔融" });
  } else if (peakTemp > profile.maxTemp) {
    risks.push({ level: "danger", code: "PEAK_TEMP_EXCEED_KILN", message: "峰值温度 " + peakTemp + "℃ 超过 " + profile.name + "(" + kiln + ") 上限 " + profile.maxTemp + "℃，存在窑炉受损或坯体起泡风险" });
  } else if (peakTemp < profile.minTemp) {
    risks.push({ level: "warning", code: "PEAK_TEMP_BELOW_KILN", message: "峰值温度 " + peakTemp + "℃ 低于 " + profile.name + "(" + kiln + ") 常规下限 " + profile.minTemp + "℃，需确认釉料适配性" });
  }

  if (peakTemp > 1320) {
    risks.push({ level: "danger", code: "PEAK_TEMP_EXTREME", message: "峰值温度 " + peakTemp + "℃ 过高，可能导致坯体过烧变形或釉面流淌" });
  }

  if (holdMinutes > 90) {
    risks.push({ level: "warning", code: "HOLD_TOO_LONG", message: "保温时间 " + holdMinutes + " 分钟过长，可能导致釉面失透或产生气泡" });
  } else if (holdMinutes < 10 && peakTemp >= 1200) {
    risks.push({ level: "warning", code: "HOLD_TOO_SHORT", message: "保温时间 " + holdMinutes + " 分钟偏短，高温釉料可能未能充分反应" });
  }

  const heatingRates = calcHeatingRates(normalizedCurve);
  for (let i = 0; i < heatingRates.length; i++) {
    const r = heatingRates[i];
    if (r.rateCelsiusPerHour > profile.maxHeatingRate) {
      risks.push({
        level: "danger",
        code: "HEATING_RATE_TOO_FAST",
        message: r.from + "℃→" + r.to + "℃ 阶段升温速率 " + r.rateCelsiusPerHour + "℃/h 超过窑炉上限 " + profile.maxHeatingRate + "℃/h，坯体可能炸裂"
      });
    }
    if (i === 0 && r.from <= 300 && r.rateCelsiusPerHour > 100) {
      risks.push({
        level: "warning",
        code: "INITIAL_HEATING_FAST",
        message: "低温阶段升温速率 " + r.rateCelsiusPerHour + "℃/h 偏快，坯体残余水分可能导致开裂"
      });
    }
  }

  if (!kiln || !KILN_PROFILES[kiln]) {
    risks.push({ level: "info", code: "KILN_UNKNOWN", message: "窑炉编号未在系统登记，使用通用安全阈值评估" });
  }

  if (heatingStages.length === 0) {
    risks.push({ level: "info", code: "USING_DEFAULT_STAGES", message: "未提供升温阶段，使用默认三段升温曲线" });
  }

  const totalMinutes = calcTotalDuration(normalizedCurve);
  if (totalMinutes > 900) {
    risks.push({ level: "info", code: "LONG_FIRING_CYCLE", message: "烧成周期约 " + (totalMinutes / 60).toFixed(1) + " 小时，属长周期烧成，需关注能耗" });
  }

  return risks;
}

function interpTempAtMinutes(curve, targetMinutes) {
  if (curve.length === 0) return 0;
  if (targetMinutes <= curve[0].minutes) return curve[0].temp;
  if (targetMinutes >= curve[curve.length - 1].minutes) return curve[curve.length - 1].temp;

  for (let i = 1; i < curve.length; i++) {
    if (curve[i].minutes === targetMinutes) return curve[i].temp;
    if (curve[i].minutes > targetMinutes) {
      const prev = curve[i - 1];
      const curr = curve[i];
      const ratio = (targetMinutes - prev.minutes) / (curr.minutes - prev.minutes);
      return prev.temp + ratio * (curr.temp - prev.temp);
    }
  }
  return curve[curve.length - 1].temp;
}

function curveDistance(curveA, curveB) {
  const maxMinutes = Math.max(
    curveA[curveA.length - 1]?.minutes || 0,
    curveB[curveB.length - 1]?.minutes || 0
  );
  if (maxMinutes === 0) return 0;

  const step = 15;
  let sumDiff = 0;
  let count = 0;
  for (let m = 0; m <= maxMinutes; m += step) {
    const tempA = interpTempAtMinutes(curveA, m);
    const tempB = interpTempAtMinutes(curveB, m);
    sumDiff += Math.abs(tempA - tempB);
    count++;
  }
  return count > 0 ? sumDiff / count : 0;
}

export function findSimilarCurves(input, normalizedCurve, tiles, limit) {
  if (!tiles || tiles.length === 0) return [];
  if (!limit) limit = 3;

  const scored = tiles
    .filter(function(t) { return Array.isArray(t.firingCurve) && t.firingCurve.length > 0; })
    .map(function(t) {
      const tileCurve = Array.isArray(t.firingCurve) ? t.firingCurve : [];
      const distance = curveDistance(normalizedCurve, tileCurve);
      const peakDiff = Math.abs((t.peakTemp || 0) - input.peakTemp);
      const kilnMatch = t.kiln && input.kiln && t.kiln === input.kiln ? 0 : 30;
      const totalScore = distance * 0.8 + Math.abs(peakDiff) * 0.3 + kilnMatch;
      const similarity = Math.max(0, 100 - totalScore * 0.3);
      return { tile: t, distance: distance, peakDiff: peakDiff, similarity: Number(similarity.toFixed(1)) };
    })
    .sort(function(a, b) { return b.similarity - a.similarity; });

  return scored.slice(0, limit).map(function(r) {
    return {
      tileId: r.tile.id,
      tileRecipe: r.tile.recipe,
      tileKiln: r.tile.kiln,
      tilePeakTemp: r.tile.peakTemp,
      tileScore: r.tile.score,
      tileColor: r.tile.color,
      tileDefects: r.tile.defects,
      tileFiringCurve: r.tile.firingCurve,
      similarity: r.similarity,
      peakTempDiff: Math.abs(r.peakDiff)
    };
  });
}

export function calcTotalDuration(normalizedCurve) {
  if (!normalizedCurve || normalizedCurve.length === 0) return 0;
  return normalizedCurve[normalizedCurve.length - 1].minutes;
}

export function calcHeatingRates(normalizedCurve) {
  const rates = [];
  for (let i = 1; i < normalizedCurve.length; i++) {
    const prev = normalizedCurve[i - 1];
    const curr = normalizedCurve[i];
    const tempDiff = curr.temp - prev.temp;
    const timeDiff = curr.minutes - prev.minutes;
    if (timeDiff > 0 && tempDiff > 0) {
      rates.push({
        from: prev.temp,
        to: curr.temp,
        rateCelsiusPerHour: Number((tempDiff / (timeDiff / 60)).toFixed(0))
      });
    }
  }
  return rates;
}

export { KILN_PROFILES };
