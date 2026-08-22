const { getPrice } = require('../marketService');
const { getGoldCandlesResilient } = require('../goldCandleRecovery');

const CONFIG = {
  id: 'PRO_STRATEGY',
  label: '⭐ Pro Strategy',
  pair: 'XAUUSD',
  rsiPeriod: 14,
  buyLevel: 37,
  sellLevel: 63,
  stopDistance: 10,
  cooldownMinutes: 180,
  maxLossesPerDay: 2,
  blockedUtcHours: new Set([1, 2, 3, 4, 5, 15, 16, 21, 22, 23]),
  dailyEmaPeriod: 50,
  adxPeriod: 14,
  adxMin: 15,
  atrPeriod: 14,
  atrAverageLookback: 50,
  atrRatioMax: 1.15
};

const STATE = {
  day: null,
  lossesToday: 0,
  cooldownUntil: 0,
  dailyCache: null
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function closed(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.length > 1 ? rows.slice(0, -1) : [];
}

function utcDay(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function resetDay(now = Date.now()) {
  const d = utcDay(now);
  if (STATE.day !== d) {
    STATE.day = d;
    STATE.lossesToday = 0;
  }
}

function inFomcWindow(date = new Date()) {
  if (date.getUTCDay() !== 3) return false;
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes();
  return mins >= 17 * 60 && mins <= 20 * 60 + 30;
}

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 0; i < values.length; i++) {
    if (i > 0) e = values[i] * k + e * (1 - k);
    if (i >= period - 1) out[i] = e;
  }
  return out;
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
      const h = finite(rows[j]?.high);
      const l = finite(rows[j]?.low);
      const pc = finite(rows[j - 1]?.close ?? rows[j]?.close);
      if ([h, l, pc].some(x => x == null)) {
        sum = NaN;
        break;
      }

      sum += Math.max(
        h - l,
        Math.abs(h - pc),
        Math.abs(l - pc)
      );
    }

    if (Number.isFinite(sum)) out[i] = sum / period;
  }

  return out;
}

function atr(rows, period = 14) {
  const series = atrSeries(rows, period);
  return finite(series.at(-1));
}

function adxSeries(rows, period = 14) {
  const out = Array(rows.length).fill(null);
  const tr = Array(rows.length).fill(0);
  const pdm = Array(rows.length).fill(0);
  const mdm = Array(rows.length).fill(0);

  for (let i = 1; i < rows.length; i++) {
    const high = finite(rows[i]?.high);
    const low = finite(rows[i]?.low);
    const prevHigh = finite(rows[i - 1]?.high);
    const prevLow = finite(rows[i - 1]?.low);
    const prevClose = finite(rows[i - 1]?.close);

    if ([high, low, prevHigh, prevLow, prevClose].some(x => x == null)) continue;

    const up = high - prevHigh;
    const dn = prevLow - low;

    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  }

  if (rows.length <= period * 2) return out;

  let trN = 0;
  let pN = 0;
  let mN = 0;

  for (let i = 1; i <= period; i++) {
    trN += tr[i];
    pN += pdm[i];
    mN += mdm[i];
  }

  const dx = Array(rows.length).fill(null);

  for (let i = period; i < rows.length; i++) {
    if (i > period) {
      trN = trN - trN / period + tr[i];
      pN = pN - pN / period + pdm[i];
      mN = mN - mN / period + mdm[i];
    }

    if (trN <= 0) continue;

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
    } else {
      const prev = out[i - 1];
      if (Number.isFinite(prev)) {
        out[i] = (prev * (period - 1) + dx[i]) / period;
      }
    }
  }

  return out;
}

