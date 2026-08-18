const axios = require('axios');

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function intervalCode(tf) {
  return ({
    '5min': '5m',
    '15min': '15m',
    '1h': '1h'
  })[tf] || null;
}

function intervalMinutes(tf) {
  return ({
    '5min': 5,
    '15min': 15,
    '1h': 60
  })[tf] || null;
}

function normalizeTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function normalizeRows(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];

  return rows
    .map(r => ({
      time: normalizeTimestamp(r.t ?? r.timestamp ?? r.datetime),
      open: Number(r.o ?? r.open),
      high: Number(r.h ?? r.high),
      low: Number(r.l ?? r.low),
      close: Number(r.c ?? r.close),
      volume: Number.isFinite(Number(r.v ?? r.volume))
        ? Number(r.v ?? r.volume)
        : 0
    }))
    .filter(r =>
      Number.isFinite(r.time) &&
      Number.isFinite(r.open) &&
      Number.isFinite(r.high) &&
      Number.isFinite(r.low) &&
      Number.isFinite(r.close)
    );
}

async function fetchChunk({ apiKey, tf, start, end, limit }) {
  const response = await axios.get(
    'https://api.sifting.io/v1/hist/commodities/XAUUSD/bars',
    {
      headers: {
        'X-API-Key': apiKey,
        'Accept-Encoding': 'gzip'
      },
      params: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        interval: intervalCode(tf),
        limit
      },
      timeout: 30000
    }
  );

  return normalizeRows(response.data);
}

async function getGoldHistoricalCandles(tf = '15min', requested = 2000) {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY غير موجود في .env');

  const minutes = intervalMinutes(tf);
  if (!minutes) throw new Error(`الفريم غير مدعوم: ${tf}`);

  const count = Math.max(100, Math.min(10000, Number(requested) || 2000));
  const key = `${tf}:${count}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    console.log(`🧪 Strategy history cache: XAUUSD ${tf} ${cached.candles.length}`);
    return cached.candles.slice(-count);
  }

  console.log(`🧪 Loading XAUUSD history: ${tf} target=${count}`);

  const all = new Map();
  let end = Date.now();
  let attempts = 0;
  const maxChunks = Math.ceil(count / 1800) + 4;

  while (all.size < count && attempts < maxChunks) {
    attempts += 1;

    const remaining = count - all.size;
    const limit = Math.min(2000, Math.max(500, remaining + 150));

    // Calendar window deliberately includes weekends/market closures.
    const barsWindow = limit * 1.8;
    const start = end - barsWindow * minutes * 60 * 1000;

    let rows = [];
    let lastError = null;

    for (let retry = 1; retry <= 2; retry++) {
      try {
        rows = await fetchChunk({ apiKey, tf, start, end, limit });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (retry < 2) await sleep(800);
      }
    }

    if (lastError) {
      throw new Error(
        `Historical Sifting failed: ${lastError.response?.status || lastError.message}`
      );
    }

    if (!rows.length) break;

    for (const row of rows) all.set(row.time, row);

    const earliest = Math.min(...rows.map(r => r.time));
    if (!Number.isFinite(earliest)) break;

    console.log(
      `🧪 History chunk ${attempts}: +${rows.length} | unique=${all.size}/${count}`
    );

    // Go one bar before the oldest row to avoid overlap loops.
    end = earliest - minutes * 60 * 1000;

    if (rows.length < 20) break;
    if (all.size < count) await sleep(250);
  }

  const candles = [...all.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-count);

  if (candles.length < 100) {
    throw new Error(`البيانات التاريخية غير كافية: ${candles.length} شمعة`);
  }

  cache.set(key, { time: Date.now(), candles });

  console.log(`✅ Strategy history ready: ${candles.length} candles`);
  return candles;
}

module.exports = {
  getGoldHistoricalCandles
};
