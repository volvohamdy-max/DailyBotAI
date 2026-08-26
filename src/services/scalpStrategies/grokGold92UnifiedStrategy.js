'use strict';

// Compatibility adapter: keeps the validated Grok92 strategy logic untouched.
// The strategy itself is migrated separately; this file documents the unified live source contract.
const { getGoldCandlesResilient } = require('../goldCandleRecovery');
const { getPrice } = require('../marketService');

async function loadUnifiedGoldInputs() {
  const [raw5, raw1h, livePrice] = await Promise.all([
    getGoldCandlesResilient('5min', 150),
    getGoldCandlesResilient('1h', 260),
    getPrice('XAUUSD')
  ]);
  return { raw5, raw1h, livePrice };
}

module.exports = { loadUnifiedGoldInputs };