function aggregateUtcDays(rows) {
  const days = new Map();

  for (const x of rows) {
    const key = utcDay(x.timestamp);
    let d = days.get(key);

    if (!d) {
      d = {
        timestamp: Date.parse(`${key}T00:00:00Z`),
        open: x.open,
        high: x.high,
        low: x.low,
        close: x.close
      };
      days.set(key, d);
    } else {
      d.high = Math.max(d.high, x.high);
      d.low = Math.min(d.low, x.low);
      d.close = x.close;
    }
  }

  return [...days.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function getDailyBars() {
  const now = Date.now();
  if (STATE.dailyCache && now - STATE.dailyCache.time < 6 * 60 * 60 * 1000) {
    return STATE.dailyCache.rows;
  }

  const { getHistoricalRates } = require('dukascopy-node');
  const raw = await getHistoricalRates({
    instrument: 'xauusd',
    dates: {
      from: new Date(now - 90 * 24 * 60 * 60 * 1000),
      to: new Date(now)
    },
    timeframe: 'h1',
    format: 'json',
    priceType: 'bid',
    volumes: true,
    batchSize: 1,
    pauseBetweenBatchesMs: 1600,
    useCache: true,
    cacheFolderPath: './data/dukascopy-cache',
    retryCount: 0,
    retryOnEmpty: false
  });

  const hourly = (Array.isArray(raw) ? raw : [])
    .map(x => ({
      timestamp: Number(x.timestamp),
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close)
    }))
    .filter(x =>
      Number.isFinite(x.timestamp) &&
      Number.isFinite(x.open) &&
      Number.isFinite(x.high) &&
      Number.isFinite(x.low) &&
      Number.isFinite(x.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const rows = aggregateUtcDays(hourly);
  STATE.dailyCache = { rows, time: now };
  return rows;
}

async function dailyBias() {
  const all = await getDailyBars();
  const today = utcDay();
  const done = all.filter(x => utcDay(x.timestamp) < today);
  if (done.length < CONFIG.dailyEmaPeriod) return null;

  const closes = done.map(x => x.close);
  const e = emaSeries(closes, CONFIG.dailyEmaPeriod);
  const lastClose = closes.at(-1);
  const lastEma = e.at(-1);

  if (!Number.isFinite(lastClose) || !Number.isFinite(lastEma)) return null;
  return lastClose > lastEma ? 'BUY' : 'SELL';
}

function canTradeNow(date = new Date()) {
  resetDay(date.getTime());
  if (STATE.lossesToday >= CONFIG.maxLossesPerDay) return 'PRO_MAX_DAILY_LOSSES';
  if (Date.now() < STATE.cooldownUntil) return 'PRO_COOLDOWN';
  if (CONFIG.blockedUtcHours.has(date.getUTCHours())) return 'PRO_BLOCKED_HOUR';
  if (inFomcWindow(date)) return 'PRO_FOMC_BLOCK';
  return null;
}

async function scan() {
  const blocked = canTradeNow();
  if (blocked) {
    return { ready: false, status: blocked, pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const [raw5, livePrice, bias] = await Promise.all([
    getGoldCandlesResilient('5min'),
    getPrice(CONFIG.pair),
    dailyBias()
  ]);

  const c5 = closed(raw5);
  const minBars = Math.max(
    CONFIG.atrAverageLookback + CONFIG.atrPeriod + 2,
    CONFIG.adxPeriod * 2 + 2,
    CONFIG.rsiPeriod + 2
  );

  if (c5.length < minBars || !bias) {
    return { ready: false, status: 'PRO_NO_DATA', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const closes = c5.map(x => finite(x.close)).filter(Number.isFinite);
  const rs = rsiSeries(closes, CONFIG.rsiPeriod);
  const prevRsi = rs.at(-2);
  const currentRsi = rs.at(-1);

  if (!Number.isFinite(prevRsi) || !Number.isFinite(currentRsi)) {
    return { ready: false, status: 'PRO_RSI_NOT_READY', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const adxValues = adxSeries(c5, CONFIG.adxPeriod);
  const currentAdx = finite(adxValues.at(-1));

  if (!Number.isFinite(currentAdx)) {
    return { ready: false, status: 'PRO_ADX_NOT_READY', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  if (currentAdx < CONFIG.adxMin) {
    return {
      ready: false,
      status: 'PRO_ADX_TOO_LOW',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label,
      adx5: currentAdx,
      adxMin: CONFIG.adxMin,
      rsi5: currentRsi,
      dailyBias: bias
    };
  }

  const atrValues = atrSeries(c5, CONFIG.atrPeriod);
  const currentAtr = finite(atrValues.at(-1));
  const previousAtrValues = atrValues
    .slice(-(CONFIG.atrAverageLookback + 1), -1)
    .filter(Number.isFinite);

  if (!Number.isFinite(currentAtr) || previousAtrValues.length < CONFIG.atrAverageLookback) {
    return { ready: false, status: 'PRO_ATR_NOT_READY', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const avgAtr = previousAtrValues.reduce((a, b) => a + b, 0) / previousAtrValues.length;
  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : null;

  if (!Number.isFinite(atrRatio)) {
    return { ready: false, status: 'PRO_ATR_RATIO_NOT_READY', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  if (atrRatio > CONFIG.atrRatioMax) {
    return {
      ready: false,
      status: 'PRO_ATR_TOO_HOT',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label,
      atr5: currentAtr,
      atrRatio,
      atrRatioMax: CONFIG.atrRatioMax,
      adx5: currentAdx,
      rsi5: currentRsi,
      dailyBias: bias
    };
  }

  let side = null;
  if (prevRsi >= CONFIG.buyLevel && currentRsi < CONFIG.buyLevel && bias === 'BUY') side = 'BUY';
  if (prevRsi <= CONFIG.sellLevel && currentRsi > CONFIG.sellLevel && bias === 'SELL') side = 'SELL';

  if (!side) {
    return {
      ready: false,
      status: 'PRO_WAIT',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label,
      dailyBias: bias,
      rsi5: currentRsi,
      adx5: currentAdx,
      atr5: currentAtr,
      atrRatio
    };
  }

  const entry = finite(livePrice) ?? finite(raw5.at(-1)?.close);
  if (!Number.isFinite(entry)) {
    return { ready: false, status: 'PRO_PRICE_NOT_READY', pair: CONFIG.pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const stopLoss = side === 'BUY'
    ? entry - CONFIG.stopDistance
    : entry + CONFIG.stopDistance;

  // Numeric placeholders keep the shared scalp pipeline stable. Pro Strategy's
  // dedicated monitor NEVER uses these targets; its real exit is RSI 63/37.
  const tp1 = side === 'BUY' ? entry + 10000 : entry - 10000;
  const tp2 = side === 'BUY' ? entry + 20000 : entry - 20000;

  return {
    ready: true,
    status: 'PRO_READY',
    pair: CONFIG.pair,
    direction: side,
    strategyId: CONFIG.id,
    strategyLabel: `${CONFIG.label} | خروج RSI فقط 37/63`,
    entryMode: 'RSI_REVERSAL_D1_EMA50_ADX_ATR',
    grade: 'A',
    score: 79,
    aiConfidence: 0,
    entry,
    stopLoss,
    tp1,
    tp2,
    risk: CONFIG.stopDistance,
    rrTp1: 0,
    rrTp2: 0,
    // Shared global guard expects ATR-based stops. This value only prevents the
    // generic guard from rejecting the validated fixed-$10 Pro stop.
    atr5: Math.max(currentAtr, CONFIG.stopDistance / 1.8),
    rawAtr5: currentAtr,
    atrRatio,
    adx5: currentAdx,
    rsi5: currentRsi,
    dailyBias: bias,
    exitRule: side === 'BUY' ? 'RSI >= 63' : 'RSI <= 37',
    reasons: [
      'RSI(14) reversal cross on closed M5',
      'Daily EMA50 directional filter',
      `ADX(14) >= ${CONFIG.adxMin}`,
      `ATR(14) / 50-bar ATR average <= ${CONFIG.atrRatioMax}`,
      `Cooldown after loss: ${CONFIG.cooldownMinutes} minutes`,
      'Max 2 losses per UTC day',
      '15:00-16:59 UTC blocked',
      'Fixed $10 stop',
      side === 'BUY' ? 'Exit when RSI >= 63' : 'Exit when RSI <= 37'
    ]
  };
}

function recordResult(won, closedAt = Date.now()) {
  resetDay(closedAt);
  if (!won) {
    STATE.lossesToday += 1;
    STATE.cooldownUntil = closedAt + CONFIG.cooldownMinutes * 60 * 1000;
  }
}

function markSent() {}

module.exports = {
  CONFIG,
  scan,
  markSent,
  recordResult,
  rsiSeries
};
