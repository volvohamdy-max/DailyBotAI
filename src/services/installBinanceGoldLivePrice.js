const marketService = require('./marketService');
const { getGoldProxyPrice } = require('./goldProxyFallback');

const CACHE_MS = Number(process.env.BINANCE_GOLD_LIVE_CACHE_MS) || 1200;
let cache = null;
let inFlight = null;

if (!marketService.__binanceGoldLivePriceInstalled) {
  const previousGetPrice = marketService.getPrice.bind(marketService);

  marketService.getPrice = async function binanceGoldLivePrice(pair) {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') return previousGetPrice(symbol);

    const now = Date.now();
    if (cache && now - cache.time <= CACHE_MS) {
      return cache.price;
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const quote = await getGoldProxyPrice();
        cache = quote;
        console.log(`⚡ XAU PRICE PROXY ${quote.symbol} | price=${quote.price} | cache=${CACHE_MS}ms`);
        return quote.price;
      } catch (error) {
        if (cache && now - cache.time <= 15000) {
          console.log(`⚠️ Binance proxy temporary failure; using ${now - cache.time}ms cached proxy`);
          return cache.price;
        }
        throw error;
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  Object.defineProperty(marketService, '__binanceGoldLivePriceInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(`⚡ XAU LIVE PRICE OVERRIDE: Binance PAXGUSDT → XAUTUSDT | cache=${CACHE_MS}ms | no GoldAPI/Sifting dependency`);
}

module.exports = marketService;
