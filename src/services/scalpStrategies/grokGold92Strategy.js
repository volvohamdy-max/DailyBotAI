const { getCandles, getPrice } = require('../marketService');
const { getDukascopyCandles } = require('../dukascopyMarketData');

const CONFIG = {
  id: 'GROK_GOLD_92',
  label: '⚡ Grok Gold 92',
  pair: 'XAUUSD',
  fastEma: 9,
  slowEma: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  volumePeriod: 20,
  volumeSpikeMult: 1.25,
  stopAtr: 2.0,
  rewardR: 0.8,
  adxMin: 20,
  rsiBuyMin: 52,
  rsiSellMax: 48,
  emaGapAtr: 0.04,
  h1DistanceAtr: 0.10,
  sessionsUTC: [[0, 24]]
};

const STATE = {
  pendingSignalBar: null,
  lastSentSignalBar: null,
  lastSentAt: 0
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function closedBars(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.length > 1 ? rows.slice(0, -1) : rows.slice();
}

function closes(rows) {
  return rows.map(x => finite(x.close)).filter(x => x != null);
}

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i > 0) e = values[i] * k + e * (1 - k);
    if (i >= period - 1) out[i] = e;
  }
  return out;
}

function ema(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

function rsiSeries(values, period = 14) {
  const out = Array(values.length).fill(null);
  let avgGain = null;
  let avgLoss = null;

  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = Math.max(d, 0);
    const loss = Math.max(-d, 0);

    if (i === period) {
      let gs = 0;
      let ls = 0;
      for (let j = 1; j <= period; j++) {
        const x = values[j] - values[j - 1];
        gs += Math.max(x, 0);
        ls += Math.max(-x, 0);
      }
      avgGain = gs / period;
      avgLoss = ls / period;
    } else if (i > period) {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (i >= period) {
      out[i] = avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }

  return out;
}

function atrSeries(rows, period = 14) {
  const out = Array(rows.length).fill(null);
  for (let i = period; i < rows.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const pc = finite(rows[j - 1]?.close);
      const h = finite(rows[j]?.high);
      const l = finite(rows[j]?.low);
      if ([pc, h, l].some(x => x == null)) {
        sum = NaN;
        break;
      }
      sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    if (Number.isFinite(sum)) out[i] = sum / period;
  }
  return out;
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const sample = values.slice(-period).map(Number);
  if (!sample.every(Number.isFinite)) return null;
  return sample.reduce((a, b) => a + b, 0) / period;
}

function adxSeries(rows, period = 14) {
  const out = Array(rows.length).fill(null);
  const tr = Array(rows.length).fill(0);
  const plusDM = Array(rows.length).fill(0);
  const minusDM = Array(rows.length).fill(0);

  for (let i = 1; i < rows.length; i++) {
    const h = finite(rows[i].high);
    const l = finite(rows[i].low);
    const ph = finite(rows[i - 1].high);
    const pl = finite(rows[i - 1].low);
    const pc = finite(rows[i - 1].close);
    if ([h, l, ph, pl, pc].some(x => x == null)) continue;

    const up = h - ph;
    const down = pl - l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let trN = 0;
  let pN = 0;
  let mN = 0;
  for (let i = 1; i <= period && i < rows.length; i++) {
    trN += tr[i];
    pN += plusDM[i];
    mN += minusDM[i];
  }

  const dx = Array(rows.length).fill(null);
  for (let i = period; i < rows.length; i++) {
    if (i > period) {
      trN = trN - trN / period + tr[i];
      pN = pN - pN / period + plusDM[i];
      mN = mN - mN / period + minusDM[i];
    }
    if (!(trN > 0)) continue;
    const pdi = 100 * pN / trN;
    const mdi = 100 * mN / trN;
    const den = pdi + mdi;
    if (den > 0) dx[i] = 100 * Math.abs(pdi - mdi) / den;
  }

  let seed = 0;
  let count = 0;
  for (let i = period; i < rows.length; i++) {
    if (!Number.isFinite(dx[i])) continue;
    if (count < period) {
      seed += dx[i];
      count++;
      if (count === period) out[i] = seed / period;
    } else if (Number.isFinite(out[i - 1])) {
      out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
    }
  }

  return out;
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

async function loadH1History(pair, primaryRows) {
  const primary = Array.isArray(primaryRows) ? primaryRows : [];
  if (closedBars(primary).length >= 230) return primary;

  try {
    console.log(`🛟 GROK92 H1 RECOVERY | primary=${closedBars(primary).length} | requesting Dukascopy history`);
    const recovered = await getDukascopyCandles(pair, '1h');
    if (closedBars(recovered).length >= 230) return recovered;
  } catch (error) {
    console.log(`⚠️ GROK92 H1 RECOVERY FAILED: ${error.message}`);
  }

  return primary;
}

async function scanGrokGold92Strategy() {
  const pair = CONFIG.pair;

  const [raw5, primary1h, livePrice] = await Promise.all([
    getCandles(pair, '5min'),
    getCandles(pair, '1h'),
    getPrice(pair)
  ]);

  const raw1h = await loadH1History(pair, primary1h);
  const c5 = closedBars(raw5);
  const c1h = closedBars(raw1h);

  if (c5.length < 60 || c1h.length < 230) {
    return wait('GROK92_NO_DATA', { m5Count: c5.length, h1Count: c1h.length });
  }

  const c5Close = closes(c5);
  const e9 = emaSeries(c5Close, CONFIG.fastEma);
  const e21 = emaSeries(c5Close, CONFIG.slowEma);
  const rsi5Series = rsiSeries(c5Close, CONFIG.rsiPeriod);
  const atr5Series = atrSeries(c5, CONFIG.atrPeriod);

  const i = c5.length - 1;
  const prev = i - 1;
  const rsi5 = rsi5Series[i];
  const atr5 = atr5Series[i];

  if (![e9[i], e21[i], e9[prev], e21[prev], rsi5, atr5].every(Number.isFinite) || !(atr5 > 0)) {
    return wait('GROK92_M5_INDICATORS_NOT_READY');
  }

  const crossUp = e9[prev] <= e21[prev] && e9[i] > e21[i];
  const crossDown = e9[prev] >= e21[prev] && e9[i] < e21[i];

  let side = null;
  if (crossUp && rsi5 > CONFIG.rsiBuyMin) side = 'BUY';
  if (crossDown && rsi5 < CONFIG.rsiSellMax) side = 'SELL';

  if (!side) {
    return wait('GROK92_NO_EMA_RSI_TRIGGER', {
      rsi5,
      ema9: e9[i],
      ema21: e21[i]
    });
  }

  const emaGapAtr = Math.abs(e9[i] - e21[i]) / atr5;
  if (emaGapAtr < CONFIG.emaGapAtr) {
    return wait('GROK92_EMA_GAP_TOO_SMALL', { side, rsi5, atr5, emaGapAtr });
  }

  const volumes = c5.map(x => finite(x.volume) ?? 0);
  const volAvg = sma(volumes.slice(0, -1), CONFIG.volumePeriod);
  const signalVolume = volumes[volumes.length - 1];

  if (!(volAvg > 0) || !(signalVolume >= volAvg * CONFIG.volumeSpikeMult)) {
    return wait('GROK92_VOLUME_NOT_SPIKE', {
      side,
      rsi5,
      atr5,
      signalVolume,
      volumeAverage: volAvg,
      volumeRatio: volAvg > 0 ? signalVolume / volAvg : null
    });
  }

  const h1Close = closes(c1h);
  const h1Ema200 = ema(h1Close, 200);
  const h1AtrSeries = atrSeries(c1h, CONFIG.atrPeriod);
  const h1AdxSeries = adxSeries(c1h, CONFIG.atrPeriod);
  const h = c1h.length - 1;
  const h1CloseNow = finite(c1h[h].close);
  const h1Atr = h1AtrSeries[h];
  const h1Adx = h1AdxSeries[h];

  if (![h1CloseNow, h1Ema200, h1Atr, h1Adx].every(Number.isFinite) || !(h1Atr > 0)) {
    return wait('GROK92_H1_INDICATORS_NOT_READY', { side, rsi5, atr5 });
  }

  if (h1Adx < CONFIG.adxMin) {
    return wait('GROK92_H1_ADX_TOO_WEAK', { side, rsi5, atr5, h1Adx });
  }

  const h1Bias = h1CloseNow > h1Ema200 ? 'BUY' : h1CloseNow < h1Ema200 ? 'SELL' : null;
  if (side !== h1Bias) {
    return wait('GROK92_H1_BIAS_MISMATCH', { side, h1Bias, rsi5, atr5, h1Adx });
  }

  const h1Distance = Math.abs(h1CloseNow - h1Ema200) / h1Atr;
  if (h1Distance < CONFIG.h1DistanceAtr) {
    return wait('GROK92_H1_TOO_CLOSE_EMA200', {
      side,
      h1Bias,
      h1Adx,
      h1Distance
    });
  }

  const signalBar = c5[i];
  const signalKey = barKey(signalBar);
  if (signalKey && STATE.lastSentSignalBar === signalKey) {
    return wait('GROK92_SIGNAL_ALREADY_SENT', { side, signalKey });
  }

  const entry = finite(livePrice) ?? finite(raw5?.[raw5.length - 1]?.close) ?? finite(signalBar.close);
  if (!Number.isFinite(entry)) {
    return wait('GROK92_NO_LIVE_PRICE', { side });
  }

  const risk = atr5 * CONFIG.stopAtr;
  const stopLoss = side === 'BUY' ? entry - risk : entry + risk;
  const target = side === 'BUY'
    ? entry + risk * CONFIG.rewardR
    : entry - risk * CONFIG.rewardR;

  STATE.pendingSignalBar = signalKey || null;

  const score = Math.min(100, Math.round(
    72
    + Math.min(10, Math.max(0, (h1Adx - CONFIG.adxMin) * 0.8))
    + Math.min(8, emaGapAtr * 40)
    + Math.min(10, Math.max(0, (signalVolume / volAvg - CONFIG.volumeSpikeMult) * 12))
  ));

  return {
    ready: true,
    status: 'GROK92_READY',
    pair,
    direction: side,
    strategyId: CONFIG.id,
    strategyLabel: CONFIG.label,
    entryMode: 'EMA_CROSS_VOLUME_H1_REGIME',
    grade: 'A',
    score,
    aiConfidence: 0,
    entry,
    stopLoss,
    tp1: target,
    tp2: target,
    risk,
    rrTp1: CONFIG.rewardR,
    rrTp2: CONFIG.rewardR,
    atr5,
    rsi5,
    adx5: null,
    adx15: null,
    h1Adx,
    h1Bias,
    h1Ema200,
    h1Atr,
    h1Distance,
    ema9: e9[i],
    ema21: e21[i],
    emaGapAtr,
    signalVolume,
    volumeAverage: volAvg,
    volumeRatio: signalVolume / volAvg,
    signalBar: signalKey,
    reasons: [
      '5M EMA9/21 fresh cross',
      `RSI ${side === 'BUY' ? '>' : '<'} ${side === 'BUY' ? CONFIG.rsiBuyMin : CONFIG.rsiSellMax}`,
      `5M volume >= ${CONFIG.volumeSpikeMult}x average`,
      `EMA gap >= ${CONFIG.emaGapAtr} ATR`,
      `H1 ADX >= ${CONFIG.adxMin}`,
      'H1 price aligned with EMA200',
      `H1 distance >= ${CONFIG.h1DistanceAtr} ATR`,
      'All-day scan enabled',
      `SL ${CONFIG.stopAtr} ATR / TP ${CONFIG.rewardR}R`
    ]
  };
}

function markSent() {
  STATE.lastSentAt = Date.now();
  if (STATE.pendingSignalBar) {
    STATE.lastSentSignalBar = STATE.pendingSignalBar;
  }
}

module.exports = {
  CONFIG,
  scan: scanGrokGold92Strategy,
  markSent
};
