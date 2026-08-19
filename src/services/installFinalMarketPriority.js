const axios = require('axios');
const marketService = require('./marketService');
const { getGoldProxyCandles } = require('./goldProxyFallback');

const FX_PAIRS = new Set(['EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY']);
const cache = new Map();
const inFlight = new Map();
let siftingTail = Promise.resolve();
let lastSiftingAt = 0;

const TIMEOUT = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;
const SIFTING_FX_GAP_MS = Number(process.env.SIFTING_FX_GAP_MS) || 1800;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function ttl(tf) {
  if (tf === '5min') return 4 * 60 * 1000;
  if (tf === '15min') return 10 * 60 * 1000;
  if (tf === '1h') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function maxAge(tf) {
  if (tf === '5min') return 20 * 60 * 1000;
  if (tf === '15min') return 45 * 60 * 1000;
  if (tf === '1h') return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

function tfSifting(tf) {
  return ({ '1min':'1m', '5min':'5m', '15min':'15m', '30min':'30m', '1h':'1h' })[tf] || null;
}

function normalizeTimestamp(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return NaN;
}

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    timestamp: normalizeTimestamp(r.timestamp ?? r.t ?? r.datetime ?? r.time),
    open: Number(r.open ?? r.o),
    high: Number(r.high ?? r.h),
    low: Number(r.low ?? r.l),
    close: Number(r.close ?? r.c),
    volume: Number.isFinite(Number(r.volume ?? r.v ?? r.tick_volume ?? r.tickVolume))
      ? Number(r.volume ?? r.v ?? r.tick_volume ?? r.tickVolume)
      : null
  })).filter(c =>
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close)
  ).sort((a,b) => (Number(a.timestamp)||0) - (Number(b.timestamp)||0));
}

function validate(symbol, tf, candles) {
  const min = tf === '15min' ? 50 : tf === '5min' ? 30 : 20;
  if (!Array.isArray(candles) || candles.length < min) {
    throw new Error(`Insufficient Sifting FX candles ${symbol} ${tf}: ${candles?.length || 0}/${min}`);
  }
  const lastTs = Number(candles.at(-1)?.timestamp);
  if (Number.isFinite(lastTs) && Date.now() - lastTs > maxAge(tf)) {
    throw new Error(`STALE_SIFTING_FX ${symbol} ${tf}`);
  }
  return candles.slice(-100);
}

function enqueueSifting(task) {
  const run = async () => {
    const gap = SIFTING_FX_GAP_MS - (Date.now() - lastSiftingAt);
    if (gap > 0) await sleep(gap);
    try {
      return await task();
    } finally {
      lastSiftingAt = Date.now();
    }
  };
  const p = siftingTail.then(run, run);
  siftingTail = p.catch(() => {});
  return p;
}

async function siftingForexCandles(pair, tf) {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY not configured');
  const interval = tfSifting(tf);
  if (!interval) throw new Error(`Unsupported Sifting FX interval ${tf}`);

  return enqueueSifting(async () => {
    const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const { data } = await axios.get(
      `https://api.sifting.io/v1/hist/forex/${pair}/bars`,
      {
        headers: { 'X-API-Key': apiKey, 'Accept-Encoding': 'gzip' },
        params: { start, end, interval, limit: 500 },
        timeout: TIMEOUT
      }
    );
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return validate(pair, tf, normalize(rows));
  });
}

async function cached(key, tf, loader) {
  const item = cache.get(key);
  if (item && Date.now() - item.time <= ttl(tf)) return item.value;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    const value = await loader();
    cache.set(key, { value, time: Date.now() });
    return value;
  })();
  inFlight.set(key, p);
  try { return await p; } finally { inFlight.delete(key); }
}

if (!marketService.__finalMarketPriorityInstalled) {
  const previousGetCandles = marketService.getCandles.bind(marketService);

  marketService.getCandles = async function finalPriorityCandles(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();
    const tf = String(interval || '15min');

    if (symbol === 'BTCUSD') return previousGetCandles(symbol, tf);

    if (symbol === 'XAUUSD') {
      return cached(`FINAL:${symbol}:${tf}`, tf, async () => {
        try {
          console.log(`🪙 PRIMARY GOLD CANDLES: PAXG/XAUT Proxy ${tf}`);
          const candles = await getGoldProxyCandles(tf);
          console.log(`✅ GOLD PRIMARY ${tf}: ${candles.length} | source=PAXG/XAUT Proxy`);
          return candles;
        } catch (proxyError) {
          console.log(`⚠️ Gold proxy primary failed ${tf}: ${proxyError.response?.status || proxyError.message}`);
          return previousGetCandles(symbol, tf);
        }
      });
    }

    if (FX_PAIRS.has(symbol)) {
      return cached(`FINAL:${symbol}:${tf}`, tf, async () => {
        try {
          console.log(`🌐 PRIMARY FX CANDLES: SiftingIO ${symbol} ${tf}`);
          const candles = await siftingForexCandles(symbol, tf);
          console.log(`✅ FX CANDLES ${symbol} ${tf}: ${candles.length} | source=SiftingIO`);
          return candles;
        } catch (siftingError) {
          console.log(`⚠️ SiftingIO FX failed ${symbol} ${tf}: ${siftingError.response?.status || siftingError.message}`);
          return previousGetCandles(symbol, tf);
        }
      });
    }

    return previousGetCandles(symbol, tf);
  };

  Object.defineProperty(marketService, '__finalMarketPriorityInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log('🎯 FINAL MARKET PRIORITY READY');
  console.log('🥇 XAU candles: PAXG/XAUT Proxy → SiftingIO → TwelveData → Dukascopy → Massive');
  console.log('🥇 XAU price: GoldAPI → SiftingIO → Massive');
  console.log('🥇 FX candles: SiftingIO → TwelveData → Dukascopy emergency');
}

module.exports = marketService;
