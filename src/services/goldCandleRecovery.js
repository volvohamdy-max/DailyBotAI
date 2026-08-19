const axios = require('axios');
const { getCandles } = require('./marketService');
const {
  getMassiveGoldCandles,
  isMassiveConfigured
} = require('./massiveMarketData');

const recoveryCache = new Map();
const inFlight = new Map();

function recoveryCacheMs(interval) {
  if (interval === '5min') return Number(process.env.GOLD_CANDLE_RECOVERY_5M_MS) || 4 * 60 * 1000;
  if (interval === '15min') return Number(process.env.GOLD_CANDLE_RECOVERY_15M_MS) || 10 * 60 * 1000;
  if (interval === '1h') return Number(process.env.GOLD_CANDLE_RECOVERY_1H_MS) || 30 * 60 * 1000;
  return Number(process.env.GOLD_CANDLE_RECOVERY_CACHE_MS) || 5 * 60 * 1000;
}

const TIMEOUT_MS = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

function intervalMap(interval) {
  return ({
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1h': '1h'
  })[interval] || null;
}

function usableVolumeCount(candles, lookback = 24) {
  return candles.slice(-lookback).reduce((count, c) => {
    const v = Number(c?.volume ?? c?.v ?? null);
    return count + (Number.isFinite(v) && v > 0 ? 1 : 0);
  }, 0);
}

async function directSiftingGold(interval) {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY not configured');

  const mapped = intervalMap(interval);
  if (!mapped) throw new Error(`Unsupported recovery interval: ${interval}`);

  const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date().toISOString();

  const { data } = await axios.get(
    'https://api.sifting.io/v1/hist/commodities/XAUUSD/bars',
    {
      headers: {
        'X-API-Key': apiKey,
        'Accept-Encoding': 'gzip'
      },
      params: {
        start,
        end,
        interval: mapped,
        limit: 2000
      },
      timeout: TIMEOUT_MS
    }
  );

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];

  const candles = rows
    .map(r => ({
      timestamp: Number(r.t ?? r.timestamp ?? 0),
      open: Number(r.o ?? r.open),
      high: Number(r.h ?? r.high),
      low: Number(r.l ?? r.low),
      close: Number(r.c ?? r.close),
      volume: Number.isFinite(Number(r.v ?? r.volume))
        ? Number(r.v ?? r.volume)
        : null
    }))
    .filter(r =>
      Number.isFinite(r.timestamp) && r.timestamp > 0 &&
      Number.isFinite(r.open) &&
      Number.isFinite(r.high) &&
      Number.isFinite(r.low) &&
      Number.isFinite(r.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-100);

  const minimum = interval === '15min' ? 55 : interval === '5min' ? 30 : 20;
  if (candles.length < minimum) {
    throw new Error(`Recovery insufficient candles: ${candles.length}/${minimum}`);
  }

  if (interval === '5min') {
    const volumeCount = usableVolumeCount(candles, 24);
    if (volumeCount < 12) {
      throw new Error(`Recovery missing usable volume: ${volumeCount}/24`);
    }
  }

  const lastTs = Number(candles.at(-1)?.timestamp);
  const maxAgeMs = interval === '5min'
    ? 30 * 60 * 1000
    : interval === '15min'
      ? 60 * 60 * 1000
      : 2 * 60 * 60 * 1000;

  if (!Number.isFinite(lastTs) || Date.now() - lastTs > maxAgeMs) {
    throw new Error(`Recovery stale candles for XAUUSD ${interval}`);
  }

  return candles;
}

async function tryMassive(interval, primaryError) {
  if (!isMassiveConfigured()) return null;

  try {
    console.log(`🟣 MASSIVE FALLBACK: XAUUSD:${interval} | primary=${primaryError.message}`);
    const candles = await getMassiveGoldCandles(interval);

    if (interval === '5min') {
      const volumeCount = usableVolumeCount(candles, 24);
      if (volumeCount < 12) {
        throw new Error(`Massive missing usable volume: ${volumeCount}/24`);
      }
    }

    console.log(`✅ MASSIVE CANDLES OK: XAUUSD:${interval} | ${candles.length} candles`);
    return candles;
  } catch (error) {
    console.log(`⚠️ Massive fallback failed XAUUSD ${interval}: ${error.response?.status || error.message}`);
    return null;
  }
}

async function getGoldCandlesResilient(interval) {
  try {
    return await getCandles('XAUUSD', interval);
  } catch (primaryError) {
    const key = `XAUUSD:${interval}`;
    const cached = recoveryCache.get(key);
    const ttl = recoveryCacheMs(interval);

    if (cached && Date.now() - cached.time <= ttl) {
      console.log(`🛟 GOLD CANDLE RECOVERY CACHE: ${key} | source=${cached.source}`);
      return cached.candles;
    }

    if (inFlight.has(key)) {
      console.log(`⏳ Shared gold candle recovery: ${key}`);
      return inFlight.get(key);
    }

    const promise = (async () => {
      const massive = await tryMassive(interval, primaryError);
      if (massive) {
        recoveryCache.set(key, { candles: massive, time: Date.now(), source: 'Massive' });
        return massive;
      }

      const status = primaryError?.response?.status;
      if (status === 429 || /429/.test(String(primaryError?.message || ''))) {
        throw new Error(`Gold candle providers rate-limited for ${key}; Massive unavailable/failed`);
      }

      console.log(`🛟 GOLD CANDLE RECOVERY: direct Sifting ${key} | primary=${primaryError.message}`);
      const candles = await directSiftingGold(interval);
      recoveryCache.set(key, { candles, time: Date.now(), source: 'SiftingDirect' });
      console.log(`✅ GOLD CANDLE RECOVERY OK: ${key} | ${candles.length} candles`);
      return candles;
    })();

    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }
}

module.exports = { getGoldCandlesResilient };
