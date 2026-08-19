const axios = require('axios');

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const cache = new Map();
const inFlight = new Map();
const TTL_MS = Number(process.env.YAHOO_FOREX_CACHE_MS) || 10 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

const SYMBOLS = {
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'JPY=X',
  EURJPY: 'EURJPY=X',
  GBPJPY: 'GBPJPY=X',
  CHFJPY: 'CHFJPY=X'
};

function normalizeTimestamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n < 1e12 ? n * 1000 : n;
}

function maxAgeMs(interval) {
  if (interval === '15min') return 60 * 60 * 1000;
  if (interval === '5min') return 30 * 60 * 1000;
  if (interval === '1h') return 2 * 60 * 60 * 1000;
  return 60 * 60 * 1000;
}

async function fetchYahooCandles(pair, interval = '15min') {
  const p = String(pair || '').toUpperCase();
  const yahoo = SYMBOLS[p];
  if (!yahoo) throw new Error(`Yahoo forex symbol unsupported: ${p}`);
  if (!['5min','15min','1h'].includes(interval)) {
    throw new Error(`Yahoo forex interval unsupported: ${interval}`);
  }

  const key = `${p}:${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time <= TTL_MS) {
    console.log(`🟦 Yahoo Forex cache: ${key}`);
    return cached.candles;
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const apiInterval = interval === '1h' ? '60m' : interval.replace('min','m');
    const range = interval === '1h' ? '10d' : '5d';
    const url = `${BASE}/${encodeURIComponent(yahoo)}`;
    const { data } = await axios.get(url, {
      params: { interval: apiInterval, range, includePrePost: false, events: 'div,splits' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*'
      },
      timeout: TIMEOUT_MS
    });

    const result = data?.chart?.result?.[0];
    const ts = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const q = result?.indicators?.quote?.[0] || {};
    const candles = ts.map((t, i) => ({
      timestamp: normalizeTimestamp(t),
      open: Number(q.open?.[i]),
      high: Number(q.high?.[i]),
      low: Number(q.low?.[i]),
      close: Number(q.close?.[i]),
      volume: Number.isFinite(Number(q.volume?.[i])) && Number(q.volume?.[i]) > 0 ? Number(q.volume?.[i]) : null
    })).filter(c =>
      Number.isFinite(c.timestamp) && c.timestamp > 0 &&
      Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close)
    ).sort((a,b) => a.timestamp - b.timestamp).slice(-100);

    if (candles.length < 20) {
      throw new Error(`Insufficient Yahoo candles ${p} ${interval}: ${candles.length}/20`);
    }

    const lastTs = Number(candles.at(-1)?.timestamp);
    if (!Number.isFinite(lastTs) || Date.now() - lastTs > maxAgeMs(interval)) {
      throw new Error(`STALE_YAHOO_CANDLES ${p} ${interval}`);
    }

    cache.set(key, { candles, time: Date.now() });
    console.log(`✅ YAHOO FOREX CANDLES ${p} ${interval}: ${candles.length}`);
    return candles;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { fetchYahooCandles, YAHOO_FOREX_PAIRS: new Set(Object.keys(SYMBOLS)) };
