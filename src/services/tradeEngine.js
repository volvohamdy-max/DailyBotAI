function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getProfile(pair = '') {
  const symbol = String(pair).toUpperCase();

  if (symbol === 'XAUUSD') {
    return {
      name: 'GOLD',
      atrMultiplier: 1.40,
      swingLookback: 20,
      structureBufferATR: 0.25,
      minRiskPct: 0.0018,
      maxRiskPct: 0.0120,
      rrTp1: 1.5,
      rrTp2: 2.5
    };
  }

  if (symbol === 'BTCUSD') {
    return {
      name: 'BTC',
      atrMultiplier: 1.80,
      swingLookback: 24,
      structureBufferATR: 0.30,
      minRiskPct: 0.0045,
      maxRiskPct: 0.0350,
      rrTp1: 1.5,
      rrTp2: 2.5
    };
  }

  return {
    name: 'FOREX',
    atrMultiplier: 1.35,
    swingLookback: 20,
    structureBufferATR: 0.20,
    minRiskPct: 0.0008,
    maxRiskPct: 0.0070,
    rrTp1: 1.5,
    rrTp2: 2.5
  };
}

function trueRange(current, previousClose) {
  const high = Number(current?.high);
  const low = Number(current?.low);
  const prev = Number(previousClose);

  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  if (!Number.isFinite(prev)) return high - low;

  return Math.max(
    high - low,
    Math.abs(high - prev),
    Math.abs(low - prev)
  );
}

function calculateATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const sample = candles.slice(-(period + 1));
  const ranges = [];

  for (let i = 1; i < sample.length; i++) {
    const tr = trueRange(sample[i], sample[i - 1]?.close);
    if (Number.isFinite(tr) && tr > 0) ranges.push(tr);
  }

  if (ranges.length < Math.max(5, Math.floor(period * 0.7))) return null;

  return ranges.reduce((sum, x) => sum + x, 0) / ranges.length;
}

function recentSwing(candles, lookback) {
  if (!Array.isArray(candles) || candles.length < 5) {
    return { low: null, high: null };
  }

  const sample = candles.slice(-lookback - 1, -1);
  const lows = sample.map(c => Number(c?.low)).filter(Number.isFinite);
  const highs = sample.map(c => Number(c?.high)).filter(Number.isFinite);

  return {
    low: lows.length ? Math.min(...lows) : null,
    high: highs.length ? Math.max(...highs) : null
  };
}

function technicalScoreFromAnalysis(analysis, direction) {
  const buyScore = Number(analysis?.buyScore) || 0;
  const sellScore = Number(analysis?.sellScore) || 0;
  const raw = direction === 'BUY' ? buyScore * 25 : sellScore * 25;
  return clamp(Number.isFinite(raw) ? raw : 0, 0, 100);
}

function calculateFinalScore({
  smartScore,
  aiConfidence,
  technicalScore,
  historicalScore,
  similarSetups,
  tp1Rate,
  slRate,
  labApproved
}) {
  const smart = clamp(Number(smartScore) || 0, 0, 100);
  const ai = clamp(Number(aiConfidence) || 0, 0, 100);
  const technical = clamp(Number(technicalScore) || 0, 0, 100);
  const historical = clamp(Number(historicalScore) || 0, 0, 100);
  const setups = Math.max(0, Number(similarSetups) || 0);

  let weighted = smart * 0.55 + technical * 0.20;
  let weight = 0.75;

  if (ai > 0) {
    weighted += ai * 0.15;
    weight += 0.15;
  }

  if (setups >= 10) {
    weighted += historical * 0.10;
    weight += 0.10;
  }

  let score = weight > 0 ? weighted / weight : 0;

  if (setups >= 10 && Number(tp1Rate) >= 60 && Number(slRate) <= 40) score += 3;
  if (setups >= 10 && labApproved) score += 2;
  if (setups >= 10 && Number(slRate) > 55) score -= 6;

  return Math.round(clamp(score, 0, 100));
}

function getStrength(score) {
  const s = clamp(Number(score) || 0, 0, 100);
  if (s >= 85) return 'VERY_STRONG';
  if (s >= 75) return 'STRONG';
  if (s >= 65) return 'MODERATE';
  return 'WEAK';
}

function calculateTradeLevels(candles, direction, pair = '') {
  if (!Array.isArray(candles) || candles.length < 18) return null;

  const profile = getProfile(pair);
  const entry = Number(candles[candles.length - 1]?.close);
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const atr = calculateATR(candles, 14);
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const swing = recentSwing(candles, profile.swingLookback);
  const minRisk = entry * profile.minRiskPct;
  const maxRisk = entry * profile.maxRiskPct;
  const atrRisk = atr * profile.atrMultiplier;
  const buffer = atr * profile.structureBufferATR;

  let atrStop;
  let structureStop = null;
  let stopSource = 'ATR';

  if (direction === 'BUY') {
    atrStop = entry - atrRisk;
    if (Number.isFinite(swing.low) && swing.low < entry) {
      structureStop = swing.low - buffer;
    }
  } else if (direction === 'SELL') {
    atrStop = entry + atrRisk;
    if (Number.isFinite(swing.high) && swing.high > entry) {
      structureStop = swing.high + buffer;
    }
  } else {
    return null;
  }

  let sl;
  if (direction === 'BUY') {
    sl = Number.isFinite(structureStop) ? Math.min(atrStop, structureStop) : atrStop;
  } else {
    sl = Number.isFinite(structureStop) ? Math.max(atrStop, structureStop) : atrStop;
  }

  if (Number.isFinite(structureStop)) {
    const farther = direction === 'BUY'
      ? structureStop < atrStop
      : structureStop > atrStop;
    if (farther) stopSource = 'SWING+ATR';
  }

  let riskDistance = Math.abs(entry - sl);

  if (riskDistance < minRisk) {
    riskDistance = minRisk;
    sl = direction === 'BUY' ? entry - riskDistance : entry + riskDistance;
    stopSource = 'MIN_DISTANCE';
  }

  if (riskDistance > maxRisk) {
    return null;
  }

  const rrTp1 = profile.rrTp1;
  const rrTp2 = profile.rrTp2;

  const tp1 = direction === 'BUY'
    ? entry + riskDistance * rrTp1
    : entry - riskDistance * rrTp1;

  const tp2 = direction === 'BUY'
    ? entry + riskDistance * rrTp2
    : entry - riskDistance * rrTp2;

  return {
    entry,
    sl,
    tp1,
    tp2,
    atr,
    riskDistance,
    riskPct: (riskDistance / entry) * 100,
    rrTp1,
    rrTp2,
    stopSource,
    swingLow: swing.low,
    swingHigh: swing.high,
    profile: profile.name
  };
}

module.exports = {
  getProfile,
  calculateATR,
  calculateTradeLevels,
  technicalScoreFromAnalysis,
  calculateFinalScore,
  getStrength
};
