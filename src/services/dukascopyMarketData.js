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

function timeframe(interval) {
  return ({
    '1min': 'm1',
    '5min': 'm5',
    '15min': 'm15',
    '30min': 'm30',
    '1h': 'h1'
  })[interval] || null;
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
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-100);
}

async function fetchDatafeed(pair, interval) {
  let getHistoricalRates;
  try {
    ({ getHistoricalRates } = require('dukascopy-node'));
  } catch (error) {
    throw new Error('DUKASCOPY_NODE_NOT_INSTALLED');
  }

  const tf = timeframe(interval);
  if (!tf) throw new Error(`Unsupported Dukascopy interval: ${interval}`);

  const lookbackMs = interval === '1h'
    ? 8 * 24 * 60 * 60 * 1000
    : 3 * 24 * 60 * 60 * 1000;

  const rows = await getHistoricalRates({
    instrument: String(pair || '').toLowerCase(),
    dates: {
      from: new Date(Date.now() - lookbackMs),
      to: new Date()
    },
    timeframe: tf,
    format: 'json',
    priceType: 'bid',
    volumes: true,
    batchSize: 2,
    pauseBetweenBatchesMs: 1200,
    useCache: true,
    cacheFolderPath: './data/dukascopy-cache'
  });

  return normalize(rows);
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
    console.log(`✅ DUKASCOPY DATAFEED ${symbol} ${interval}: ${candles.length} candles`);
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
