const candleCache = new Map();
const inFlight = new Map();

function ttl(interval) {
  if (interval === '5min') return 4 * 60 * 1000;
  if (interval === '15min') return 10 * 60 * 1000;
  if (interval === '1h') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
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
      b = {
        timestamp: ts,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
        hasVolume: false
      };
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
    pauseBetweenBatchesMs: 800,
    useCache: true,
    cacheFolderPath: './data/dukascopy-cache',
    retryCount: 2,
    pauseBetweenRetriesMs: 1000,
    retryOnEmpty: true
  });

  return normalize(rows);
}

async function fetchDatafeed(pair, interval) {
  // Build trading timeframes locally from fresher lower-timeframe data.
  // This avoids stale ready-made 15m/1h bars observed on the live feed.
  if (interval === '5min' || interval === '15min') {
    const lookbackMs = interval === '15min'
      ? 36 * 60 * 60 * 1000
      : 18 * 60 * 60 * 1000;
    const minuteRows = await fetchSource(pair, 'm1', lookbackMs);
    return aggregate(minuteRows, interval === '15min' ? 15 : 5).slice(-100);
  }

  if (interval === '1h') {
    const rows15 = await fetchSource(pair, 'm15', 7 * 24 * 60 * 60 * 1000);
    return aggregate(rows15, 60).slice(-100);
  }

  if (interval === '1min') {
    return (await fetchSource(pair, 'm1', 8 * 60 * 60 * 1000)).slice(-100);
  }

  throw new Error(`Unsupported Dukascopy interval: ${interval}`);
}

async function getDukascopyCandles(pair, interval = '15min') {
  const symbol = String(pair || '').trim().toUpperCase();
  if (symbol === 'BTCUSD') throw new Error('Dukascopy datafeed disabled for BTCUSD');

  const key = `${symbol}:${interval}`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.time <= ttl(interval)) {
    console.log(`🟢 Dukascopy datafeed cache: ${key}`);
    return cached.candles;
  }

  if (inFlight.has(key)) {
    console.log(`⏳ Shared Dukascopy datafeed request: ${key}`);
    return inFlight.get(key);
  }

  const promise = (async () => {
    const candles = await fetchDatafeed(symbol, interval);
    const minimum = interval === '15min' ? 55 : interval === '5min' ? 30 : 20;

    if (candles.length < minimum) {
      throw new Error(`Insufficient Dukascopy datafeed candles ${symbol} ${interval}: ${candles.length}/${minimum}`);
    }

    const lastTs = Number(candles.at(-1)?.timestamp);
    const ageMs = Number.isFinite(lastTs) ? Date.now() - lastTs : Infinity;
    if (!Number.isFinite(lastTs) || ageMs > maxAge(interval)) {
      throw new Error(`STALE_DUKASCOPY_DATAFEED ${symbol} ${interval} age=${Math.round(ageMs / 60000)}m`);
    }

    candleCache.set(key, { candles, time: Date.now() });
    console.log(`✅ DUKASCOPY DATAFEED ${symbol} ${interval}: ${candles.length} candles | age=${Math.round(ageMs / 60000)}m`);
    return candles;
  })();

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
