const axios = require('axios');
const marketService = require('./marketService');

// Keep the existing installer path so startup wiring stays unchanged.
// XAUUSD live/execution policy:
// 1) SiftingIO quote = PRIMARY
// 2) existing marketService route = FALLBACK (includes GoldAPI and other configured providers)
// Strategy conditions and candle logic are unchanged.
const CACHE_MS = Number(process.env.SIFTING_LIVE_CACHE_MS) || 1200;
const TIMEOUT_MS = Number(process.env.SIFTING_LIVE_TIMEOUT_MS) || 7000;
let cache = null;
let inFlight = null;

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getSiftingPrice() {
  const key = process.env.SIFTING_API_KEY || '';
  if (!key) throw new Error('SIFTING_API_KEY not configured');

  const { data } = await axios.get(
    'https://api.sifting.io/v1/last/quote/commodities/XAUUSD',
    {
      timeout: TIMEOUT_MS,
      headers: { 'X-API-Key': key }
    }
  );

  const bid = positive(data?.b);
  const ask = positive(data?.a);
  const price = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask);
  if (price == null) throw new Error(data?.message || 'Invalid SiftingIO XAUUSD quote');

  return { price, bid, ask, time: Date.now(), source: 'SiftingIO' };
}

if (!marketService.__siftingLivePriceInstalled) {
  const previousGetPrice = marketService.getPrice.bind(marketService);

  marketService.getPrice = async function siftingLivePrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return previousGetPrice(symbol);

    const now = Date.now();
    if (cache && now - cache.time <= CACHE_MS) return cache.price;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const quote = await getSiftingPrice();
        cache = quote;
        console.log(`🥇 XAU PRICE SiftingIO | bid=${quote.bid ?? '-'} | ask=${quote.ask ?? '-'} | mid=${quote.price} | cache=${CACHE_MS}ms`);
        return quote.price;
      } catch (error) {
        if (cache && now - cache.time <= 15000) {
          console.log(`⚠️ SiftingIO temporary failure; using ${now - cache.time}ms cached SiftingIO price`);
          return cache.price;
        }
        console.log(`⚠️ SiftingIO live price failed; using market fallback | ${error.response?.status || error.message}`);
        return previousGetPrice(symbol);
      }
    })();

    try { return await inFlight; }
    finally { inFlight = null; }
  };

  Object.defineProperty(marketService, '__siftingLivePriceInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(`🥇 XAU LIVE PRICE OVERRIDE: SiftingIO PRIMARY | cache=${CACHE_MS}ms | existing market route=fallback`);
}

module.exports = marketService;
