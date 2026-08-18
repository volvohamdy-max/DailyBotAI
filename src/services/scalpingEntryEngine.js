const { getCandles } = require('./marketService');
const { calculateATR } = require('./tradeEngine');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < values.length; i++) {
    out = values[i] * k + out * (1-k);
  }
  return out;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i-1];
    if (d > 0) gains += d;
    if (d < 0) losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function range(candles, lookback = 18) {
  const sample = candles.slice(-lookback - 1, -1);
  const lows = sample.map(c => Number(c.low)).filter(Number.isFinite);
  const highs = sample.map(c => Number(c.high)).filter(Number.isFinite);
  return {
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null
  };
}

function momentum(candles, direction) {
  const sample = candles.slice(-3);
  const bull = sample.filter(c => Number(c.close) > Number(c.open)).length;
  const bear = sample.filter(c => Number(c.close) < Number(c.open)).length;
  return direction === 'BUY' ? bull >= 2 : bear >= 2;
}

function trigger5m(candles) {
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsi(closes, 14);

  if (![e9,e21,r].every(Number.isFinite)) {
    return { direction: 'WAIT', ema9: e9, ema21: e21, rsi: r };
  }

  if (e9 > e21 && r >= 50 && r <= 72) {
    return { direction: 'BUY', ema9: e9, ema21: e21, rsi: r };
  }

  if (e9 < e21 && r <= 50 && r >= 28) {
    return { direction: 'SELL', ema9: e9, ema21: e21, rsi: r };
  }

  return { direction: 'WAIT', ema9: e9, ema21: e21, rsi: r };
}

async function evaluateScalpEntry(pair, mainDirection, mainIndicators = {}) {
  const direction = String(mainDirection || 'WAIT').toUpperCase();

  if (!['BUY','SELL'].includes(direction)) {
    return { status: 'REJECT', scoreAdjustment: -20, reason: 'NO_MAIN_DIRECTION', trigger5m: 'WAIT' };
  }

  const candles = await getCandles(pair, '5min');

  if (!Array.isArray(candles) || candles.length < 25) {
    return { status: 'WAIT', scoreAdjustment: -8, reason: 'INSUFFICIENT_5M_DATA', trigger5m: 'WAIT' };
  }

  const last = candles[candles.length - 1];
  const price = Number(last.close);
  const atr = calculateATR(candles, 14);
  const trigger = trigger5m(candles);
  const sr = range(candles, 18);

  if (!Number.isFinite(price) || !Number.isFinite(atr) || atr <= 0) {
    return { status: 'WAIT', scoreAdjustment: -8, reason: 'INVALID_5M_METRICS', trigger5m: trigger.direction };
  }

  let adj = 0;
  const reasons = [];

  if (trigger.direction === direction) {
    adj += 12;
    reasons.push('5M_ALIGNED');
  } else if (trigger.direction === 'WAIT') {
    adj -= 8;
    reasons.push('5M_NOT_READY');
  } else {
    return { status: 'REJECT', scoreAdjustment: -25, reason: '5M_DIRECTION_MISMATCH', trigger5m: trigger.direction, rsi5m: trigger.rsi, atr5m: atr };
  }

  if (momentum(candles, direction)) {
    adj += 5;
    reasons.push('MOMENTUM_CONFIRMED');
  } else {
    adj -= 3;
    reasons.push('MOMENTUM_WEAK');
  }

  const emaDistance = Number.isFinite(trigger.ema9) ? Math.abs(price - trigger.ema9) : 0;

  if (emaDistance > atr * 0.85) {
    return {
      status: 'WAIT_PULLBACK',
      scoreAdjustment: -15,
      reason: 'LATE_ENTRY',
      trigger5m: trigger.direction,
      rsi5m: trigger.rsi,
      atr5m: atr,
      distanceFromEma9: emaDistance
    };
  }

  const obstacle = direction === 'BUY' ? Number(sr.resistance) : Number(sr.support);
  let obstacleDistance = null;

  if (Number.isFinite(obstacle)) {
    obstacleDistance = Math.abs(obstacle - price);

    if (obstacleDistance < atr * 0.60) {
      return {
        status: 'REJECT',
        scoreAdjustment: -20,
        reason: direction === 'BUY' ? 'TOO_CLOSE_TO_RESISTANCE' : 'TOO_CLOSE_TO_SUPPORT',
        trigger5m: trigger.direction,
        rsi5m: trigger.rsi,
        atr5m: atr,
        support5m: sr.support,
        resistance5m: sr.resistance,
        obstacleDistance
      };
    }

    if (obstacleDistance >= atr * 1.2) {
      adj += 5;
      reasons.push('ROOM_TO_TARGET');
    }
  }

  const atrPct = (atr / price) * 100;
  const symbol = String(pair).toUpperCase();

  let maxAtrPct = 0.18;
  let minAtrPct = 0.015;

  if (symbol === 'XAUUSD') {
    maxAtrPct = 0.16;
    minAtrPct = 0.02;
  } else if (symbol === 'BTCUSD') {
    maxAtrPct = 0.55;
    minAtrPct = 0.04;
  }

  if (atrPct > maxAtrPct) {
    return { status: 'REJECT', scoreAdjustment: -18, reason: 'VOLATILITY_TOO_HIGH', trigger5m: trigger.direction, rsi5m: trigger.rsi, atr5m: atr, atrPct };
  }

  if (atrPct < minAtrPct) {
    return { status: 'WAIT', scoreAdjustment: -8, reason: 'VOLATILITY_TOO_LOW', trigger5m: trigger.direction, rsi5m: trigger.rsi, atr5m: atr, atrPct };
  }

  const adx15 = Number(mainIndicators.adx);

  if (Number.isFinite(adx15)) {
    if (adx15 >= 25) adj += 5;
    else if (adx15 < 18) adj -= 5;
  }

  return {
    status: trigger.direction === direction ? 'ENTRY_READY' : 'WAIT',
    scoreAdjustment: clamp(adj, -25, 25),
    reason: trigger.direction === direction ? 'SCALP_ENTRY_READY' : 'WAIT_5M_CONFIRMATION',
    reasons,
    trigger5m: trigger.direction,
    rsi5m: trigger.rsi,
    ema9_5m: trigger.ema9,
    ema21_5m: trigger.ema21,
    atr5m: atr,
    atrPct,
    support5m: sr.support,
    resistance5m: sr.resistance,
    obstacleDistance
  };
}

module.exports = { evaluateScalpEntry };
