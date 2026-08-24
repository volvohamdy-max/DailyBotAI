const axios = require('axios');
const { getPrice } = require('./marketService');

// Unified LIVE gold data policy:
// - XAUUSD live price: marketService -> GoldAPI
// - ALL XAUUSD candles used by live gold strategies: Binance PAXGUSDT proxy
// - no SiftingIO / Dukascopy / TwelveData candle path for live gold strategies
const recoveryCache = new Map();
const inFlight = new Map();

function recoveryCacheMs(interval) {
  if (interval === '5min') return Number(process.env.GOLD_CANDLE_RECOVERY_5M_MS) || 4 * 60 * 1000;
  if (interval === '15min') return Number(process.env.GOLD_CANDLE_RECOVERY_15M_MS) || 10 * 60 * 1000;
  if (interval === '1h') return Number(process.env.GOLD_CANDLE_RECOVERY_1H_MS) || 30 * 60 * 1000;
  return Number(process.env.GOLD_CANDLE_RECOVERY_CACHE_MS) || 5 * 60 * 1000;
}

function minBars(interval) {
  if (interval === '5min') return 120;
  if (interval === '15min') return 100;
  if (interval === '1h') return 100;
  return 100;
}

function binanceInterval(interval) {
  return ({ '1min':'1m', '5min':'5m', '15min':'15m', '30min':'30m', '1h':'1h' })[interval] || null;
}

async function getBinanceGoldProxy(interval, wanted) {
  const tf = binanceInterval(interval);
  if (!tf) throw new Error(`Unsupported Binance gold proxy interval: ${interval}`);

  const limit = Math.max(150, Math.min(1000, wanted + 30));
  const { data } = await axios.get('https://api.binance.com/api/v3/klines', {
    params: { symbol: 'PAXGUSDT', interval: tf, limit },
    timeout: Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000
  });

  let rows = (Array.isArray(data) ? data : []).map(r => ({
    timestamp: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5] || 0)
  })).filter(r => Number.isFinite(r.timestamp) && [r.open,r.high,r.low,r.close].every(Number.isFinite));

  if (rows.length < wanted) throw new Error(`PAXGUSDT short history ${rows.length}/${wanted}`);

  const proxyLast = rows.at(-1)?.close;
  const goldPrice = Number(await getPrice('XAUUSD'));
  if (!(proxyLast > 0) || !(goldPrice > 0)) throw new Error('Invalid proxy calibration price');

  const calibration = goldPrice / proxyLast;
  rows = rows.map(c => ({
    ...c,
    open: c.open * calibration,
    high: c.high * calibration,
    low: c.low * calibration,
    close: c.close * calibration
  }));

  console.log(`🪙 GOLD PROXY OK PAXGUSDT ${interval} | bars=${rows.length} | calibration=${calibration.toFixed(6)}`);
  return rows;
}

async function getGoldCandlesResilient(interval, wantedBars = null) {
  const required = Math.max(minBars(interval), Number(wantedBars) || 0);
  const key = `XAUUSD:${interval}:${required}`;
  const cached = recoveryCache.get(key);
  const ttl = recoveryCacheMs(interval);

  if (cached && cached.candles?.length >= required && Date.now() - cached.time <= ttl) {
    console.log(`GOLD CANDLE RECOVERY CACHE: XAUUSD:${interval} | source=Binance-PAXG-Proxy | bars=${cached.candles.length}`);
    return cached.candles;
  }

  if (inFlight.has(key)) {
    console.log(`Shared gold proxy request: XAUUSD:${interval}`);
    return inFlight.get(key);
  }

  const promise = (async () => {
    const proxy = await getBinanceGoldProxy(interval, required);
    recoveryCache.set(key, { candles: proxy, time: Date.now(), source: 'Binance-PAXG-Proxy' });
    return proxy;
  })();

  inFlight.set(key, promise);
  try { return await promise; }
  finally { inFlight.delete(key); }
}

module.exports = { getGoldCandlesResilient };
