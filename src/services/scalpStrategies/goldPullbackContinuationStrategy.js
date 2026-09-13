'use strict';

// Research-only detector for XAUUSD M5 pullback -> reclaim continuation setups.
// It is intentionally NOT wired into live/VIP dispatch until historical validation passes.

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let e = sum / period;
  out[period - 1] = e;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function atrSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  const tr = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }
  if (candles.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let a = sum / period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

function normalize(candles = []) {
  return candles.map(c => ({
    time: Number(c.time), open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close), volume: Number(c.volume) || 0
  })).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}

function detectAt(c, i, p = {}) {
  const cfg = {
    fast: p.fast || 9,
    slow: p.slow || 21,
    impulseLookback: p.impulseLookback || 8,
    impulseAtr: p.impulseAtr || 1.8,
    pullbackBars: p.pullbackBars || 5,
    pullbackTolAtr: p.pullbackTolAtr || 0.25,
    reclaimBodyAtr: p.reclaimBodyAtr || 0.35,
    maxExtensionAtr: p.maxExtensionAtr || 0.85
  };
  if (i < Math.max(40, cfg.impulseLookback + cfg.pullbackBars + 2)) return null;
  const closes = c.map(x => x.close);
  const eFast = emaSeries(closes, cfg.fast);
  const eSlow = emaSeries(closes, cfg.slow);
  const atr = atrSeries(c, 14);
  const a = atr[i];
  if (![a, eFast[i], eSlow[i]].every(Number.isFinite) || a <= 0) return null;

  const start = Math.max(1, i - cfg.impulseLookback - cfg.pullbackBars);
  const pre = c.slice(start, i - cfg.pullbackBars + 1);
  if (!pre.length) return null;
  const impulseUp = Math.max(...pre.map(x => x.high)) - Math.min(...pre.map(x => x.low));
  const impulseDown = impulseUp;
  const recent = c.slice(Math.max(0, i - cfg.pullbackBars), i);
  const tol = a * cfg.pullbackTolAtr;
  const body = Math.abs(c[i].close - c[i].open) / a;

  const buyTrend = eFast[i] > eSlow[i] && eFast[i] > eFast[i - 3];
  const sellTrend = eFast[i] < eSlow[i] && eFast[i] < eFast[i - 3];
  const buyTouch = recent.some((x, k) => x.low <= (eFast[i - recent.length + k] || eFast[i]) + tol);
  const sellTouch = recent.some((x, k) => x.high >= (eFast[i - recent.length + k] || eFast[i]) - tol);
  const buyReclaim = c[i].close > c[i - 1].high && c[i].close > eFast[i] && c[i].close > c[i].open;
  const sellReclaim = c[i].close < c[i - 1].low && c[i].close < eFast[i] && c[i].close < c[i].open;
  const buyNotLate = c[i].close - eFast[i] <= a * cfg.maxExtensionAtr;
  const sellNotLate = eFast[i] - c[i].close <= a * cfg.maxExtensionAtr;

  if (body >= cfg.reclaimBodyAtr && impulseUp >= a * cfg.impulseAtr && buyTrend && buyTouch && buyReclaim && buyNotLate) {
    return { side: 'BUY', atr: a, emaFast: eFast[i], emaSlow: eSlow[i], reason: 'PULLBACK_RECLAIM_CONTINUATION' };
  }
  if (body >= cfg.reclaimBodyAtr && impulseDown >= a * cfg.impulseAtr && sellTrend && sellTouch && sellReclaim && sellNotLate) {
    return { side: 'SELL', atr: a, emaFast: eFast[i], emaSlow: eSlow[i], reason: 'PULLBACK_RECLAIM_CONTINUATION' };
  }
  return null;
}

function evaluate(candles, params = {}) {
  const c = normalize(candles);
  if (c.length < 60) return { ready: false, status: 'WAIT', reason: 'INSUFFICIENT_M5_DATA' };
  const signal = detectAt(c, c.length - 1, params);
  if (!signal) return { ready: false, status: 'WAIT', reason: 'NO_PULLBACK_CONTINUATION' };
  return { ready: true, status: 'SIGNAL', timeframe: '5m', ...signal };
}

module.exports = {
  id: 'GOLD_PULLBACK_CONTINUATION',
  label: 'Gold Pullback Continuation',
  timeframe: '5m',
  evaluate,
  detectAt,
  normalize,
  atrSeries,
  emaSeries
};
