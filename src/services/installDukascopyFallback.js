const marketService = require('./marketService');
const {
  getDukascopyCandles,
  isDukascopyConfigured
} = require('./dukascopyMarketData');
const { getTwelveForexCandles } = require('./twelveForexFallback');

const FX_PAIRS = new Set([
  'EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY'
]);

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

        // For forex, do NOT cascade into Yahoo/AlphaVantage. Those paths are
        // known to be rate-limited/premium in this deployment. Use exactly one
        // controlled backup: TwelveData.
        if (FX_PAIRS.has(symbol)) {
          try {
            return await getTwelveForexCandles(symbol, interval);
          } catch (twelveError) {
            console.log(`⚠️ TwelveData FX fallback unavailable ${symbol} ${interval}: ${twelveError.response?.status || twelveError.message}`);
            throw dukascopyError;
          }
        }
      }
    }

    // XAUUSD falls through to the native chain:
    // SiftingIO -> TwelveData, then Massive (installed wrapper) if configured.
    // BTCUSD falls through to Binance.
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
  console.log('🧭 Candle routing: FX Dukascopy→TwelveData | XAUUSD Dukascopy→SiftingIO→TwelveData→Massive');
}

module.exports = marketService;
