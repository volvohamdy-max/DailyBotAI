const axios = require('axios');

const BASE_URL = 'https://api.massive.com';
const TIMEOUT_MS = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

const candleCache = new Map();
const inFlight = new Map();
let cooldownUntil = 0;
let requestTimes = [];

function apiKey() {
  return process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';
}

function requireKey() {
  const key = apiKey();
  if (!key) throw new Error('MASSIVE_API_KEY not configured');
  return key;
}

function intervalToRange(interval) {
  return ({
    '1min': { multiplier: 1, timespan: 'minute', lookbackMs: 2 * 24 * 60 * 60 * 1000 },
    '5min': { multiplier: 5, timespan: 'minute', lookbackMs: 5 * 24 * 60 * 60 * 1000 },
    '15min': { multiplier: 15, timespan: 'minute', lookbackMs: 7 * 24 * 60 * 60 * 1000 },
    '30min': { multiplier: 30, timespan: 'minute', lookbackMs: 10 * 24 * 60 * 60 * 1000 },
    '1h': { multiplier: 1, timespan: 'hour', lookbackMs: 14 * 24 * 60 * 60 * 1000 }
  })[interval] || null;
}

function cacheTtl(interval) {
  if (interval === '5min') return 4 * 60 * 1000;
  if (interval === '15min') return 10 * 60 * 1000;
  if (interval === '1h') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      timestamp: Number(r.t),
      open: Number(r.o),
      high: Number(r.h),
      low: Number(r.l),
      close: Number(r.c),
      volume: Number.isFinite(Number(r.v)) && Number(r.v) > 0 ? Number(r.v) : null,
      vwap: Number.isFinite(Number(r.vw)) ? Number(r.vw) : null,
      transactions: Number.isFinite(Number(r.n)) ? Number(r.n) : null
    }))
    .filter((r) =>
      Number.isFinite(r.timestamp) && r.timestamp > 0 &&
      Number.isFinite(r.open) && Number.isFinite(r.high) &&
      Number.isFinite(r.low) && Number.isFinite(r.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-100);
}

function maxAgeFor(interval) {
  if (interval === '5min') return 30 * 60 * 1000;
  if (interval === '15min') return 60 * 60 * 1000;
  if (interval === '1h') return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

function noteRequest() {
  const now = Date.now();
  requestTimes = requestTimes.filter(t => now - t < 60 * 1000);
  requestTimes.push(now);
}

function localRateLimited() {
  const now = Date.now();
  requestTimes = requestTimes.filter(t => now - t < 60 * 1000);
  // Keep one request of headroom on the free 5 req/min plan.
  return requestTimes.length >= 4;
}

async function requestMassive(url, options) {
  const now = Date.now();
  if (cooldownUntil > now) {
    throw new Error(`MASSIVE_COOLDOWN_${Math.ceil((cooldownUntil - now) / 1000)}S`);
  }
  if (localRateLimited()) {
    throw new Error('MASSIVE_LOCAL_RATE_GUARD');
  }

  noteRequest();
  try {
    return await axios.get(url, options);
  } catch (error) {
    if (error?.response?.status === 429) {
      cooldownUntil = Date.now() + 2 * 60 * 1000;
      console.log('🧊 Massive cooldown activated (120s)');
    }
    throw error;
  }
}

async function getMassiveGoldCandles(interval) {
  const key = requireKey();
  const range = intervalToRange(interval);
  if (!range) throw new Error(`Unsupported Massive interval: ${interval}`);

  const cacheKey = `XAUUSD:${interval}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.time <= cacheTtl(interval)) {
    console.log(`🟣 Massive candle cache: ${cacheKey}`);
    return cached.candles;
  }

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    const to = Date.now();
    const from = to - range.lookbackMs;
    const ticker = encodeURIComponent('C:XAUUSD');

    const { data } = await requestMassive(
      `${BASE_URL}/v2/aggs/ticker/${ticker}/range/${range.multiplier}/${range.timespan}/${from}/${to}`,
      {
        params: { adjusted: true, sort: 'asc', limit: 5000, apiKey: key },
        timeout: TIMEOUT_MS
      }
    );

    const candles = normalizeRows(data?.results);
    const minimum = interval === '15min' ? 55 : interval === '5min' ? 30 : 20;
    if (candles.length < minimum) {
      throw new Error(`Insufficient Massive candles for XAUUSD ${interval}: ${candles.length}/${minimum}`);
    }

    const lastTs = Number(candles.at(-1)?.timestamp);
    if (!Number.isFinite(lastTs) || Date.now() - lastTs > maxAgeFor(interval)) {
      // Do not feed delayed/stale data into live trading. Back off so this
      // fallback cannot hammer the API every scan cycle.
      cooldownUntil = Math.max(cooldownUntil, Date.now() + 10 * 60 * 1000);
      throw new Error(`STALE_MASSIVE_CANDLES XAUUSD ${interval}`);
    }

    candleCache.set(cacheKey, { candles, time: Date.now() });
    return candles;
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function getMassiveGoldPrice() {
  const key = requireKey();
  const cacheKey = 'XAUUSD:PRICE';
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    const { data } = await requestMassive(
      `${BASE_URL}/v1/last_quote/currencies/XAU/USD`,
      { params: { apiKey: key }, timeout: TIMEOUT_MS }
    );

    const bid = Number(data?.last?.bid);
    const ask = Number(data?.last?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
    if (Number.isFinite(bid) && bid > 0) return bid;
    if (Number.isFinite(ask) && ask > 0) return ask;
    throw new Error('Invalid Massive XAUUSD quote');
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

function isMassiveConfigured() {
  return Boolean(apiKey());
}

module.exports = { getMassiveGoldCandles, getMassiveGoldPrice, isMassiveConfigured };
