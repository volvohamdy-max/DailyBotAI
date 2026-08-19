const marketService = require('./marketService');
const { getDukascopyCandles } = require('./dukascopyMarketData');

if (!marketService.__dukascopyFallbackInstalled) {
  const originalGetCandles = marketService.getCandles.bind(marketService);

  marketService.getCandles = async function getCandlesWithDukascopy(pair, interval = '15min') {
    try {
      return await originalGetCandles(pair, interval);
    } catch (primaryError) {
      const symbol = String(pair || '').trim().toUpperCase();
      if (symbol === 'BTCUSD') throw primaryError;

      try {
        console.log(`🟢 DUKASCOPY FALLBACK: ${symbol} ${interval} | primary=${primaryError.message}`);
        const candles = await getDukascopyCandles(symbol, interval);
        console.log(`✅ DUKASCOPY CANDLES ${symbol} ${interval}: ${candles.length}`);
        return candles;
      } catch (dukascopyError) {
        console.log(
          `⚠️ Dukascopy candles failed ${symbol} ${interval}:`,
          dukascopyError.response?.status || dukascopyError.message
        );
        throw primaryError;
      }
    }
  };

  Object.defineProperty(marketService, '__dukascopyFallbackInstalled', {
    value: true,
    enumerable: false,
    configurable: false
  });

  console.log('🟢 Dukascopy candle fallback READY');
}

module.exports = marketService;
