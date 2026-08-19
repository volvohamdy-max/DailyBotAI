const marketService = require('./marketService');
const {
  getDukascopyCandles,
  isDukascopyConfigured
} = require('./dukascopyMarketData');

if (!marketService.__dukascopyFallbackInstalled) {
  const originalGetCandles = marketService.getCandles.bind(marketService);

  marketService.getCandles = async function getCandlesWithDukascopyPrimary(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();

    if (symbol !== 'BTCUSD' && isDukascopyConfigured()) {
      try {
        console.log(`🟢 DUKASCOPY PRIMARY: ${symbol} ${interval}`);
        return await getDukascopyCandles(symbol, interval);
      } catch (dukascopyError) {
        console.log(
          `⚠️ Dukascopy primary unavailable ${symbol} ${interval}:`,
          dukascopyError.message
        );
      }
    }

    return originalGetCandles(symbol, interval);
  };

  Object.defineProperty(marketService, '__dukascopyFallbackInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log(
    `🟢 Dukascopy direct datafeed ${isDukascopyConfigured() ? 'PRIMARY READY' : 'DISABLED (dukascopy-node missing)'}`
  );
}

module.exports = marketService;
