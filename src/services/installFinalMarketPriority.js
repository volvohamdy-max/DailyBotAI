const axios = require('axios');
const config = require('../config');
const marketService = require('./marketService');
const { getGoldProxyCandles } = require('./goldProxyFallback');
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

let siftingTail = Promise.resolve();
let lastSiftingAt = 0;
let siftingCooldownUntil = 0;
let twelveGoldCooldownUntil = 0;
let lastTwelveGoldAt = 0;

const TIMEOUT = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;
const SIFTING_GAP_MS = Number(process.env.SIFTING_GLOBAL_GAP_MS) || 2500;
const SIFTING_429_COOLDOWN_MS = Number(process.env.SIFTING_429_COOLDOWN_MS) || 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function is429(error) {
  return Number(error?.response?.status) === 429 || /\b429\b/.test(String(error?.message || ''));
}

function enqueueSifting(task) {
  const run = async () => {
    if (siftingCooldownUntil > Date.now()) {
      throw new Error(`SIFTING_COOLDOWN_${Math.ceil((siftingCooldownUntil - Date.now()) / 1000)}S`);
    }

    const gap = SIFTING_GAP_MS - (Date.now() - lastSiftingAt);
    if (gap > 0) await sleep(gap);

    try {
      return await task();
    } catch (error) {
      if (is429(error)) {
        siftingCooldownUntil = Date.now() + SIFTING_429_COOLDOWN_MS;
        console.log(`🧊 Sifting global cooldown activated (${Math.round(SIFTING_429_COOLDOWN_MS / 1000)}s)`);
      }
      throw error;
    } finally {
      lastSiftingAt = Date.now();
    }
  };

  const p = siftingTail.then(run, run);
  siftingTail = p.catch(() => {});
  return p;
}

async function siftingBars(kind, pair, tf, requireVolume = false) {
  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) throw new Error('SIFTING_API_KEY not configured');

  const interval = tfSifting(tf);
  if (!interval) throw new Error(`Unsupported Sifting interval ${tf}`);

  return enqueueSifting(async () => {
    const start = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const url = kind === 'commodities'
      ? `https://api.sifting.io/v1/hist/commodities/${pair}/bars`
      : `https://api.sifting.io/v1/hist/forex/${pair}/bars`;

    const { data } = await axios.get(url, {
      headers: { 'X-API-Key': apiKey, 'Accept-Encoding': 'gzip' },
      params: { start, end, interval, limit: kind === 'commodities' ? 2000 : 500 },
      timeout: TIMEOUT
    });

    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return validate(pair, tf, normalize(rows), requireVolume);
  });
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
  } catch (error) {
    if (is429(error)) twelveGoldCooldownUntil = Date.now() + 60 * 1000;
    throw error;
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

  return enqueueSifting(async () => {
    const { data } = await axios.get('https://api.sifting.io/v1/last/quote/commodities/XAUUSD', {
      headers: { 'X-API-Key': apiKey },
      timeout: TIMEOUT
    });
    const bid = Number(data?.b);
    const ask = Number(data?.a);
    const p = Number.isFinite(bid) && Number.isFinite(ask)
      ? (bid + ask) / 2
      : (Number.isFinite(bid) ? bid : ask);
    if (!Number.isFinite(p) || p <= 0) throw new Error('Invalid Sifting XAU price');
    return p;
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
  try {
    return await p;
  } finally {
    inFlight.delete(key);
  }
}

async function firstSuccess(label, chain) {
  let lastError = null;
  for (const [name, fn, enabled = true] of chain) {
    if (!enabled) continue;
    try {
      console.log(`🌐 ${label} provider ${name}`);
      const value = await fn();
      console.log(`✅ ${label} source=${name}`);
      return value;
    } catch (error) {
      lastError = error;
      console.log(`⚠️ ${label} ${name} failed: ${error.response?.status || error.message}`);
    }
  }
  throw lastError || new Error(`${label}: all providers failed`);
}

if (!marketService.__finalMarketPriorityInstalled) {
  const nativeGetCandles = marketService.getCandles.bind(marketService);
  const nativeGetPrice = marketService.getPrice.bind(marketService);

  marketService.getCandles = async function finalPriorityCandles(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();
    const tf = String(interval || '15min');

    if (symbol === 'BTCUSD') return nativeGetCandles(symbol, tf);

    if (symbol === 'XAUUSD') {
      return cached(`FINAL:${symbol}:${tf}`, tf, async () => {
        return firstSuccess(`XAUUSD ${tf}`, [
          ['PAXG/XAUT Proxy', () => getGoldProxyCandles(tf)],
          ['SiftingIO', () => siftingBars('commodities', 'XAUUSD', tf, tf === '5min')],
          ['TwelveData', () => twelveGoldCandles(tf)],
          ['Dukascopy', () => getDukascopyCandles(symbol, tf), isDukascopyConfigured()],
          ['Massive', () => getMassiveGoldCandles(tf), isMassiveConfigured()]
        ]);
      });
    }

    if (FX_PAIRS.has(symbol)) {
      return cached(`FINAL:${symbol}:${tf}`, tf, async () => {
        return firstSuccess(`${symbol} ${tf}`, [
          ['SiftingIO', () => siftingBars('forex', symbol, tf)],
          ['TwelveData', () => getTwelveForexCandles(symbol, tf)],
          ['Dukascopy', () => getDukascopyCandles(symbol, tf), isDukascopyConfigured()]
        ]);
      });
    }

    return nativeGetCandles(symbol, tf);
  };

  marketService.getPrice = async function finalPriorityPrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return nativeGetPrice(symbol);

    const key = 'FINAL:XAUUSD:price';
    const item = cache.get(key);
    if (item && Date.now() - item.time <= 30000) return item.value;

    const price = await firstSuccess('XAUUSD price', [
      ['GoldAPI', goldPriceGoldApi],
      ['SiftingIO', goldPriceSifting],
      ['Massive', () => getMassiveGoldPrice(), isMassiveConfigured()]
    ]);

    cache.set(key, { value: price, time: Date.now() });
    return price;
  };

  Object.defineProperty(marketService, '__finalMarketPriorityInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log('🎯 FINAL MARKET PRIORITY READY');
  console.log('🥇 XAU candles: PAXG/XAUT Proxy → SiftingIO → TwelveData → Dukascopy → Massive');
  console.log('🥇 XAU price: GoldAPI → SiftingIO → Massive');
  console.log('🥇 FX candles: SiftingIO → TwelveData → Dukascopy');
  console.log(`🧵 Sifting global queue: ${SIFTING_GAP_MS}ms | 429 cooldown=${Math.round(SIFTING_429_COOLDOWN_MS/1000)}s`);
  console.log('🚫 FX legacy candle fallthrough disabled: no AlphaVantage/Yahoo in this route');
}

module.exports = marketService;
