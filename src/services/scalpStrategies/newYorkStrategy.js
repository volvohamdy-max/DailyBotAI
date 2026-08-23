const CONFIG = {
  id: 'NEW_YORK',
  label: '🗽 New York Strategy',
  pair: 'XAUUSD',
  disabled: true
};

async function scanNewYorkStrategy() {
  return {
    ready: false,
    status: 'NEW_YORK_DISABLED',
    pair: CONFIG.pair,
    strategyId: CONFIG.id,
    strategyLabel: CONFIG.label
  };
}

function markSent() {
  // Strategy disabled; intentionally no state updates.
}

module.exports = {
  CONFIG,
  scan: scanNewYorkStrategy,
  markSent
};
