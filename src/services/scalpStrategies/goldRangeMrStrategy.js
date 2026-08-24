const { getPrice } = require('../marketService');
const { getGoldCandlesResilient } = require('../goldCandleRecovery');

const CONFIG = {
  id: 'GOLD_RANGE_MR',
  label: '🌊 Gold Range MR',
  pair: 'XAUUSD',
  timeframe: '5min'
};

const STATE = { lastSentSignalBar: null };

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function closed(rows) {
  return Array.isArray(rows) && rows.length > 1 ? rows.slice(0, -1) : [];
}

function barKey(bar) {
  return String(bar?.timestamp ?? bar?.datetime ?? bar?.time ?? bar?.date ?? '');
}

function wait(status, extra = {}) {
  return {
    ready: false,
    status,
    pair: CONFIG.pair,
    strategyId: CONFIG.id,
    strategyLabel: CONFIG.label,
    ...extra
  };
}

function rsiSeries(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    avgGain += Math.max(d, 0);
    avgLoss += Math.max(-d, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atrSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const tr = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const h = finite(candles[i]?.high);
    const l = finite(candles[i]?.low);
    const pc = finite(candles[i - 1]?.close);
    if ([h, l, pc].some(v => v === null)) continue;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let seed = 0;
  for (let i = 1; i <= period; i++) {
    if (!Number.isFinite(tr[i])) return out;
    seed += tr[i];
  }
  out[period] = seed / period;
  for (let i = period + 1; i < candles.length; i++) {
    if (!Number.isFinite(tr[i])) continue;
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

function adxSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  const tr = Array(candles.length).fill(0);
  const plusDM = Array(candles.length).fill(0);
  const minusDM = Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const h = finite(candles[i]?.high);
    const l = finite(candles[i]?.low);
    const ph = finite(candles[i - 1]?.high);
    const pl = finite(candles[i - 1]?.low);
    const pc = finite(candles[i - 1]?.close);
    if ([h, l, ph, pl, pc].some(v => v === null)) continue;

    const up = h - ph;
    const down = pl - l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let smTR = 0, smPlus = 0, smMinus = 0;
  for (let i = 1; i <= period && i < candles.length; i++) {
    smTR += tr[i];
    smPlus += plusDM[i];
    smMinus += minusDM[i];
  }

  const dx = Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      smTR = smTR - smTR / period + tr[i];
      smPlus = smPlus - smPlus / period + plusDM[i];
      smMinus = smMinus - smMinus / period + minusDM[i];
    }
    if (!(smTR > 0)) continue;
    const pdi = 100 * smPlus / smTR;
    const mdi = 100 * smMinus / smTR;
    if (pdi + mdi > 0) dx[i] = 100 * Math.abs(pdi - mdi) / (pdi + mdi);
  }

  let sum = 0;
  let count = 0;
  for (let i = period; i < candles.length; i++) {
    if (!Number.isFinite(dx[i])) continue;
    if (count < period) {
      sum += dx[i];
      count++;
      if (count === period) out[i] = sum / period;
    } else if (Number.isFinite(out[i - 1])) {
      out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
    }
  }
  return out;
}

async function scan() {
  const [raw5, livePrice] = await Promise.all([
    getGoldCandlesResilient(CONFIG.timeframe),
    getPrice(CONFIG.pair)
  ]);

  const candles = closed(raw5);
  if (!candles || candles.length < 100) {
    return wait('NOT_ENOUGH_DATA', { m5Count: candles?.length || 0 });
  }

  const close = candles.map(c => finite(c.close));
  const high = candles.map(c => finite(c.high));
  const low = candles.map(c => finite(c.low));
  if (![...close, ...high, ...low].every(Number.isFinite)) return wait('BAD_DATA');

  const A = atrSeries(candles, 14);
  const R = rsiSeries(close, 14);
  const D = adxSeries(candles, 14);
  const i = candles.length - 1;

  if (!Number.isFinite(A[i]) || !Number.isFinite(R[i]) || !Number.isFinite(D[i])) {
    return wait('NO_INDICATORS');
  }

  const rangeHigh = Math.max(...high.slice(i - 24, i));
  const rangeLow = Math.min(...low.slice(i - 24, i));
  const width = rangeHigh - rangeLow;
  if (!(width > 0)) return wait('INVALID_RANGE');

  if (D[i] > 20) {
    return wait('ADX_TOO_HIGH', { atr5: A[i], rsi5: R[i], adx5: D[i], rangeHigh, rangeLow });
  }

  let side = null;
  if (close[i] <= rangeLow + width * 0.25 && R[i] < 44) side = 'BUY';
  if (close[i] >= rangeHigh - width * 0.25 && R[i] > 56) side = 'SELL';

  if (!side) {
    return wait('NO_RANGE_SIGNAL', { atr5: A[i], rsi5: R[i], adx5: D[i], rangeHigh, rangeLow });
  }

  const signalBar = barKey(candles[i]);
  if (signalBar && STATE.lastSentSignalBar === signalBar) {
    return wait('SIGNAL_ALREADY_SENT', { signalBar });
  }

  const entry = finite(livePrice) ?? finite(raw5?.at(-1)?.open) ?? close[i];
  const risk = A[i] * 2;
  if (!Number.isFinite(entry) || !(risk > 0)) return wait('INVALID_LEVELS');

  const stopLoss = side === 'BUY' ? entry - risk : entry + risk;
  const tp1 = side === 'BUY' ? entry + risk : entry - risk;
  const tp2 = side === 'BUY' ? entry + risk * 2 : entry - risk * 2;

  return {
    ready: true,
    status: 'GOLD_RANGE_MR_READY',
    pair: CONFIG.pair,
    direction: side,
    strategyId: CONFIG.id,
    strategyLabel: CONFIG.label,
    entryMode: 'RANGE_MEAN_REVERSION',
    entry,
    stopLoss,
    tp1,
    tp2,
    atr5: A[i],
    rsi5: R[i],
    adx5: D[i],
    rangeHigh,
    rangeLow,
    score: 80,
    grade: 'A',
    aiConfidence: 80,
    signalBar,
    markSent: () => {
      if (signalBar) STATE.lastSentSignalBar = signalBar;
    }
  };
}

module.exports = { CONFIG, scan, rsiSeries, atrSeries, adxSeries };
