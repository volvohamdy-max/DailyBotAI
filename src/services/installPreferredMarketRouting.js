const axios = require('axios');
const config = require('../config');
const marketService = require('./marketService');
const { getTwelveForexCandles } = require('./twelveForexFallback');
const { getDukascopyCandles, isDukascopyConfigured } = require('./dukascopyMarketData');
const {
  getMassiveGoldCandles,
  getMassiveGoldPrice,
  isMassiveConfigured
} = require('./massiveMarketData');

const FX_PAIRS = new Set(['EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY']);
const cache = new Map();
const inFlight = new Map();
let twelveGoldCooldownUntil = 0;
let lastTwelveGoldAt = 0;

const TIMEOUT = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
  return ({'1min':'1m','5min':'5m','15min':'15m','30min':'30m','1h':'1h'})[tf] || null;
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
function validate(symbol, tf, candles, requireVolume = false) {
  const min = tf === '15min' ? 50 : tf === '5min' ? 30 : 20;
  if (!Array.isArray(candles) || candles.length < min) {
    throw new Error(`Insufficient candles ${symbol} ${tf}: ${candles?.length || 0}/${min}`);
  }
  const lastTs = Number(candles.at(-1)?.timestamp);
  if (Number.isFinite(lastTs) && Date.now() - lastTs > maxAge(tf)) {
    throw new Error(`STALE_CANDLES ${symbol} ${tf}`);
  }
  if (requireVolume) {
    const count = candles.slice(-24).filter(c => Number(c.volume) > 0).length;
    if (count < 12) throw new Error(`Missing usable volume ${symbol} ${tf}: ${count}/24`);
  }
  return candles.slice(-100);
}

async function siftingGoldCandles(tf) {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY not configured');
  const interval = tfSifting(tf);
  if (!interval) throw new Error(`Unsupported Sifting interval ${tf}`);
  const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date().toISOString();
  const { data } = await axios.get('https://api.sifting.io/v1/hist/commodities/XAUUSD/bars', {
    headers: { 'X-API-Key': apiKey, 'Accept-Encoding': 'gzip' },
    params: { start, end, interval, limit: 2000 },
    timeout: TIMEOUT
  });
  const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return validate('XAUUSD', tf, normalize(rows), tf === '5min');
}

async function twelveGoldCandles(tf) {
  if (!config.twelveDataKey) throw new Error('Twelve Data API key not configured');
  if (twelveGoldCooldownUntil > Date.now()) {
    throw new Error(`TWELVE_GOLD_COOLDOWN_${Math.ceil((twelveGoldCooldownUntil-Date.now())/1000)}S`);
  }
  const gap = 2500 - (Date.now() - lastTwelveGoldAt);
  if (gap > 0) await sleep(gap);
  lastTwelveGoldAt = Date.now();
  try {
    const { data } = await axios.get('https://api.twelvedata.com/time_series', {
      params: { symbol: 'XAU/USD', interval: tf, outputsize: 100, apikey: config.twelveDataKey },
      timeout: TIMEOUT
    });
    if (!Array.isArray(data?.values)) throw new Error(data?.message || 'No TwelveData XAU values');
    return validate('XAUUSD', tf, normalize(data.values.slice().reverse()));
  } catch (e) {
    if (Number(e?.response?.status) === 429 || /429/.test(String(e?.message || ''))) {
      twelveGoldCooldownUntil = Date.now() + 60 * 1000;
    }
    throw e;
  }
}

