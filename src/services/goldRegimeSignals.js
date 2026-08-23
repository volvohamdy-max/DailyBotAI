const { scanGoldH4MeanReversion } = require('./goldH4MeanReversion');

// Compatibility shim for the existing auto-signal scheduler.
// The retired Regime strategy is not loaded or evaluated here.
async function scanGoldRegimeSignals(bot) {
  try {
    return await scanGoldH4MeanReversion(bot);
  } catch (error) {
    console.log('❌ GOLD H4 MR independent scan failed:', error.message);
    return { ready: false, status: 'H4_MR_ERROR', error: error.message };
  }
}

module.exports = { scanGoldRegimeSignals };
