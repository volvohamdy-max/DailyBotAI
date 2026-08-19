const marketService = require('./marketService');
const {
  getMassiveGoldCandles,
  getMassiveGoldPrice,
  isMassiveConfigured
} = require('./massiveMarketData');

if (!marketService.__massiveFallbackInstalled) {
  const originalGetCandles = marketService.getCandles.bind(marketService);
  const originalGetPrice = marketService.getPrice.bind(marketService);

  marketService.getCandles = async function getCandlesWithMassive(pair, interval = '15min') {
    try {
      return await originalGetCandles(pair, interval);
    } catch (primaryError) {
      const symbol = String(pair || '').trim().toUpperCase();

      if (symbol !== 'XAUUSD' || !isMassiveConfigured()) {
        throw primaryError;
      }

      try {
        console.log(
          `🟣 MASSIVE MARKET FALLBACK: ${symbol} ${interval} | primary=${primaryError.message}`
        );

        const candles = await getMassiveGoldCandles(interval);

        console.log(
          `✅ MASSIVE CANDLES ${symbol} ${interval}: ${candles.length}`
        );

        return candles;
      } catch (massiveError) {
        console.log(
          `⚠️ Massive candles failed ${symbol} ${interval}:`,
          massiveError.response?.status || massiveError.message
        );

        throw primaryError;
      }
    }
  };

  marketService.getPrice = async function getPriceWithMassive(pair) {
    try {
      return await originalGetPrice(pair);
    } catch (primaryError) {
      const symbol = String(pair || '').trim().toUpperCase();

      if (symbol !== 'XAUUSD' || !isMassiveConfigured()) {
        throw primaryError;
      }

      try {
        console.log(
          `🟣 MASSIVE PRICE FALLBACK: ${symbol} | primary=${primaryError.message}`
        );

        const price = await getMassiveGoldPrice();

        console.log(
          `✅ MASSIVE PRICE ${symbol}: ${price}`
        );

        return price;
      } catch (massiveError) {
        console.log(
          `⚠️ Massive price failed ${symbol}:`,
          massiveError.response?.status || massiveError.message
        );

        throw primaryError;
      }
    }
  };

  Object.defineProperty(marketService, '__massiveFallbackInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(
    `🟣 Massive market fallback ${isMassiveConfigured() ? 'READY' : 'DISABLED (MASSIVE_API_KEY missing)'}`
  );
}

module.exports = marketService;
