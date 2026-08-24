const axios = require('axios');
const { getDukascopyCandles } = require('./dukascopyMarketData');

// Keep all guards operational only. They must not change strategy rules,
// scores, entries, SL/TP, or signal thresholds.

const originalAxiosGet = axios.get.bind(axios);
let alphaCooldownUntil = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeAlphaDailyLimit(data) {
  const text = String(
    data?.Information ??
    data?.Note ??
    data?.message ??
    ''
  );
  return /25 requests per day|free API requests more sparingly|premium plans/i.test(text);
}

function h4DirectSiftingRequest(url, options = {}) {
  if (!/api\.sifting\.io\/v1\/hist\/commodities\/XAUUSD\/bars/i.test(String(url || ''))) {
    return false;
  }

  const params = options?.params || {};
  if (String(params.interval || '').toLowerCase() !== '1h') return false;

  // GOLD H4 MR asks for ~24 days directly from Sifting. Normal marketService
  // H1 requests use a much shorter lookback, so keep those untouched.
  const startMs = new Date(params.start || 0).getTime();
  const endMs = new Date(params.end || Date.now()).getTime();
  const lookbackMs = endMs - startMs;
  return Number.isFinite(lookbackMs) && lookbackMs >= 10 * 24 * 60 * 60 * 1000;
}

axios.get = async function guardedAxiosGet(url, options = {}) {
  const target = String(url || '');

  // GOLD H4 MR used to bypass the shared market routing and hit Sifting
  // directly, which produced 429s during busy scanner bursts. Serve that
  // long H1 history from the existing Dukascopy cache/datafeed instead.
  if (h4DirectSiftingRequest(target, options)) {
    const candles = await getDukascopyCandles('XAUUSD', '1h');
    console.log(`🟣 GOLD H4 MR H1 source=Dukascopy | bars=${candles.length}`);
    return {
      status: 200,
      data: candles.map(c => ({
        t: c.timestamp,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.volume ?? null
      }))
    };
  }

  if (/alphavantage\.co\/query/i.test(target) && Date.now() < alphaCooldownUntil) {
    const seconds = Math.max(1, Math.ceil((alphaCooldownUntil - Date.now()) / 1000));
    throw new Error(`ALPHA_DAILY_LIMIT_COOLDOWN_${seconds}S`);
  }

  const response = await originalAxiosGet(url, options);

  if (/alphavantage\.co\/query/i.test(target) && looksLikeAlphaDailyLimit(response?.data)) {
    // The free daily quota will not recover in seconds. Stop wasting calls for
    // the rest of the current UTC day and allow the normal downstream fallback.
    const now = new Date();
    const nextUtcDay = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 5, 0, 0
    );
    alphaCooldownUntil = nextUtcDay;
    console.log('🧊 AlphaVantage daily-limit cooldown active until next UTC day');
  }

  return response;
};

function staggerExport(modulePath, exportName, delayMs, minIntervalMs) {
  const mod = require(modulePath);
  const original = mod?.[exportName];
  if (typeof original !== 'function' || original.__providerPressureGuard) return;

  let lastStartedAt = 0;
  let inFlight = null;

  const wrapped = async function (...args) {
    const now = Date.now();

    if (inFlight) return inFlight;
    if (lastStartedAt && now - lastStartedAt < minIntervalMs) {
      return exportName === 'collectShadowOpportunities' ? 0 : undefined;
    }

    inFlight = (async () => {
      if (delayMs > 0) await sleep(delayMs);
      lastStartedAt = Date.now();
      return original.apply(this, args);
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  wrapped.__providerPressureGuard = true;
  mod[exportName] = wrapped;
}

// These jobs were all starting on the same even-minute boundary, at the same
// moment as the 1-minute gold scan. Spread them through the minute and reduce
// duplicate observational work. Shadow is virtual/audit-only; live trade
// monitoring is not changed here.
staggerExport('./shadowOpportunityCollector', 'collectShadowOpportunities', 15000, 4 * 60 * 1000);
staggerExport('./shadowTradeEngine', 'monitorShadowTrades', 5000, 4 * 60 * 1000);
staggerExport('./opportunityRadar', 'monitorOpportunityRadar', 35000, 4 * 60 * 1000);
staggerExport('./opportunityTeaser', 'runOpportunityTeaser', 50000, 4 * 60 * 1000);

console.log('🛡️ Provider pressure guards installed');
