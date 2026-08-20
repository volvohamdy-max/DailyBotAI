const { getPrice } = require('../marketService');

const CONFIG = {
  id: 'GOLD_PRIME',
  label: '👑 Gold Prime',
  pair: 'XAUUSD',
  timeframe: 'H4',
  smaPeriod: 200,
  atrPeriod: 14,
  riskAtr: 1.5
};

const STATE = {
  cache: null,
  lastSentSignal: null
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function atrSeries(rows, period = 14) {
  const out = Array(rows.length).fill(null);
  let a = null;

  for (let i = 1; i < rows.length; i++) {
    const tr = Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low - rows[i - 1].close)
    );

    if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        sum += Math.max(
          rows[j].high - rows[j].low,
          Math.abs(rows[j].high - rows[j - 1].close),
          Math.abs(rows[j].low - rows[j - 1].close)
        );
      }
      a = sum / period;
    } else if (i > period) {
      a = (a * (period - 1) + tr) / period;
    }

    if (i >= period) out[i] = a;
  }

  return out;
}

function aggregateH4(hourly) {
  const map = new Map();
  const MS = 4 * 60 * 60 * 1000;

  for (const x of hourly) {
    const bucket = Math.floor(x.timestamp / MS) * MS;
    let b = map.get(bucket);

    if (!b) {
      b = {
        timestamp: bucket,
        open: x.open,
        high: x.high,
        low: x.low,
        close: x.close
      };
      map.set(bucket, b);
    } else {
      b.high = Math.max(b.high, x.high);
      b.low = Math.min(b.low, x.low);
      b.close = x.close;
    }
  }

  const currentBucket = Math.floor(Date.now() / MS) * MS;

  return [...map.values()]
    .filter(x => x.timestamp < currentBucket)
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function getH4Bars() {
  const now = Date.now();

  if (STATE.cache && now - STATE.cache.time < 15 * 60 * 1000) {
    return STATE.cache.rows;
  }

  const { getHistoricalRates } = require('dukascopy-node');
  const raw = await getHistoricalRates({
    instrument: 'xauusd',
    dates: {
      from: new Date(now - 75 * 24 * 60 * 60 * 1000),
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

  const rows = aggregateH4(hourly);
  STATE.cache = { rows, time: now };
  return rows;
}

function detectEngine(rows) {
  if (!Array.isArray(rows) || rows.length < 220) return null;

  const i = rows.length - 1;
  const closes = rows.map(x => x.close);
  const sma200 = sma(closes.slice(0, i + 1), CONFIG.smaPeriod);
  const A = atrSeries(rows, CONFIG.atrPeriod);
  const atrNow = Number(A[i]);

  if (!Number.isFinite(sma200) || !Number.isFinite(atrNow) || atrNow <= 0) {
    return null;
  }

  const bar = rows[i];

  // B3 — Donchian 80 breakout above SMA200 | tested RR 4R
  let highest80 = -Infinity;
  for (let j = i - 80; j < i; j++) {
    highest80 = Math.max(highest80, rows[j].high);
  }

  if (bar.close > highest80 && bar.close > sma200) {
    return {
      id: 'B3_DONCHIAN_80',
      label: 'Donchian 80',
      rr: 4,
      atr: atrNow,
      sma200,
      signalBar: bar.timestamp
    };
  }

  // B4 — ATR momentum breakout above SMA200 | tested RR 3R
  const body = bar.close - bar.open;
  if (
    body > atrNow * 1.2 &&
    bar.close > sma200 &&
    bar.close > rows[i - 1].high
  ) {
    return {
      id: 'B4_ATR_BREAK',
      label: 'ATR Break',
      rr: 3,
      atr: atrNow,
      sma200,
      signalBar: bar.timestamp
    };
  }

  // B5 — bullish hammer in relatively low volatility | tested RR 2.5R
  const absBody = Math.abs(bar.close - bar.open);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  const upper = bar.high - Math.max(bar.open, bar.close);
  const priorAtr = Number(A[i - 10]);
  const lowVol = Number.isFinite(priorAtr) && atrNow < priorAtr * 1.15;

  if (
    bar.close > sma200 &&
    lowVol &&
    bar.close > bar.open &&
    absBody > 0 &&
    lower >= absBody * 2 &&
    upper <= absBody
  ) {
    return {
      id: 'B5_HAMMER',
      label: 'Hammer',
      rr: 2.5,
      atr: atrNow,
      sma200,
      signalBar: bar.timestamp
    };
  }

  return null;
}

async function scan() {
  const rows = await getH4Bars();

  if (rows.length < 220) {
    return {
      ready: false,
      status: 'GOLD_PRIME_NO_DATA',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label
    };
  }

  const engine = detectEngine(rows);

  if (!engine) {
    return {
      ready: false,
      status: 'GOLD_PRIME_WAIT',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label
    };
  }

  const signalKey = `${engine.id}:${engine.signalBar}`;
  if (STATE.lastSentSignal === signalKey) {
    return {
      ready: false,
      status: 'GOLD_PRIME_ALREADY_SENT',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label,
      subStrategy: engine.id
    };
  }

  const livePrice = finite(await getPrice(CONFIG.pair));
  if (!Number.isFinite(livePrice)) {
    return {
      ready: false,
      status: 'GOLD_PRIME_PRICE_NOT_READY',
      pair: CONFIG.pair,
      strategyId: CONFIG.id,
      strategyLabel: CONFIG.label
    };
  }

  const risk = engine.atr * CONFIG.riskAtr;
  const stopLoss = livePrice - risk;
  const target = livePrice + risk * engine.rr;

  return {
    ready: true,
    status: 'GOLD_PRIME_READY',
    pair: CONFIG.pair,
    direction: 'BUY',
    strategyId: CONFIG.id,
    strategyLabel: `${CONFIG.label} | ${engine.label}`,
    subStrategy: engine.id,
    subStrategyLabel: engine.label,
    entryMode: `GOLD_PRIME_${engine.id}`,
    timeframe: CONFIG.timeframe,
    grade: 'TECH-A',
    score: 82,
    aiConfidence: 0,
    entry: livePrice,
    stopLoss,
    tp1: target,
    tp2: target,
    risk,
    rrTp1: engine.rr,
    rrTp2: engine.rr,
    atr5: engine.atr,
    atrH4: engine.atr,
    sma200: engine.sma200,
    testedRR: engine.rr,
    allowValidatedWideStop: true,
    reasons: [
      `Gold Prime ${engine.label}`,
      'H4 signal on closed candle',
      `SMA200 filter`,
      `SL = 1.5 ATR(H4)`,
      `TP = ${engine.rr}R`,
      'Validated with execution stress and delayed-entry test'
    ],
    markSent: () => {
      STATE.lastSentSignal = signalKey;
    }
  };
}

function markSent() {}

module.exports = {
  CONFIG,
  scan,
  markSent,
  detectEngine
};
