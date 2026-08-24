const { getCandles } = require('./marketService');
const { getHistoricalRates } = require('dukascopy-node');

// marketService remains first choice. Dukascopy is only used when the live
// provider returns too few gold bars for a validated strategy.
const recoveryCache = new Map();
const inFlight = new Map();

function recoveryCacheMs(interval) {
  if (interval === '5min') return Number(process.env.GOLD_CANDLE_RECOVERY_5M_MS) || 4 * 60 * 1000;
  if (interval === '15min') return Number(process.env.GOLD_CANDLE_RECOVERY_15M_MS) || 10 * 60 * 1000;
  if (interval === '1h') return Number(process.env.GOLD_CANDLE_RECOVERY_1H_MS) || 30 * 60 * 1000;
  return Number(process.env.GOLD_CANDLE_RECOVERY_CACHE_MS) || 5 * 60 * 1000;
}

function minBars(interval) {
  if (interval === '5min') return 120;
  if (interval === '15min') return 100;
  if (interval === '1h') return 100;
  return 100;
}

function dukaTimeframe(interval) {
  if (interval === '5min') return 'm5';
  if (interval === '15min') return 'm15';
  if (interval === '1h') return 'h1';
  return null;
}

function normalizeDuka(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(x => ({
      timestamp: Number(x.timestamp),
      datetime: x.datetime || (Number.isFinite(Number(x.timestamp)) ? new Date(Number(x.timestamp)).toISOString() : undefined),
      open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close),
      volume: Number(x.volume || 0)
    }))
    .filter(x => Number.isFinite(x.timestamp) && [x.open,x.high,x.low,x.close].every(Number.isFinite))
    .sort((a,b) => a.timestamp - b.timestamp);
}

async function getDukascopyGold(interval, wanted) {
  const timeframe = dukaTimeframe(interval);
  if (!timeframe) return [];
  const minutes = interval === '5min' ? 5 : interval === '15min' ? 15 : 60;
  // Extra calendar room covers weekends/market closures.
  const lookbackMs = Math.max(3 * 24 * 60 * 60 * 1000, wanted * minutes * 60 * 1000 * 4);
  const to = new Date();
  const from = new Date(to.getTime() - lookbackMs);
  console.log(`🟣 DUKASCOPY GOLD FALLBACK: XAUUSD ${interval} | need>=${wanted}`);
  const rows = await getHistoricalRates({
    instrument: 'xauusd',
    dates: { from, to },
    timeframe,
    format: 'json',
    volumes: true,
    useCache: true,
    cacheFolderPath: './data/dukascopy-cache'
  });
  return normalizeDuka(rows).slice(-(wanted + 20));
}

async function getGoldCandlesResilient(interval) {
  const key = `XAUUSD:${interval}`;
  const cached = recoveryCache.get(key);
  const ttl = recoveryCacheMs(interval);
  if (cached && Date.now() - cached.time <= ttl) {
    console.log(`GOLD CANDLE RECOVERY CACHE: ${key} | source=${cached.source} | bars=${cached.candles.length}`);
    return cached.candles;
  }
  if (inFlight.has(key)) {
    console.log(`Shared gold candle request: ${key}`);
    return inFlight.get(key);
  }

  const promise = (async () => {
    const required = minBars(interval);
    let live = [];
    let liveError = null;
    try {
      live = await getCandles('XAUUSD', interval);
      if (!Array.isArray(live)) live = [];
    } catch (error) {
      liveError = error;
      const status = error?.response?.status;
      const rateLimited = status === 429 || /429|rate.?limit/i.test(String(error?.message || ''));
      if (rateLimited) console.log(`GOLD DATA DEGRADED: ${key} rate-limited; trying Dukascopy history`);
    }

    if (live.length >= required) {
      recoveryCache.set(key, { candles: live, time: Date.now(), source: 'marketService' });
      return live;
    }

    try {
      const duka = await getDukascopyGold(interval, required);
      if (duka.length >= required) {
        console.log(`✅ DUKASCOPY GOLD CANDLES ${interval}: ${duka.length}`);
        recoveryCache.set(key, { candles: duka, time: Date.now(), source: 'Dukascopy' });
        return duka;
      }
      console.log(`⚠️ DUKASCOPY GOLD SHORT HISTORY ${interval}: ${duka.length}/${required}`);
    } catch (error) {
      console.log(`⚠️ DUKASCOPY GOLD FALLBACK FAILED ${interval}: ${error.message}`);
    }

    if (live.length) {
      recoveryCache.set(key, { candles: live, time: Date.now(), source: 'marketService-short' });
      return live;
    }
    if (liveError) throw liveError;
    throw new Error(`No gold candles available for ${interval}`);
  })();

  inFlight.set(key, promise);
  try { return await promise; }
  finally { inFlight.delete(key); }
}

module.exports = { getGoldCandlesResilient };
