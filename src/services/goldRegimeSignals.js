const { scanGoldH4MeanReversion } = require('./goldH4MeanReversion');

async function scanGoldRegimeSignals(bot) {
  // GOLD REGIME disabled by design.
  // Keep this wrapper because autoSignals still calls it, and H4 Mean-Reversion
  // is intentionally scheduled through the same scanner cycle.
  try {
    await scanGoldH4MeanReversion(bot);
  } catch (h4Error) {
    console.log('❌ GOLD H4 MR independent scan failed:', h4Error.message);
  }

  return {
    pair: 'XAUUSD',
    signal: null,
    regimeMeta: {
      ready: false,
      status: 'GOLD_REGIME_DISABLED'
    }
  };
}

module.exports = { scanGoldRegimeSignals };
