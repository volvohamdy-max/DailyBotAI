const { getCandles } = require('./marketService');

// This layer is intentionally conservative.
// marketService owns provider selection/fallbacks. We must never bypass its
// circuit breakers and hit the same provider again after a 429.
const recoveryCache = new Map();
const inFlight = new Map();

function recoveryCacheMs(interval) {
  if (interval === '5min') return Number(process.env.GOLD_CANDLE_RECOVERY_5M_MS) || 4 * 60 * 1000;
  if (interval === '15min') return Number(process.env.GOLD_CANDLE_RECOVERY_15M_MS) || 10 * 60 * 1000;
  if (interval === '1h') return Number(process.env.GOLD_CANDLE_RECOVERY_1H_MS) || 30 * 60 * 1000;
  return Number(process.env.GOLD_CANDLE_RECOVERY_CACHE_MS) || 5 * 60 * 1000;
}

async function getGoldCandlesResilient(interval) {
  const key = `XAUUSD:${interval}`;

  const cached = recoveryCache.get(key);
  const ttl = recoveryCacheMs(interval);
  if (cached && Date.now() - cached.time <= ttl) {
    console.log(`GOLD CANDLE RECOVERY CACHE: ${key} | source=${cached.source}`);
    return cached.candles;
  }

  if (inFlight.has(key)) {
    console.log(`Shared gold candle request: ${key}`);
    return inFlight.get(key);
  }

  const promise = (async () => {
    try {
      const candles = await getCandles('XAUUSD', interval);
      recoveryCache.set(key, {
        candles,
        time: Date.now(),
        source: 'marketService'
      });
      return candles;
    } catch (error) {
      // Do NOT call Sifting/Massive directly here. marketService has already
      // tried the configured providers and applied rate-limit protection.
      const status = error?.response?.status;
      const rateLimited = status === 429 || /429|rate.?limit/i.test(String(error?.message || ''));
      if (rateLimited) {
        console.log(`GOLD DATA DEGRADED: ${key} rate-limited; duplicate recovery suppressed`);
      }
      throw error;
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { getGoldCandlesResilient };
