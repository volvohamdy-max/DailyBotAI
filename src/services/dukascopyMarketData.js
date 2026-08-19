const candleCache = new Map();
const inFlight = new Map();

let queueTail = Promise.resolve();
let lastJobFinishedAt = 0;
let cooldownUntil = 0;
const GLOBAL_JOB_GAP_MS = Number(process.env.DUKASCOPY_JOB_GAP_MS) || 8000;
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.DUKASCOPY_429_COOLDOWN_MS) || 3 * 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ttl(interval) {
  if (interval === '5min') return 4 * 60 * 1000;
  if (interval === '15min') return 14 * 60 * 1000;
  if (interval === '1h') return 45 * 60 * 1000;
  return 5 * 60 * 1000;
}

function staleGrace(interval) {
  if (interval === '5min') return 15 * 60 * 1000;
  if (interval === '15min') return 35 * 60 * 1000;
  if (interval === '1h') return 90 * 60 * 1000;
  return 20 * 60 * 1000;
}

function maxAge(interval) {
  if (interval === '5min') return 20 * 60 * 1000;
  if (interval === '15min') return 45 * 60 * 1000;
  if (interval === '1h') return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => {
      if (Array.isArray(row)) {
        return {
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number.isFinite(Number(row[5])) && Number(row[5]) > 0 ? Number(row[5]) : null
        };
      }
      return {
        timestamp: Number(row?.timestamp),
        open: Number(row?.open),
        high: Number(row?.high),
        low: Number(row?.low),
        close: Number(row?.close),
        volume: Number.isFinite(Number(row?.volume)) && Number(row?.volume) > 0 ? Number(row?.volume) : null
      };
    })
    .filter(c =>
      Number.isFinite(c.timestamp) && c.timestamp > 0 &&
      Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function aggregate(rows, minutes) {
  const bucketMs = minutes * 60 * 1000;
  const buckets = new Map();
  for (const c of rows) {
    const ts = Math.floor(c.timestamp / bucketMs) * bucketMs;
    let b = buckets.get(ts);
    if (!b) {
      b = { timestamp: ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, hasVolume: false };
      buckets.set(ts, b);
    } else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
    }
    if (Number.isFinite(Number(c.volume)) && Number(c.volume) > 0) {
      b.volume += Number(c.volume);
      b.hasVolume = true;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.hasVolume ? b.volume : null
    }));
}

async function loadLibrary() {
  try {
    const lib = require('dukascopy-node');
    const fn = lib.getHistoricalRates || lib.getHistoricRates;
    if (typeof fn !== 'function') throw new Error('getHistoricalRates missing');
    return fn;
  } catch (error) {
    throw new Error('DUKASCOPY_NODE_NOT_INSTALLED');
  }
}

function is429(error) {
  return Number(error?.response?.status) === 429 || /\b429\b/.test(String(error?.message || ''));
}

function enqueueDatafeedJob(label, job) {
  const run = async () => {
    const now = Date.now();
    if (cooldownUntil > now) {
      throw new Error(`DUKASCOPY_HUB_COOLDOWN_${Math.ceil((cooldownUntil - now) / 1000)}S`);
    }

    const gap = GLOBAL_JOB_GAP_MS - (Date.now() - lastJobFinishedAt);
    if (gap > 0) await sleep(gap);

    try {
      return await job();
    } catch (error) {
      if (is429(error)) {
        cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.log(`🧊 Dukascopy hub 429 cooldown activated (${Math.round(RATE_LIMIT_COOLDOWN_MS / 1000)}s)`);
      }
      throw error;
    } finally {
      lastJobFinishedAt = Date.now();
    }
  };

  const promise = queueTail.then(run, run);
  queueTail = promise.catch(() => {});
  return promise;
}

