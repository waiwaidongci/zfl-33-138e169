const KILN_PROFILES = {
  "K-1": { minTemp: 1180, maxTemp: 1280, maxHeatingRate: 180, name: "小型电窑" },
  "K-2": { minTemp: 1200, maxTemp: 1300, maxHeatingRate: 200, name: "中型气窑" },
  "K-3": { minTemp: 1220, maxTemp: 1320, maxHeatingRate: 220, name: "大型柴窑" }
};

const DEFAULT_KILN = { minTemp: 1100, maxTemp: 1350, maxHeatingRate: 200, name: "未知窑炉" };

function getKilnProfile(kiln) {
  return KILN_PROFILES[kiln] || DEFAULT_KILN;
}

export function normalizeFiringCurve(input) {
  const { peakTemp, heatingStages = [], holdMinutes = 30, kiln } = input;
  const stages = [];
  const prevTemp = 25;

  if (Array.isArray(heatingStages) && heatingStages.length > 0) {
    let currentTemp = prevTemp;
    for (const stage of heatingStages) {
      const endTemp = Number(stage.endTemp || stage.temp || 0);
      const rate = Number(stage.rate || 0);
      const minutes = Number(stage.minutes || 0);
      if (endTemp <= currentTemp) continue;
      let calcMinutes = minutes;
      if (!calcMinutes && rate > 0) {
        calcMinutes = Math.round((endTemp - currentTemp) / rate * 60);
      }
      if (!calcMinutes) {
        calcMinutes = Math.round((endTemp - currentTemp) / 150 * 60);
      }
      stages.push({ temp: endTemp, minutes: calcMinutes });
      currentTemp = endTemp;
    }
    const lastStageTemp = stages.length > 0 ? stages[stages.length - 1].temp : prevTemp;
    if (peakTemp > lastStageTemp) {
      const diff = peakTemp - lastStageTemp;
      const defaultRate = 120;
      stages.push({ temp: peakTemp, minutes: Math.round(diff / defaultRate * 60) });
    }
  } else {
    stages.push({ temp: 600, minutes: 180 });
    stages.push({ temp: 900, minutes: 120 });
    stages.push({ temp: Math.min(peakTemp, 1100), minutes: 90 });
    if (peakTemp > 1100) {
      stages.push({ temp: peakTemp, minutes: Math.round((peakTemp - 1100) / 80 * 60) });
    }
  }

  if (holdMinutes > 0) {
    const lastIdx = stages.length - 1;
    if (lastIdx >= 0 && stages[lastIdx].temp === peakTemp) {
      stages[lastIdx].minutes += holdMinutes;
    } else {
      stages.push({ temp: peakTemp, minutes: holdMinutes });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (let i = stages.length - 1; i >= 0; i--) {
    if (!seen.has(stages[i].temp)) {
      deduped.unshift(stages[i]);
      seen.add(stages[i].temp);
    }
  }

  return deduped.sort((a, b) => a.temp - b.temp);
}

export function generateRisks(input, normalizedCurve) {
  const risks = [];
  const { peakTemp, kiln, holdMinutes = 0, heatingStages = [] } = input;
  const profile = getKilnProfile(kiln);

  if (peakTemp < 1000) {
    risks.push({ level: "warning", code: "PEAK_TEMP_LOW", message: `峰值温度 ${peakTemp}℃ 偏低，釉料可能未能充分熔融` });
  } else if (peakTemp > profile.maxTemp) {
    risks.push({ level: "danger", code: "PEAK_TEMP_EXCEED_KILN", message: `峰值温度 ${peakTemp}℃ 超过 ${profile.name}(${kiln}) 上限 ${profile.maxTemp}℃，存在窑炉受损或坯体起泡风险` });
  } else if (peakTemp < profile.minTemp) {
    risks.push({ level: "warning", code: "PEAK_TEMP_BELOW_KILN", message: `峰值温度 ${peakTemp}℃ 低于 ${profile.name}(${kiln}) 常规下限 ${profile.minTemp}℃，需确认釉料适配性` });
  }

  if (peakTemp > 1320) {
    risks.push({ level: "danger", code: "PEAK_TEMP_EXTREME", message: `峰值温度 ${peakTemp}℃ 过高，可能导致坯体过烧变形或釉面流淌` });
  }

  if (holdMinutes > 90) {
    risks.push({ level: "warning", code: "HOLD_TOO_LONG", message: `保温时间 ${holdMinutes} 分钟过长，可能导致釉面失透或产生气泡` });
  } else if (holdMinutes < 10 && peakTemp >= 1200) {
    risks.push({ level: "warning", code: "HOLD_TOO_SHORT", message: `保温时间 ${holdMinutes} 分钟偏短，高温釉料可能未能充分反应` });
  }

  if (normalizedCurve.length >= 2) {
    for (let i = 1; i < normalizedCurve.length; i++) {
      const prev = normalizedCurve[i - 1];
      const curr = normalizedCurve[i];
      const tempDiff = curr.temp - prev.temp;
      if (curr.minutes > 0 && tempDiff > 0) {
        const rate = tempDiff / (curr.minutes / 60);
        if (rate > profile.maxHeatingRate) {
          risks.push({
            level: "danger",
            code: "HEATING_RATE_TOO_FAST",
            message: `${prev.temp}℃→${curr.temp}℃ 阶段升温速率 ${rate.toFixed(0)}℃/h 超过窑炉上限 ${profile.maxHeatingRate}℃/h，坯体可能炸裂`
          });
        }
        if (i === 1 && prev.temp <= 300 && rate > 100) {
          risks.push({
            level: "warning",
            code: "INITIAL_HEATING_FAST",
            message: `低温阶段升温速率 ${rate.toFixed(0)}℃/h 偏快，坯体残余水分可能导致开裂`
          });
        }
      }
    }
  }

  if (!kiln || !KILN_PROFILES[kiln]) {
    risks.push({ level: "info", code: "KILN_UNKNOWN", message: "窑炉编号未在系统登记，使用通用安全阈值评估" });
  }

  if (heatingStages.length === 0) {
    risks.push({ level: "info", code: "USING_DEFAULT_STAGES", message: "未提供升温阶段，使用默认三段升温曲线" });
  }

  const totalMinutes = normalizedCurve.reduce((s, p) => s + p.minutes, 0);
  if (totalMinutes > 900) {
    risks.push({ level: "info", code: "LONG_FIRING_CYCLE", message: `烧成周期约 ${(totalMinutes / 60).toFixed(1)} 小时，属长周期烧成，需关注能耗` });
  }

  return risks;
}

function curveDistance(curveA, curveB, peakTemp) {
  const allTemps = new Set();
  curveA.forEach(p => allTemps.add(p.temp));
  curveB.forEach(p => allTemps.add(p.temp));
  const temps = [...allTemps].sort((a, b) => a - b);

  function interpolate(curve, targetTemp) {
    for (let i = 0; i < curve.length; i++) {
      if (curve[i].temp === targetTemp) return curve[i].minutes;
      if (curve[i].temp > targetTemp && i > 0) {
        const prev = curve[i - 1];
        const curr = curve[i];
        const ratio = (targetTemp - prev.temp) / (curr.temp - prev.temp);
        return prev.minutes + ratio * (curr.minutes - prev.minutes);
      }
    }
    return 0;
  }

  let sumDiff = 0;
  for (const t of temps) {
    sumDiff += Math.abs(interpolate(curveA, t) - interpolate(curveB, t));
  }
  const avgDiff = sumDiff / temps.length;
  const peakDiff = Math.abs(
    (curveA[curveA.length - 1]?.temp || 0) - (curveB[curveB.length - 1]?.temp || 0)
  );
  return avgDiff * 0.6 + peakDiff * 0.4;
}

export function findSimilarCurves(input, normalizedCurve, tiles, limit = 3) {
  if (!tiles || tiles.length === 0) return [];

  const scored = tiles
    .filter(t => Array.isArray(t.firingCurve) && t.firingCurve.length > 0)
    .map(t => {
      const distance = curveDistance(normalizedCurve, t.firingCurve, input.peakTemp);
      const peakDiff = Math.abs((t.peakTemp || 0) - input.peakTemp);
      const kilnMatch = t.kiln && input.kiln && t.kiln === input.kiln ? 0 : 50;
      const totalScore = distance + peakDiff * 0.3 + kilnMatch;
      const similarity = Math.max(0, 100 - totalScore * 0.5);
      return { tile: t, distance, peakDiff, similarity: Number(similarity.toFixed(1)) };
    })
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit).map(r => ({
    tileId: r.tile.id,
    tileRecipe: r.tile.recipe,
    tileKiln: r.tile.kiln,
    tilePeakTemp: r.tile.peakTemp,
    tileScore: r.tile.score,
    tileColor: r.tile.color,
    tileDefects: r.tile.defects,
    tileFiringCurve: r.tile.firingCurve,
    similarity: r.similarity,
    peakTempDiff: r.peakDiff
  }));
}

export function calcTotalDuration(normalizedCurve) {
  return normalizedCurve.reduce((s, p) => s + p.minutes, 0);
}

export function calcHeatingRates(normalizedCurve) {
  const rates = [];
  let prevTemp = 25;
  let prevMinutes = 0;
  for (const point of normalizedCurve) {
    const tempDiff = point.temp - prevTemp;
    const timeHours = (point.minutes - prevMinutes) / 60;
    if (timeHours > 0 && tempDiff > 0) {
      rates.push({
        from: prevTemp,
        to: point.temp,
        rateCelsiusPerHour: Number((tempDiff / timeHours).toFixed(0))
      });
    }
    prevTemp = point.temp;
    prevMinutes = point.minutes;
  }
  return rates;
}
