const axios = require('axios');
const { getDukascopyCandles } = require('./dukascopyMarketData');

// Keep all guards operational only. They must not change strategy rules,
// scores, entries, SL/TP, or signal thresholds.

const originalAxiosGet = axios.get.bind(axios);
let alphaCooldownUntil = 0;
let h4HistoryCache = null;
let h4HistoryCacheAt = 0;
const H4_HISTORY_TTL_MS = 45 * 60 * 1000;

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

function normalizeDukascopyRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      if (Array.isArray(row)) {
        return {
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number.isFinite(Number(row[5])) && Number(row[5]) > 0 ? Number(row[5]) : null
        };
      }
      return {
        timestamp: Number(row?.timestamp),
        open: Number(row?.open),
        high: Number(row?.high),
        low: Number(row?.low),
        close: Number(row?.close),
        volume: Number.isFinite(Number(row?.volume)) && Number(row?.volume) > 0 ? Number(row?.volume) : null
      };
    })
    .filter(r =>
      Number.isFinite(r.timestamp) && r.timestamp > 0 &&
      Number.isFinite(r.open) && Number.isFinite(r.high) &&
      Number.isFinite(r.low) && Number.isFinite(r.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function loadLongH4History() {
  if (
    Array.isArray(h4HistoryCache) &&
    h4HistoryCache.length >= 340 &&
    Date.now() - h4HistoryCacheAt <= H4_HISTORY_TTL_MS
  ) {
    return h4HistoryCache;
  }

  // The shared Dukascopy service keeps 300 H1 bars for Grok. That's enough
  // for EMA200 but can aggregate to fewer than 70 complete H4 candles around
  // weekends/session gaps. H4 MR therefore asks Dukascopy directly for a
  // longer cached H1 window without touching Sifting/TwelveData.
  try {
    const lib = require('dukascopy-node');
    const getHistoricalRates = lib.getHistoricalRates || lib.getHistoricRates;
    if (typeof getHistoricalRates !== 'function') throw new Error('getHistoricalRates missing');

    const rows = await getHistoricalRates({
      instrument: 'xauusd',
      dates: {
        from: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        to: new Date()
      },
      timeframe: 'h1',
      format: 'json',
      priceType: 'bid',
      volumes: true,
      batchSize: 1,
      pauseBetweenBatchesMs: 1600,
      useCache: true,
      cacheFolderPath: './data/dukascopy-cache',
      retryCount: 0,
      retryOnEmpty: false
    });

    const normalized = normalizeDukascopyRows(rows).slice(-480);
    if (normalized.length >= 340) {
      h4HistoryCache = normalized;
      h4HistoryCacheAt = Date.now();
      return normalized;
    }
  } catch (error) {
    console.log(`🟡 GOLD H4 extended Dukascopy history fallback: ${error.message}`);
  }

  return getDukascopyCandles('XAUUSD', '1h');
}

axios.get = async function guardedAxiosGet(url, options = {}) {
  const target = String(url || '');

  if (h4DirectSiftingRequest(target, options)) {
    const candles = await loadLongH4History();
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
