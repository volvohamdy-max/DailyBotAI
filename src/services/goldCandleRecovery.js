const axios = require('axios');
const marketService = require('./marketService');

// Unified LIVE gold data policy:
// - XAUUSD live price: marketService -> GoldAPI
// - Candle SHAPE: Binance PAXGUSDT proxy
// - Every consumer receives a freshly calibrated COPY anchored to current GoldAPI.
// Raw proxy candles may stay cached for provider pressure, but their old price
// calibration is never reused by live strategy scans.
const recoveryCache = new Map();
const inFlight = new Map();

function recoveryCacheMs(interval) {
  if (interval === '5min') return 5 * 60 * 1000;
  if (interval === '15min') return 15 * 60 * 1000;
  if (interval === '1h') return 60 * 60 * 1000;
  return Number(process.env.GOLD_CANDLE_RECOVERY_CACHE_MS) || 5 * 60 * 1000;
}
function candleBucket(timestamp, interval) { return Math.floor(Number(timestamp) / recoveryCacheMs(interval)); }
function cacheIsCurrent(cached, interval) { return !!cached && Number.isFinite(cached.time) && candleBucket(cached.time, interval) === candleBucket(Date.now(), interval); }
function minBars(interval) { if (interval === '5min') return 120; if (interval === '15min') return 100; if (interval === '1h') return 100; return 100; }
function binanceInterval(interval) { return ({ '1min':'1m', '5min':'5m', '15min':'15m', '30min':'30m', '1h':'1h' })[interval] || null; }

async function getBinanceGoldProxyRaw(interval, wanted) {
  const tf = binanceInterval(interval);
  if (!tf) throw new Error(`Unsupported Binance gold proxy interval: ${interval}`);
  const limit = Math.max(150, Math.min(1000, wanted + 30));
  const { data } = await axios.get('https://api.binance.com/api/v3/klines', { params: { symbol: 'PAXGUSDT', interval: tf, limit }, timeout: Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000 });
  const rows = (Array.isArray(data) ? data : []).map(r => ({ timestamp:Number(r[0]), open:Number(r[1]), high:Number(r[2]), low:Number(r[3]), close:Number(r[4]), volume:Number(r[5] || 0) })).filter(r => Number.isFinite(r.timestamp) && [r.open,r.high,r.low,r.close].every(Number.isFinite));
  if (rows.length < wanted) throw new Error(`PAXGUSDT short history ${rows.length}/${wanted}`);
  return rows;
}

async function calibrateToLiveGold(rows, interval, sourceLabel) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty gold proxy candles');
  const proxyLast = Number(rows.at(-1)?.close);
  const goldPrice = Number(await marketService.getPrice('XAUUSD'));
  if (!(proxyLast > 0) || !(goldPrice > 0)) throw new Error('Invalid proxy calibration price');
  const calibration = goldPrice / proxyLast;
  const calibrated = rows.map(c => ({ ...c, open:c.open*calibration, high:c.high*calibration, low:c.low*calibration, close:c.close*calibration }));
  console.log(`🪙 GOLD LIVE CALIBRATION ${sourceLabel} ${interval} | proxy=${proxyLast.toFixed(2)} | live=${goldPrice.toFixed(2)} | factor=${calibration.toFixed(6)}`);
  return calibrated;
}

async function getGoldCandlesResilient(interval, wantedBars = null) {
  const required = Math.max(minBars(interval), Number(wantedBars) || 0);
  const key = `XAUUSD:${interval}:${required}`;
  const cached = recoveryCache.get(key);
  if (cached && cached.raw?.length >= required && cacheIsCurrent(cached, interval)) {
    console.log(`GOLD CANDLE RAW CACHE: XAUUSD:${interval} | source=Binance-PAXG-Proxy | bars=${cached.raw.length}`);
    return calibrateToLiveGold(cached.raw, interval, 'CACHE');
  }
  if (inFlight.has(key)) {
    console.log(`Shared gold proxy request: XAUUSD:${interval}`);
    const raw = await inFlight.get(key);
    return calibrateToLiveGold(raw, interval, 'SHARED');
  }
  const promise = (async () => {
    const raw = await getBinanceGoldProxyRaw(interval, required);
    recoveryCache.set(key, { raw, time:Date.now(), source:'Binance-PAXG-Proxy' });
    return raw;
  })();
  inFlight.set(key, promise);
  try {
    const raw = await promise;
    return await calibrateToLiveGold(raw, interval, 'FRESH');
  } finally {
    inFlight.delete(key);
  }
}
module.exports = { getGoldCandlesResilient };
