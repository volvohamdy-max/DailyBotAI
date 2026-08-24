const { getCandles } = require('./marketService');

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return [];
  const out = Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const p = candles[j - 1].close;
      sum += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - p),
        Math.abs(candles[j].low - p)
      );
    }
    out[i] = sum / period;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let g = 0, l = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - values[j - 1];
      if (d >= 0) g += d;
      else l -= d;
    }
    const rs = l === 0 ? 100 : g / l;
    out[i] = 100 - (100 / (1 + rs));
  }
  return out;
}

function adxPlaceholder(candles) {
  return candles.map(() => 10);
}

async function scanGoldRangeMR() {
  const candles = await getCandles('XAUUSD', '5min');
  if (!candles || candles.length < 100) return { ready:false, status:'NOT_ENOUGH_DATA' };

  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const i = candles.length - 2;
  const A = atr(candles);
  const R = rsi(close);
  const D = adxPlaceholder(candles);

  if (!A[i] || !R[i]) return { ready:false, status:'NO_INDICATORS' };

  const rangeHigh = Math.max(...high.slice(i - 24, i));
  const rangeLow = Math.min(...low.slice(i - 24, i));
  const width = rangeHigh - rangeLow;

  if (D[i] > 20) return { ready:false, status:'ADX_TOO_HIGH' };

  let side = null;
  if (close[i] <= rangeLow + width * 0.25 && R[i] < 44) side = 'BUY';
  if (close[i] >= rangeHigh - width * 0.25 && R[i] > 56) side = 'SELL';
  if (!side) return { ready:false, status:'NO_RANGE_SIGNAL' };

  const entry = candles[i + 1]?.open || close[i];
  const risk = A[i] * 2;

  return {
    ready:true,
    strategyId:'GOLD_RANGE_MR',
    strategyLabel:'🌊 Gold Range MR',
    side,
    entry,
    stopLoss: side === 'BUY' ? entry-risk : entry+risk,
    tp1: side === 'BUY' ? entry+risk : entry-risk,
    tp2: side === 'BUY' ? entry+risk*2 : entry-risk*2,
    score:80,
    grade:'A'
  };
}

module.exports = { scanGoldRangeMR };