async function goldPriceGoldApi() {
  const { data } = await axios.get('https://api.gold-api.com/price/XAU', {
    timeout: TIMEOUT,
    headers: { 'User-Agent': 'ForexAIBot/1.0' }
  });
  const p = Number(data?.price ?? data?.ask ?? data?.bid);
  if (!Number.isFinite(p) || p <= 0) throw new Error('Invalid GoldAPI XAU price');
  return p;
}
async function goldPriceSifting() {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY not configured');
  const { data } = await axios.get('https://api.sifting.io/v1/last/quote/commodities/XAUUSD', {
    headers: { 'X-API-Key': apiKey }, timeout: TIMEOUT
  });
  const bid = Number(data?.b), ask = Number(data?.a);
  const p = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : (Number.isFinite(bid) ? bid : ask);
  if (!Number.isFinite(p) || p <= 0) throw new Error('Invalid Sifting XAU price');
  return p;
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

if (!marketService.__preferredRoutingInstalled) {
  const nativeGetCandles = marketService.getCandles.bind(marketService);
  const nativeGetPrice = marketService.getPrice.bind(marketService);

  marketService.getCandles = async function preferredCandles(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();
    const tf = String(interval || '15min');

    if (symbol === 'BTCUSD') return nativeGetCandles(symbol, tf);

    if (symbol === 'XAUUSD') {
      return cached(`${symbol}:${tf}`, tf, async () => {
        const chain = [
          ['SiftingIO', () => siftingGoldCandles(tf)],
          ['TwelveData', () => twelveGoldCandles(tf)],
          ['Dukascopy', () => getDukascopyCandles(symbol, tf)],
          ['Massive', () => getMassiveGoldCandles(tf)]
        ];
        let lastError;
        for (const [name, fn] of chain) {
          if (name === 'Dukascopy' && !isDukascopyConfigured()) continue;
          if (name === 'Massive' && !isMassiveConfigured()) continue;
          try {
            console.log(`🌐 Preferred candle provider ${name}: ${symbol} ${tf}`);
            const candles = await fn();
            console.log(`✅ CANDLES ${symbol} ${tf}: ${candles.length} | source=${name}`);
            return candles;
          } catch (e) {
            lastError = e;
            console.log(`⚠️ ${name} candles failed ${symbol} ${tf}: ${e.response?.status || e.message}`);
          }
        }
        throw lastError || new Error(`All preferred XAU candle providers failed ${tf}`);
      });
    }

    if (FX_PAIRS.has(symbol)) {
      return cached(`${symbol}:${tf}`, tf, async () => {
        try {
          console.log(`🌐 Preferred candle provider TwelveData: ${symbol} ${tf}`);
          const candles = await getTwelveForexCandles(symbol, tf);
          console.log(`✅ CANDLES ${symbol} ${tf}: ${candles.length} | source=TwelveData`);
          return candles;
        } catch (twelveError) {
          console.log(`⚠️ TwelveData candles failed ${symbol} ${tf}: ${twelveError.response?.status || twelveError.message}`);
          if (isDukascopyConfigured()) {
            try {
              console.log(`🟢 Emergency candle provider Dukascopy: ${symbol} ${tf}`);
              const candles = await getDukascopyCandles(symbol, tf);
              console.log(`✅ CANDLES ${symbol} ${tf}: ${candles.length} | source=Dukascopy`);
              return candles;
            } catch (dError) {
              console.log(`⚠️ Dukascopy candles failed ${symbol} ${tf}: ${dError.message}`);
            }
          }
          throw twelveError;
        }
      });
    }

    return nativeGetCandles(symbol, tf);
  };

  marketService.getPrice = async function preferredPrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return nativeGetPrice(symbol);

    const key = 'XAUUSD:price';
    const item = cache.get(key);
    if (item && Date.now() - item.time <= 30000) return item.value;

    const chain = [
      ['GoldAPI', goldPriceGoldApi],
      ['SiftingIO-Price', goldPriceSifting],
      ['Massive', () => getMassiveGoldPrice()]
    ];
    let lastError;
    for (const [name, fn] of chain) {
      if (name === 'Massive' && !isMassiveConfigured()) continue;
      try {
        console.log(`🌐 Preferred price provider ${name}: XAUUSD`);
        const p = await fn();
        cache.set(key, { value: p, time: Date.now() });
        console.log(`✅ PRICE XAUUSD: ${p} | source=${name}`);
        return p;
      } catch (e) {
        lastError = e;
        console.log(`⚠️ ${name} price failed XAUUSD: ${e.response?.status || e.message}`);
      }
    }
    try { return await nativeGetPrice(symbol); } catch (_) { throw lastError || _; }
  };

  Object.defineProperty(marketService, '__preferredRoutingInstalled', {
    value: true, enumerable: false, configurable: false
  });

  console.log('🧭 Preferred market routing READY');
  console.log('🥇 XAU candles: SiftingIO → TwelveData → Dukascopy → Massive');
  console.log('🥇 XAU price: GoldAPI → SiftingIO → Massive');
  console.log('🥇 FX candles: TwelveData → Dukascopy emergency');
}

module.exports = marketService;
