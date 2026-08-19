// POWER TRADE shadow classification has been permanently retired.
// Compatibility shim kept only because autoSignals.js still imports this module.
// It must never classify or persist a Power Trade.

function evaluatePowerTrade() {
  return {
    qualified: false,
    powerScore: 0,
    grade: 'REMOVED',
    reason: 'POWER_STRATEGY_REMOVED'
  };
}

module.exports = {
  evaluatePowerTrade
};
