const marketService = require('./marketService');
const { fetchYahooCandles, YAHOO_FOREX_PAIRS } = require('./yahooForexData');

if (!marketService.__yahooForexInstalled) {
  const previousGetCandles = marketService.getCandles.bind(marketService);

  marketService.getCandles = async function yahooFirstForexCandles(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();

    if (YAHOO_FOREX_PAIRS.has(symbol) && ['5min','15min','1h'].includes(String(interval))) {
      try {
        console.log(`🟦 YAHOO FOREX PRIMARY: ${symbol} ${interval}`);
        return await fetchYahooCandles(symbol, String(interval));
      } catch (error) {
        console.log(`⚠️ Yahoo Forex unavailable ${symbol} ${interval}: ${error.response?.status || error.message}`);
      }
    }

    return previousGetCandles(pair, interval);
  };

  Object.defineProperty(marketService, '__yahooForexInstalled', {
    value: true,
    enumerable: false
  });

  console.log('🟦 Yahoo Forex candle provider READY (no API key)');
}

module.exports = marketService;
