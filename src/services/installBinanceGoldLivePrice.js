const axios = require('axios');
const marketService = require('./marketService');
const config = require('../config');

// Temporary live-price provider test for XAUUSD:
// 1) TwelveData XAU/USD = PRIMARY
// 2) existing marketService route = FALLBACK
// Strategy conditions and candle logic are unchanged.
const CACHE_MS = Number(process.env.TWELVE_XAU_LIVE_CACHE_MS) || 1200;
const TIMEOUT_MS = Number(process.env.TWELVE_XAU_LIVE_TIMEOUT_MS) || 7000;
let cache = null;
let inFlight = null;

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getTwelvePrice() {
  const key = config.twelveDataKey || process.env.TWELVE_DATA_API_KEY || process.env.TWELVEDATA_API_KEY || '';
  if (!key) throw new Error('TwelveData API key not configured');

  const { data } = await axios.get('https://api.twelvedata.com/price', {
    params: { symbol: 'XAU/USD', apikey: key },
    timeout: TIMEOUT_MS
  });

  const price = positive(data?.price);
  if (price == null) throw new Error(data?.message || data?.status || 'Invalid TwelveData XAU/USD price');
  return { price, time: Date.now(), source: 'TwelveData' };
}

if (!marketService.__twelveXauLivePriceInstalled) {
  const previousGetPrice = marketService.getPrice.bind(marketService);

  marketService.getPrice = async function twelveXauLivePrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return previousGetPrice(symbol);

    const now = Date.now();
    if (cache && now - cache.time <= CACHE_MS) return cache.price;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const quote = await getTwelvePrice();
        cache = quote;
        console.log(`🥇 XAU PRICE TwelveData | price=${quote.price} | cache=${CACHE_MS}ms`);
        return quote.price;
      } catch (error) {
        if (cache && now - cache.time <= 15000) {
          console.log(`⚠️ TwelveData temporary failure; using ${now - cache.time}ms cached TwelveData price`);
          return cache.price;
        }
        console.log(`⚠️ TwelveData XAU live price failed; using market fallback | ${error.response?.status || error.message}`);
        return previousGetPrice(symbol);
      }
    })();

    try { return await inFlight; }
    finally { inFlight = null; }
  };

  Object.defineProperty(marketService, '__twelveXauLivePriceInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(`🥇 XAU LIVE PRICE OVERRIDE: TwelveData PRIMARY | cache=${CACHE_MS}ms | existing market route=fallback`);
}

module.exports = marketService;
