const axios = require('axios');
const marketService = require('./marketService');

// Keep the existing installer path so current startup wiring stays unchanged,
// but XAUUSD live/execution price now comes from GoldAPI first.
const CACHE_MS = Number(process.env.GOLDAPI_LIVE_CACHE_MS) || 1200;
const TIMEOUT_MS = Number(process.env.GOLDAPI_LIVE_TIMEOUT_MS) || 7000;
let cache = null;
let inFlight = null;

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getGoldApiPrice() {
  const { data } = await axios.get(
    'https://api.gold-api.com/price/XAU',
    {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'ForexAIBot/1.0'
      }
    }
  );

  const price = positive(
    data?.price ??
    data?.price_gram_24k ??
    data?.ask ??
    data?.bid
  );

  if (price == null) {
    throw new Error(data?.message || 'Invalid GoldAPI XAU price');
  }

  return {
    price,
    time: Date.now(),
    source: 'GoldAPI'
  };
}

if (!marketService.__goldApiLivePriceInstalled) {
  const previousGetPrice = marketService.getPrice.bind(marketService);

  marketService.getPrice = async function goldApiLivePrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return previousGetPrice(symbol);

    const now = Date.now();
    if (cache && now - cache.time <= CACHE_MS) {
      return cache.price;
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const quote = await getGoldApiPrice();
        cache = quote;
        console.log(`🥇 XAU PRICE GoldAPI | price=${quote.price} | cache=${CACHE_MS}ms`);
        return quote.price;
      } catch (error) {
        // A very short GoldAPI cache protects active trade monitoring from a
        // transient network error without switching immediately to a stale quote.
        if (cache && now - cache.time <= 15000) {
          console.log(`⚠️ GoldAPI temporary failure; using ${now - cache.time}ms cached GoldAPI price`);
          return cache.price;
        }

        console.log(`⚠️ GoldAPI live price failed; using market fallback | ${error.response?.status || error.message}`);
        return previousGetPrice(symbol);
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  Object.defineProperty(marketService, '__goldApiLivePriceInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(`🥇 XAU LIVE PRICE OVERRIDE: GoldAPI PRIMARY | cache=${CACHE_MS}ms | existing market route=fallback`);
}

module.exports = marketService;