async function fetchSource(pair, sourceTimeframe, lookbackMs) {
  const getHistoricalRates = await loadLibrary();
  const rows = await getHistoricalRates({
    instrument: String(pair || '').toLowerCase(),
    dates: {
      from: new Date(Date.now() - lookbackMs),
      to: new Date()
    },
    timeframe: sourceTimeframe,
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
  return normalize(rows);
}

async function fetchDatafeed(pair, interval) {
  if (interval === '5min') {
    const minuteRows = await fetchSource(pair, 'm1', 9 * 60 * 60 * 1000);
    if (minuteRows.length >= 150) return aggregate(minuteRows, 5).slice(-100);
    const direct = await fetchSource(pair, 'm5', 12 * 60 * 60 * 1000);
    return direct.slice(-100);
  }

  if (interval === '15min') {
    const minuteRows = await fetchSource(pair, 'm1', 16 * 60 * 60 * 1000);
    if (minuteRows.length >= 300) return aggregate(minuteRows, 15).slice(-100);
    console.log(`🟢 Dukascopy direct m15 fallback: ${pair}`);
    const direct = await fetchSource(pair, 'm15', 30 * 60 * 60 * 1000);
    return direct.slice(-100);
  }

  if (interval === '1h') {
    const rows15 = await fetchSource(pair, 'm15', 5 * 24 * 60 * 60 * 1000);
    if (rows15.length >= 80) return aggregate(rows15, 60).slice(-100);
    const direct = await fetchSource(pair, 'h1', 7 * 24 * 60 * 60 * 1000);
    return direct.slice(-100);
  }

  if (interval === '1min') {
    return (await fetchSource(pair, 'm1', 3 * 60 * 60 * 1000)).slice(-100);
  }

  throw new Error(`Unsupported Dukascopy interval: ${interval}`);
}

function validateCandles(symbol, interval, candles) {
  const minimum = interval === '15min' ? 50 : interval === '5min' ? 30 : 20;
  if (candles.length < minimum) {
    throw new Error(`Insufficient Dukascopy datafeed candles ${symbol} ${interval}: ${candles.length}/${minimum}`);
  }
  const lastTs = Number(candles.at(-1)?.timestamp);
  const ageMs = Number.isFinite(lastTs) ? Date.now() - lastTs : Infinity;
  if (!Number.isFinite(lastTs) || ageMs > maxAge(interval)) {
    throw new Error(`STALE_DUKASCOPY_DATAFEED ${symbol} ${interval} age=${Math.round(ageMs / 60000)}m`);
  }
  return ageMs;
}

async function getDukascopyCandles(pair, interval = '15min') {
  const symbol = String(pair || '').trim().toUpperCase();
  if (symbol === 'BTCUSD') throw new Error('Dukascopy datafeed disabled for BTCUSD');

  const key = `${symbol}:${interval}`;
  const cached = candleCache.get(key);
  const cacheAge = cached ? Date.now() - cached.time : Infinity;

  if (cached && cacheAge <= ttl(interval)) {
    console.log(`🟢 Dukascopy datafeed cache: ${key}`);
    return cached.candles;
  }

  if (inFlight.has(key)) {
    console.log(`⏳ Shared Dukascopy datafeed request: ${key}`);
    return inFlight.get(key);
  }

  const promise = enqueueDatafeedJob(key, async () => {
    try {
      const candles = await fetchDatafeed(symbol, interval);
      const ageMs = validateCandles(symbol, interval, candles);
      candleCache.set(key, { candles, time: Date.now() });
      console.log(`✅ DUKASCOPY DATAFEED ${symbol} ${interval}: ${candles.length} candles | age=${Math.round(ageMs / 60000)}m`);
      return candles;
    } catch (error) {
      if (cached && cacheAge <= ttl(interval) + staleGrace(interval)) {
        console.log(`🛟 Dukascopy stale-if-error cache: ${key} | cacheAge=${Math.round(cacheAge / 60000)}m | ${error.message}`);
        return cached.candles;
      }
      throw error;
    }
  });

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

function isDukascopyConfigured() {
  try {
    require.resolve('dukascopy-node');
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { getDukascopyCandles, isDukascopyConfigured };
