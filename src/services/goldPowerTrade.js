// GOLD POWER strategy has been permanently retired.
// Compatibility shim kept only because autoSignals.js still imports this module.
// It must never analyze, create, save, or publish a trade.

async function analyzeGoldPowerTrade() {
  return {
    ready: false,
    status: 'GOLD_POWER_REMOVED'
  };
}

async function scanGoldPowerTrade() {
  return {
    ready: false,
    status: 'GOLD_POWER_REMOVED',
    sent: false
  };
}

module.exports = {
  analyzeGoldPowerTrade,
  scanGoldPowerTrade
};
