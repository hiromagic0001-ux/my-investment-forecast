import fs from "node:fs/promises";

const historyPath = "forecast-history.json";
const outputPath = "forecast-validation.json";
const assets = ["fang", "nikkei", "topix"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let history = [];
try {
  history = JSON.parse(await fs.readFile(historyPath, "utf8"));
  if (!Array.isArray(history)) throw new Error("forecast history must be an array");
} catch (error) {
  throw new Error("Cannot read valid forecast-history.json: " + String(error));
}

function collect(rows) {
  const samples = [];
  for (const day of rows) {
    for (const result of day.results || []) {
      const p = Number(result.probability);
      const base = Number(result.basePrice);
      const actual = Number(result.actual);
      if (!Number.isFinite(p) || p < 0 || p > 100 ||
          !Number.isFinite(base) || base <= 0 ||
          !Number.isFinite(actual) || actual <= 0 ||
          !result.actualDate || actual === base) continue;
      const observedUp = actual > base ? 1 : 0;
      const predictedUp = p >= 50 ? 1 : 0;
      const probability = p / 100;
      const returnPct = (actual / base - 1) * 100;
      samples.push({
        id: result.id,
        forecastDate: day.date,
        actualDate: result.actualDate,
        probabilityUp: p,
        observedUp,
        hit: predictedUp === observedUp,
        brier: (probability - observedUp) ** 2,
        returnPct,
        absReturnPct: Math.abs(returnPct)
      });
    }
  }
  return samples;
}

function summarize(samples) {
  const n = samples.length;
  if (!n) return {
    samples: 0, directionAccuracy: null, brierScore: null,
    meanAbsoluteMovePct: null, meanReturnPct: null,
    calibration: [], reliability: "検証データなし"
  };
  const bins = Array.from({ length: 5 }, (_, i) => ({
    range: `${i * 20}-${(i + 1) * 20}%`, count: 0, predictedUpMean: 0, observedUpRate: 0
  }));
  for (const s of samples) {
    const index = Math.min(4, Math.floor(s.probabilityUp / 20));
    bins[index].count++;
    bins[index].predictedUpMean += s.probabilityUp;
    bins[index].observedUpRate += s.observedUp;
  }
  const calibration = bins.filter(b => b.count).map(b => ({
    ...b,
    predictedUpMean: Number((b.predictedUpMean / b.count).toFixed(1)),
    observedUpRate: Number((b.observedUpRate / b.count * 100).toFixed(1))
  }));
  return {
    samples: n,
    directionAccuracy: Number((samples.filter(s => s.hit).length / n * 100).toFixed(1)),
    brierScore: Number((samples.reduce((sum, s) => sum + s.brier, 0) / n).toFixed(4)),
    meanAbsoluteMovePct: Number((samples.reduce((sum, s) => sum + s.absReturnPct, 0) / n).toFixed(3)),
    meanReturnPct: Number((samples.reduce((sum, s) => sum + s.returnPct, 0) / n).toFixed(3)),
    calibration,
    reliability: n < 30 ? "標本不足：参考値" : "集計可能"
  };
}

const all = collect(history);
const byAsset = Object.fromEntries(assets.map(id => [id, summarize(all.filter(s => s.id === id))]));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: historyPath,
  methodology: {
    direction: "probability >= 50 means up; actual direction is actual > basePrice",
    brier: "mean((probabilityUp / 100 - observedUp) ^ 2); lower is better",
    returnError: "absolute percentage change from saved basePrice to actual",
    minimumSamplesForReliability: 30,
    learning: "diagnostics only; does not alter forecast weights or future probabilities"
  },
  overall: summarize(all),
  byAsset,
  samples: all
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  validationSamples: all.length,
  overall: report.overall,
  byAsset: Object.fromEntries(Object.entries(byAsset).map(([id, value]) => [id, {
    samples: value.samples, directionAccuracy: value.directionAccuracy, brierScore: value.brierScore
  }]))
}));
