const axios = require('axios');
const { getDukascopyCandles } = require('./dukascopyMarketData');
const { getGoldProxyCandles } = require('./goldProxyFallback');

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

  const startMs = new Date(params.start || 0).getTime();
  const endMs = new Date(params.end || Date.now()).getTime();
  const lookbackMs = endMs - startMs;
  return Number.isFinite(lookbackMs) && lookbackMs >= 10 * 24 * 60 * 60 * 1000;
}

async function getFastGoldH1History() {
  try {
    const proxy = await getGoldProxyCandles('1h');
    if (Array.isArray(proxy) && proxy.length >= 300) {
      console.log(`🟣 GOLD H4 MR H1 source=PAXG/XAUT Proxy | bars=${proxy.length}`);
      return proxy;
    }
  } catch (error) {
    console.log(`⚠️ GOLD H4 proxy history failed: ${error.message}`);
  }

  // Dukascopy is a last fallback only. Bound the wait so it can never stall the
  // minute scanner for several minutes when its cache/datafeed is stale.
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DUKASCOPY_H1_TIMEOUT')), 12000)
    );
    const candles = await Promise.race([
      getDukascopyCandles('XAUUSD', '1h'),
      timeout
    ]);
    console.log(`🟣 GOLD H4 MR H1 source=Dukascopy | bars=${candles.length}`);
    return candles;
  } catch (error) {
    throw new Error(`GOLD_H4_H1_UNAVAILABLE: ${error.message}`);
  }
}

axios.get = async function guardedAxiosGet(url, options = {}) {
  const target = String(url || '');

  if (h4DirectSiftingRequest(target, options)) {
    const candles = await getFastGoldH1History();
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

staggerExport('./shadowOpportunityCollector', 'collectShadowOpportunities', 15000, 4 * 60 * 1000);
staggerExport('./shadowTradeEngine', 'monitorShadowTrades', 5000, 4 * 60 * 1000);
staggerExport('./opportunityRadar', 'monitorOpportunityRadar', 35000, 4 * 60 * 1000);
staggerExport('./opportunityTeaser', 'runOpportunityTeaser', 50000, 4 * 60 * 1000);

console.log('🛡️ Provider pressure guards installed');
