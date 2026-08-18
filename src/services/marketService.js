const axios = require('axios');
const config = require('../config');
const { getCache, setCache } = require('./candleCache');
const { isPairMarketOpen } = require('../utils/marketHours');

const SUPPORTED_PAIRS = new Set([
  'XAUUSD','BTCUSD','EURUSD','GBPUSD',
  'USDJPY','EURJPY','GBPJPY','CHFJPY'
]);

const priceCache = new Map();
const candleRequests = new Map();
const priceRequests = new Map();

const requestQueue = [];
let queueRunning = false;
let lastTwelveRequestAt = 0;
let twelveCooldownUntil = 0;

const TWELVE_MIN_REQUEST_GAP_MS =
  Number(process.env.TWELVE_MIN_REQUEST_GAP_MS) || 2000;
const TWELVE_429_COOLDOWN_MS =
  Number(process.env.TWELVE_429_COOLDOWN_MS) || 30000;
const PRICE_FRESH_MS =
  Number(process.env.MARKET_PRICE_CACHE_MS) || 30000;
const PRICE_STALE_MAX_MS =
  Number(process.env.MARKET_PRICE_STALE_MS) || 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS =
  Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

const CANDLE_STALE_MAX_MS =
  Number(process.env.MARKET_CANDLE_STALE_MS) || 10 * 60 * 1000;

const candleFallbackCache = new Map();

const providerHealth = new Map();
const providerCircuit = new Map();

const PROVIDER_FAIL_LIMIT =
  Number(process.env.MARKET_PROVIDER_FAIL_LIMIT) || 3;

const PROVIDER_COOLDOWN_MS =
  Number(process.env.MARKET_PROVIDER_COOLDOWN_MS) || 60 * 1000;

const MAX_TRADE_PRICE_AGE_MS =
  Number(process.env.MAX_TRADE_PRICE_AGE_MS) || 90 * 1000;


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pairKey(pair) {
  return String(pair || '').trim().toUpperCase();
}

function assertSupportedPair(pair) {
  const key = pairKey(pair);
  if (!SUPPORTED_PAIRS.has(key)) {
    throw new Error(`Unsupported market pair: ${key || 'EMPTY'}`);
  }
  return key;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function recordProvider(provider, ok, error = null) {
  const s = providerHealth.get(provider) || {
    ok: 0, failed: 0, lastError: null,
    lastSuccessAt: null, lastFailureAt: null
  };
  if (ok) {
    s.ok++;
    s.lastSuccessAt = Date.now();
    s.lastError = null;
  } else {
    s.failed++;
    s.lastFailureAt = Date.now();
    s.lastError = error?.response?.status || error?.message || String(error || 'unknown');
  }
  providerHealth.set(provider, s);
}


function providerAvailable(name) {
  const state = providerCircuit.get(name);

  if (!state) return true;

  const now = Date.now();

  // Circuit still OPEN.
  if (
    state.blockedUntil &&
    state.blockedUntil > now
  ) {
    return false;
  }

  // Cooldown finished -> allow ONE half-open probe.
  if (
    state.blockedUntil &&
    state.blockedUntil <= now
  ) {
    const probeAge =
      state.probeStartedAt
        ? now - state.probeStartedAt
        : Infinity;

    // Another request is already testing this provider.
    // If that probe got stuck for over 60s, allow recovery.
    if (
      state.halfOpen === true &&
      probeAge < 60 * 1000
    ) {
      return false;
    }

    state.halfOpen = true;
    state.probeStartedAt = now;
    state.blockedUntil = 0;

    providerCircuit.set(name, state);

    console.log(
      `🧪 Provider circuit HALF-OPEN: ${name} | allowing recovery probe`
    );

    return true;
  }

  return true;
}

function providerSuccess(name) {
  const state = providerCircuit.get(name);

  if (state) {
    console.log(
      `✅ Provider circuit CLOSED: ${name} | provider recovered`
    );
  }

  providerCircuit.delete(name);
}

function providerFailure(name, error) {
  const now = Date.now();

  const prev = providerCircuit.get(name) || {
    failures: 0,
    blockedUntil: 0,
    halfOpen: false,
    probeStartedAt: 0,
    lastFailureAt: 0,
    lastError: null
  };

  /*
   * Don't let ancient failures accumulate forever.
   * If the provider was healthy/unused for long enough,
   * start a fresh failure window.
   */
  if (
    prev.lastFailureAt &&
    now - prev.lastFailureAt >
      Math.max(PROVIDER_COOLDOWN_MS * 2, 2 * 60 * 1000)
  ) {
    prev.failures = 0;
  }

  prev.failures += 1;
  prev.lastFailureAt = now;

  const status = error?.response?.status;

  prev.lastError =
    status ||
    error?.message ||
    String(error || 'unknown');

  const wasHalfOpen =
    prev.halfOpen === true;

  /*
   * 429 = immediate circuit open.
   * A failed half-open recovery probe = reopen immediately.
   * Otherwise use the existing configured failure limit.
   */
  const shouldOpen =
    status === 429 ||
    wasHalfOpen ||
    prev.failures >= PROVIDER_FAIL_LIMIT;

  if (shouldOpen) {
    prev.blockedUntil =
      now + PROVIDER_COOLDOWN_MS;

    prev.halfOpen = false;
    prev.probeStartedAt = 0;

    console.log(
      `🧯 Provider circuit OPEN: ${name}` +
      ` | failures=${prev.failures}` +
      ` | reason=${prev.lastError}` +
      ` | retry=${Math.round(PROVIDER_COOLDOWN_MS / 1000)}s`
    );
  } else {
    console.log(
      `⚠️ Provider failure: ${name}` +
      ` | ${prev.failures}/${PROVIDER_FAIL_LIMIT}` +
      ` | reason=${prev.lastError}`
    );
  }

  providerCircuit.set(name, prev);
}


function formatTwelveSymbol(pair) {
  const p = pairKey(pair);
  if (p === 'XAUUSD') return 'XAU/USD';
  if (p === 'BTCUSD') return 'BTC/USD';
  return `${p.slice(0,3)}/${p.slice(3,6)}`;
}

function alphaKey() {
  return config.alphaVantageKey || process.env.ALPHA_VANTAGE_API_KEY || '';
}

function siftingKey() {
  return process.env.SIFTING_API_KEY || '';
}

function enqueueTwelve(task, label, priority = 0) {
  return new Promise((resolve, reject) => {
    requestQueue.push({
      task, label, priority, resolve, reject, createdAt: Date.now()
    });
    requestQueue.sort((a,b) =>
      b.priority !== a.priority
        ? b.priority - a.priority
        : a.createdAt - b.createdAt
    );
    processTwelveQueue().catch(err =>
      console.log('❌ TwelveData queue error:', err.message)
    );
  });
}

async function waitForTwelveSlot() {
  const now = Date.now();
  if (twelveCooldownUntil > now) {
    const wait = twelveCooldownUntil - now;
    console.log(`🧊 TwelveData cooldown: ${Math.ceil(wait/1000)}s`);
    await sleep(wait);
  }
  const elapsed = Date.now() - lastTwelveRequestAt;
  if (elapsed < TWELVE_MIN_REQUEST_GAP_MS) {
    await sleep(TWELVE_MIN_REQUEST_GAP_MS - elapsed);
  }
  lastTwelveRequestAt = Date.now();
}

async function processTwelveQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (requestQueue.length) {
      const item = requestQueue.shift();
      try {
        await waitForTwelveSlot();
        item.resolve(await item.task());
      } catch (err) {
        item.reject(err);
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function twelveRequest(url, options, label, priority = 0) {
  if (!config.twelveDataKey) {
    throw new Error('Twelve Data API key not configured');
  }
  try {
    const res = await enqueueTwelve(
      () => axios.get(url, options),
      label,
      priority
    );
    recordProvider('TwelveData', true);
    return res;
  } catch (err) {
    recordProvider('TwelveData', false, err);
    if (err.response?.status === 429) {
      twelveCooldownUntil = Math.max(
        twelveCooldownUntil,
        Date.now() + TWELVE_429_COOLDOWN_MS
      );
      console.log(`⚠️ TwelveData 429: ${label}`);
      console.log(`🧊 TwelveData cooldown activated (${Math.round(TWELVE_429_COOLDOWN_MS/1000)}s)`);
    }
    throw err;
  }
}

function cachePrice(pair, price, provider) {
  const p = positive(price);
  if (p == null) return false;
  priceCache.set(pairKey(pair), { price: p, provider, time: Date.now() });
  return true;
}

function freshPrice(pair) {
  const item = priceCache.get(pairKey(pair));
  if (!item) return null;
  return Date.now() - item.time <= PRICE_FRESH_MS ? item : null;
}

function stalePrice(pair) {
  const key = pairKey(pair);
  const item = priceCache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > PRICE_STALE_MAX_MS) {
    priceCache.delete(key);
    return null;
  }
  return item;
}


async function priceFromSifting(pair) {
  if (pair !== 'XAUUSD') {
    throw new Error('Sifting live price configured for XAUUSD only');
  }

  const key = siftingKey();

  if (!key) {
    throw new Error('SIFTING_API_KEY not configured');
  }

  const { data } = await axios.get(
    'https://api.sifting.io/v1/last/quote/commodities/XAUUSD',
    {
      headers: {
        'X-API-Key': key
      },
      timeout: 7000
    }
  );

  const bid = Number(data?.b);
  const ask = Number(data?.a);

  let price = null;

  if (
    Number.isFinite(bid) &&
    Number.isFinite(ask)
  ) {
    price = (bid + ask) / 2;
  } else if (Number.isFinite(bid)) {
    price = bid;
  } else if (Number.isFinite(ask)) {
    price = ask;
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid Sifting XAUUSD quote');
  }

  recordProvider('SiftingIO-Price', true);

  return price;
}

async function priceFromTwelve(pair) {
  const { data } = await twelveRequest(
    'https://api.twelvedata.com/price',
    {
      params: {
        symbol: formatTwelveSymbol(pair),
        apikey: config.twelveDataKey
      },
      timeout: PROVIDER_TIMEOUT_MS
    },
    `price ${pair}`,
    30
  );
  const p = positive(data?.price);
  if (p == null) throw new Error(data?.message || `No TwelveData price for ${pair}`);
  return p;
}

async function priceFromBinance(pair) {
  if (pair !== 'BTCUSD') throw new Error('Binance only configured for BTCUSD');
  const { data } = await axios.get(
    'https://api.binance.com/api/v3/ticker/price',
    { params: { symbol: 'BTCUSDT' }, timeout: PROVIDER_TIMEOUT_MS }
  );
  const p = positive(data?.price);
  if (p == null) throw new Error('Invalid Binance BTC price');
  recordProvider('Binance', true);
  return p;
}

async function priceFromCoinGecko(pair) {
  if (pair !== 'BTCUSD') throw new Error('CoinGecko only configured for BTCUSD');
  const { data } = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price',
    {
      params: { ids: 'bitcoin', vs_currencies: 'usd' },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );
  const p = positive(data?.bitcoin?.usd);
  if (p == null) throw new Error('Invalid CoinGecko BTC price');
  recordProvider('CoinGecko', true);
  return p;
}

async function priceFromAlpha(pair) {
  const key = alphaKey();
  if (!key) throw new Error('Alpha Vantage API key not configured');

  if (pair === 'XAUUSD') {
    const { data } = await axios.get(
      'https://www.alphavantage.co/query',
      {
        params: {
          function: 'GOLD_SILVER_SPOT',
          symbol: 'XAU',
          apikey: key
        },
        timeout: PROVIDER_TIMEOUT_MS
      }
    );
    const p = positive(
      data?.price ?? data?.data?.[0]?.price ?? data?.data?.[0]?.value
    );
    if (p == null) {
      throw new Error(data?.Information || data?.Note || 'Invalid Alpha Vantage XAU price');
    }
    recordProvider('AlphaVantage', true);
    return p;
  }

  const from = pair.slice(0,3);
  const to = pair.slice(3,6);
  const { data } = await axios.get(
    'https://www.alphavantage.co/query',
    {
      params: {
        function: 'CURRENCY_EXCHANGE_RATE',
        from_currency: from,
        to_currency: to,
        apikey: key
      },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );
  const p = positive(
    data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate']
  );
  if (p == null) {
    throw new Error(data?.Information || data?.Note || `Invalid Alpha Vantage price for ${pair}`);
  }
  recordProvider('AlphaVantage', true);
  return p;
}

function eodhdSymbol(pair) {
  const override = process.env[`EODHD_SYMBOL_${pair}`];
  if (override) return override;
  if (pair === 'BTCUSD') return 'BTC-USD.CC';
  if (pair === 'XAUUSD') return 'XAUUSD.FOREX';
  return `${pair}.FOREX`;
}

async function priceFromEodhd(pair) {
  if (!config.eodhdApiKey) throw new Error('EODHD API key not configured');
  const symbol = eodhdSymbol(pair);
  const { data } = await axios.get(
    `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}`,
    {
      params: { api_token: config.eodhdApiKey, fmt: 'json' },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );
  const p = positive(data?.close ?? data?.price ?? data?.last);
  if (p == null) throw new Error(data?.message || `Invalid EODHD price for ${pair} (${symbol})`);
  recordProvider('EODHD', true);
  return p;
}



async function priceFromGoldApi(pair) {
  if (pair !== 'XAUUSD') {
    throw new Error('Gold-API provider only supports XAUUSD here');
  }

  const { data } = await axios.get(
    'https://api.gold-api.com/price/XAU',
    {
      timeout: PROVIDER_TIMEOUT_MS,
      headers: {
        'User-Agent': 'ForexAIBot/1.0'
      }
    }
  );

  const price = positive(
    data?.price ??
    data?.price_gram_24k ??
    data?.ask ??
    data?.bid
  );

  if (price == null) {
    throw new Error(
      data?.message ||
      'Invalid Gold-API XAU price'
    );
  }

  recordProvider('GoldAPI', true);
  return price;
}


// =====================================================
// FRANKFURTER REFERENCE RATE
// IMPORTANT:
// Daily/reference FX only. NEVER used as trade-monitor
// execution price for TP/SL/breakeven decisions.
// =====================================================

async function referencePriceFromFrankfurter(pair) {
  if (
    pair === 'XAUUSD' ||
    pair === 'BTCUSD'
  ) {
    throw new Error(
      'Frankfurter reference disabled for this asset'
    );
  }

  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);

  const { data } = await axios.get(
    'https://api.frankfurter.dev/v2/rates',
    {
      params: {
        base,
        quotes: quote
      },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );

  const row =
    Array.isArray(data)
      ? data.find(
          item =>
            String(item?.base || '').toUpperCase() === base &&
            String(item?.quote || '').toUpperCase() === quote
        )
      : null;

  const price = positive(row?.rate);

  if (price == null) {
    throw new Error(
      `Invalid Frankfurter reference for ${pair}`
    );
  }

  recordProvider('Frankfurter', true);

  return {
    price,
    date: row?.date || null,
    provider: 'Frankfurter',
    executionSafe: false
  };
}

function pricePlan(pair) {
  if (pair === 'BTCUSD') {
    return [
      ['Binance', priceFromBinance],
      ['CoinGecko', priceFromCoinGecko],
      ['TwelveData', priceFromTwelve],
      ['AlphaVantage', priceFromAlpha],
      ['EODHD', priceFromEodhd]
    ];
  }

  if (pair === 'XAUUSD') {
    return [
      ['SiftingIO-Price', priceFromSifting],
      ['GoldAPI', priceFromGoldApi],
      ['TwelveData', priceFromTwelve],
      ['AlphaVantage', priceFromAlpha],
      ['EODHD', priceFromEodhd]
    ];
  }

  return [
    ['TwelveData', priceFromTwelve],
    ['AlphaVantage', priceFromAlpha],
    ['EODHD', priceFromEodhd]
  ];
}

function sanityPrice(pair, candidate) {
  const p = positive(candidate);
  if (p == null) return false;
  const old = stalePrice(pair);
  if (!old) return true;

  const ref = Number(old.price);
  if (!Number.isFinite(ref) || ref <= 0) return true;

  const dev = Math.abs(p - ref) / ref;
  const maxDev = pair === 'BTCUSD' ? 0.08 : pair === 'XAUUSD' ? 0.03 : 0.015;

  if (dev > maxDev) {
    console.log(
      `⚠️ Price sanity reject ${pair}: ${p} vs ${ref} (${(dev*100).toFixed(2)}%)`
    );
    return false;
  }
  return true;
}

async function getPrice(pair) {
  const key = assertSupportedPair(pair);

  if (!isPairMarketOpen(key)) {
    throw new Error(
      `MARKET_CLOSED_WEEKEND: ${key}`
    );
  }

  const fresh = freshPrice(key);
  if (fresh) {
    console.log(`💰 Price cache: ${key} | ${fresh.provider}`);
    return fresh.price;
  }

  if (priceRequests.has(key)) {
    console.log(`⏳ Shared price request: ${key}`);
    return priceRequests.get(key);
  }

  const promise = (async () => {
    let lastError = null;

    for (const [name, fn] of pricePlan(key)) {
      if (!providerAvailable(name)) {
        console.log(
          `⏭️ Provider skipped by circuit breaker: ${name}`
        );
        continue;
      }

      try {
        console.log(`🌐 Price provider ${name}: ${key}`);
        const p = await fn(key);

        if (!sanityPrice(key, p)) {
          throw new Error(`Sanity check rejected ${name} price`);
        }

        providerSuccess(name);
        cachePrice(key, p, name);

        console.log(`✅ PRICE ${key}: ${p} | source=${name}`);
        return p;

      } catch (err) {
        lastError = err;
        providerFailure(name, err);

        if (name !== 'TwelveData') {
          recordProvider(name, false, err);
        }

        console.log(
          `⚠️ ${name} price failed ${key}:`,
          err.response?.status || err.message
        );
      }
    }

    const stale = stalePrice(key);
    if (stale) {
      console.log(
        `🟡 PRICE FALLBACK CACHE ${key}: ${stale.price} | age=${Math.round((Date.now()-stale.time)/1000)}s`
      );
      return stale.price;
    }

    throw lastError || new Error(`All price providers failed for ${key}`);
  })();

  priceRequests.set(key, promise);

  try {
    return await promise;
  } finally {
    priceRequests.delete(key);
  }
}

function usableVolumeCount(candles, lookback = 24) {
  if (!Array.isArray(candles) || !candles.length) return 0;

  return candles
    .slice(-lookback)
    .reduce((count, candle) => {
      const raw =
        candle?.volume ??
        candle?.v ??
        candle?.tick_volume ??
        candle?.tickVolume ??
        candle?.vol ??
        null;

      const value = Number(raw);
      return count + (Number.isFinite(value) && value > 0 ? 1 : 0);
    }, 0);
}

function normalizeCandles(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map(r => {
    const rawVolume =
      r.volume ??
      r.v ??
      r.tick_volume ??
      r.tickVolume ??
      r.vol ??
      null;

    const parsedVolume = Number(rawVolume);

    return {
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume:
        Number.isFinite(parsedVolume) && parsedVolume > 0
          ? parsedVolume
          : null,
      timestamp: r.timestamp ?? r.datetime ?? null
    };
  }).filter(r =>
    Number.isFinite(r.open) &&
    Number.isFinite(r.high) &&
    Number.isFinite(r.low) &&
    Number.isFinite(r.close)
  );
}


function siftingInterval(interval) {
  return ({
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1h': '1h'
  })[interval] || null;
}

async function candlesFromSifting(pair, interval) {
  if (pair !== 'XAUUSD') {
    throw new Error('Sifting commodities provider is configured for XAUUSD only');
  }

  const apiKey = siftingKey();

  if (!apiKey) {
    throw new Error('SIFTING_API_KEY not configured');
  }

  const i = siftingInterval(interval);

  if (!i) {
    throw new Error(`Unsupported Sifting interval: ${interval}`);
  }

  /*
   * Request enough calendar history to survive weekends.
   *
   * Sifting returns trading bars only, so asking for the
   * previous 8/24 clock-hours early Monday can return only
   * a handful of bars since Sunday open.
   *
   * limit=100 still caps the returned dataset.
   */
  const lookbackMinutes =
    interval === '5min'
      ? 5 * 24 * 60
      : interval === '15min'
        ? 5 * 24 * 60
        : 5 * 24 * 60;

  const start =
    new Date(
      Date.now() -
      lookbackMinutes * 60 * 1000
    ).toISOString();

  const end =
    new Date().toISOString();

  let data;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.get(
        'https://api.sifting.io/v1/hist/commodities/XAUUSD/bars',
        {
          headers: {
            'X-API-Key': apiKey,
            'Accept-Encoding': 'gzip'
          },
          params: {
            start,
            end,
            interval: i,
            limit: 2000
          },
          timeout: PROVIDER_TIMEOUT_MS
        }
      );

      data = response.data;
      break;

    } catch (error) {
      const isTimeout =
        error.code === 'ECONNABORTED' ||
        String(error.message || '')
          .toLowerCase()
          .includes('timeout');

      if (!isTimeout || attempt >= 2) {
        throw error;
      }

      console.log(
        `🔁 SiftingIO retry ${pair} ${interval}`
      );

      await sleep(700);
    }
  }

  const rows =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

  const out =
    rows
      .map(r => ({
        timestamp: Number(r.t ?? r.timestamp ?? 0),
        open: Number(r.o ?? r.open),
        high: Number(r.h ?? r.high),
        low: Number(r.l ?? r.low),
        close: Number(r.c ?? r.close),
        volume:
          Number.isFinite(
            Number(r.v ?? r.volume)
          )
            ? Number(r.v ?? r.volume)
            : null
      }))
      .filter(r =>
        Number.isFinite(r.timestamp) &&
        r.timestamp > 0 &&
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close)
      )
      .sort(
        (a, b) =>
          a.timestamp - b.timestamp
      )
      .slice(-100);

  const minimumRequired =
    interval === '15min'
      ? 55
      : interval === '5min'
        ? 30
        : 20;

  if (out.length < minimumRequired) {
    throw new Error(
      `Insufficient Sifting candles for ${pair} ${interval}: ` +
      `${out.length}/${minimumRequired}`
    );
  }

  // =====================================================
  // SIFTING CANDLE FRESHNESS GUARD
  // Never allow trading engines to consume stale bars.
  // =====================================================

  const sortedOut =
    [...out].sort(
      (a, b) =>
        Number(a.timestamp) -
        Number(b.timestamp)
    );

  const lastBar =
    sortedOut[sortedOut.length - 1];

  const lastBarTime =
    Number(lastBar?.timestamp);

  const maxAgeMs =
    interval === '5min'
      ? 30 * 60 * 1000
      : interval === '15min'
        ? 60 * 60 * 1000
        : 2 * 60 * 60 * 1000;

  const ageMs =
    Number.isFinite(lastBarTime)
      ? Date.now() - lastBarTime
      : Infinity;

  if (
    !Number.isFinite(lastBarTime) ||
    ageMs > maxAgeMs
  ) {
    const ageMinutes =
      Number.isFinite(ageMs)
        ? Math.round(ageMs / 60000)
        : 'unknown';

    throw new Error(
      `STALE_CANDLES ${pair} ${interval} | ` +
      `age=${ageMinutes}m`
    );
  }

  recordProvider('SiftingIO', true);

  return sortedOut;
}

async function candlesFromTwelve(pair, interval) {
  const { data } = await twelveRequest(
    'https://api.twelvedata.com/time_series',
    {
      params: {
        symbol: formatTwelveSymbol(pair),
        interval,
        outputsize: 50,
        apikey: config.twelveDataKey
      },
      timeout: PROVIDER_TIMEOUT_MS
    },
    `candles ${pair} ${interval}`,
    interval === '5min' ? 20 : 10
  );

  if (!Array.isArray(data?.values)) {
    throw new Error(data?.message || `No TwelveData candles for ${pair} ${interval}`);
  }

  const out = normalizeCandles(
    data.values.slice().reverse().map(r => ({
      open: r.open, high: r.high, low: r.low,
      close: r.close,
      volume: r.volume ?? r.tick_volume ?? r.tickVolume ?? r.vol ?? null,
      datetime: r.datetime
    }))
  );

  if (out.length < 20) throw new Error(`Insufficient TwelveData candles for ${pair} ${interval}`);
  return out;
}

function binanceInterval(interval) {
  return ({
    '1min':'1m','5min':'5m','15min':'15m',
    '30min':'30m','1h':'1h','2h':'2h','4h':'4h'
  })[interval] || null;
}

async function candlesFromBinance(pair, interval) {
  if (pair !== 'BTCUSD') throw new Error('Binance candles only for BTCUSD');
  const i = binanceInterval(interval);
  if (!i) throw new Error(`Unsupported Binance interval: ${interval}`);

  const { data } = await axios.get(
    'https://api.binance.com/api/v3/klines',
    {
      params: { symbol: 'BTCUSDT', interval: i, limit: 50 },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );

  const out = normalizeCandles(
    data.map(r => ({
      timestamp: r[0],
      open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5]
    }))
  );

  if (out.length < 20) throw new Error('Insufficient Binance candles');
  recordProvider('Binance', true);
  return out;
}

function alphaInterval(interval) {
  return ({
    '1min':'1min','5min':'5min','15min':'15min',
    '30min':'30min','1h':'60min'
  })[interval] || null;
}

async function candlesFromAlphaForex(pair, interval) {
  if (pair === 'BTCUSD' || pair === 'XAUUSD') {
    throw new Error('Alpha intraday candle fallback disabled for this asset');
  }

  const key = alphaKey();
  if (!key) throw new Error('Alpha Vantage API key not configured');

  const i = alphaInterval(interval);
  if (!i) throw new Error(`Unsupported Alpha interval: ${interval}`);

  const { data } = await axios.get(
    'https://www.alphavantage.co/query',
    {
      params: {
        function: 'FX_INTRADAY',
        from_symbol: pair.slice(0,3),
        to_symbol: pair.slice(3,6),
        interval: i,
        outputsize: 'compact',
        apikey: key
      },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );

  const seriesKey = Object.keys(data || {}).find(k => k.startsWith('Time Series FX'));
  if (!seriesKey) {
    throw new Error(data?.Information || data?.Note || `No Alpha FX candles for ${pair}`);
  }

  const entries = Object.entries(data[seriesKey])
    .sort(([a],[b]) => new Date(a) - new Date(b))
    .slice(-50)
    .map(([datetime,r]) => ({
      datetime,
      open: r['1. open'],
      high: r['2. high'],
      low: r['3. low'],
      close: r['4. close']
    }));

  const out = normalizeCandles(entries);
  if (out.length < 20) throw new Error(`Insufficient Alpha candles for ${pair}`);
  recordProvider('AlphaVantage', true);
  return out;
}


function intervalToSeconds(interval) {
  const map = {
    '1min': 60,
    '5min': 300,
    '15min': 900,
    '30min': 1800,
    '1h': 3600
  };

  return map[interval] || null;
}

function eodhdIntradaySymbol(pair) {
  const override =
    process.env[`EODHD_INTRADAY_SYMBOL_${pair}`];

  if (override) return override;

  if (pair === 'BTCUSD') {
    return 'BTC-USD.CC';
  }

  if (pair === 'XAUUSD') {
    return process.env.EODHD_SYMBOL_XAUUSD || 'XAUUSD.FOREX';
  }

  return process.env[`EODHD_SYMBOL_${pair}`] || `${pair}.FOREX`;
}

async function candlesFromEodhd(pair, interval) {
  if (!config.eodhdApiKey) {
    throw new Error(
      'EODHD API key not configured'
    );
  }

  const seconds =
    intervalToSeconds(interval);

  if (!seconds) {
    throw new Error(
      `Unsupported EODHD interval: ${interval}`
    );
  }

  const symbol =
    eodhdIntradaySymbol(pair);

  const to =
    Math.floor(Date.now() / 1000);

  // Request enough history for at least 50 candles.
  const from =
    to - seconds * 80;

  const { data } = await axios.get(
    `https://eodhd.com/api/intraday/${encodeURIComponent(symbol)}`,
    {
      params: {
        api_token: config.eodhdApiKey,
        fmt: 'json',
        interval,
        from,
        to
      },
      timeout: PROVIDER_TIMEOUT_MS
    }
  );

  const rows =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

  const candles =
    normalizeCandles(
      rows.map(row => ({
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume:
          row.volume ??
          row.tick_volume ??
          row.tickVolume ??
          row.vol ??
          null,
        timestamp:
          row.timestamp ??
          row.datetime ??
          row.date ??
          null
      }))
    )
      .slice(-50);

  if (candles.length < 20) {
    throw new Error(
      `Insufficient EODHD candles for ${pair} ${interval} (${symbol})`
    );
  }

  recordProvider('EODHD', true);

  return candles;
}

function saveEmergencyCandles(key, candles, provider) {
  if (
    !Array.isArray(candles) ||
    candles.length < 20
  ) {
    return;
  }

  candleFallbackCache.set(key, {
    candles,
    provider,
    time: Date.now()
  });
}

function emergencyCandles(key) {
  const item =
    candleFallbackCache.get(key);

  if (!item) return null;

  const ageMs =
    Date.now() - item.time;

  let maxAgeMs = CANDLE_STALE_MAX_MS;

  // Gold Scalper must never rely on very old intraday candles.
  if (
    String(key).includes('XAUUSD') &&
    String(key).includes('5min')
  ) {
    maxAgeMs = 2 * 60 * 1000;
  }

  if (
    String(key).includes('XAUUSD') &&
    String(key).includes('15min')
  ) {
    maxAgeMs = 5 * 60 * 1000;
  }

  if (ageMs > maxAgeMs) {
    candleFallbackCache.delete(key);
    return null;
  }

  return {
    ...item,
    ageMs
  };
}

function candlePlan(pair) {
  // BTC gets Binance first: fast and independent from TwelveData.
  if (pair === 'BTCUSD') {
    return [
      ['Binance', candlesFromBinance],
      ['TwelveData', candlesFromTwelve]
    ];
  }

  // Gold intraday:
  // EODHD free plan does NOT support intraday candles.
  if (pair === 'XAUUSD') {
    return [
      ['SiftingIO', candlesFromSifting],
      ['TwelveData', candlesFromTwelve]
    ];
  }

  // Forex:
  // TwelveData first.
  // AlphaVantage remains optional if the configured account supports FX_INTRADAY.
  return [
    ['TwelveData', candlesFromTwelve],
    ['AlphaVantage', candlesFromAlphaForex]
  ];
}

async function getCandles(pair, interval = '15min') {
  const symbol =
    assertSupportedPair(pair);

  if (!isPairMarketOpen(symbol)) {
    throw new Error(
      `MARKET_CLOSED_WEEKEND: ${symbol}`
    );
  }

  const tf =
    String(interval || '15min');

  const key =
    `${symbol}:${tf}`;

  const cached =
    getCache(key);

  if (cached) {
    const cachedVolumeCount =
      symbol === 'XAUUSD' && tf === '5min'
        ? usableVolumeCount(cached, 24)
        : null;

    if (
      symbol === 'XAUUSD' &&
      tf === '5min' &&
      cachedVolumeCount < 12
    ) {
      console.log(
        `♻️ Ignoring XAUUSD 5min candle cache: usable volume ${cachedVolumeCount}/24`
      );
    } else {
      console.log(
        '📦 Using candle cache:',
        key
      );

      // Keep an independent emergency copy.
      saveEmergencyCandles(
        key,
        cached,
        'candleCache'
      );

      return cached;
    }
  }

  if (candleRequests.has(key)) {
    console.log(
      '⏳ Shared candle request:',
      key
    );

    return candleRequests.get(key);
  }

  const promise =
    (async () => {
      let lastError = null;

      for (
        const [name, fn]
        of candlePlan(symbol)
      ) {
        if (!providerAvailable(name)) {
          console.log(
            `⏭️ Candle provider skipped by circuit breaker: ${name}`
          );
          continue;
        }

        try {
          console.log(
            `🌐 Candles provider ${name}: ${symbol} ${tf}`
          );

          const candles =
            await fn(symbol, tf);

          if (
            !Array.isArray(candles) ||
            candles.length < 20
          ) {
            throw new Error(
              `Invalid candle set from ${name}`
            );
          }

          // Gold 5m VWAP needs genuine positive volume. Sifting may return
          // perfectly valid OHLC bars while volume is absent/zero for the
          // current feed. In that case do NOT fabricate volume: reject this
          // provider for the 5m scalp snapshot and continue to TwelveData.
          if (
            symbol === 'XAUUSD' &&
            tf === '5min' &&
            name === 'SiftingIO'
          ) {
            const volumeCount =
              usableVolumeCount(candles, 24);

            if (volumeCount < 12) {
              throw new Error(
                `XAUUSD 5min missing usable volume from ${name}: ${volumeCount}/24`
              );
            }
          }

          providerSuccess(name);

          setCache(
            key,
            candles
          );

          saveEmergencyCandles(
            key,
            candles,
            name
          );

          console.log(
            `✅ CANDLES ${symbol} ${tf}: ${candles.length} | source=${name}`
          );

          return candles;

        } catch (err) {
          lastError = err;

          providerFailure(
            name,
            err
          );

          if (name !== 'TwelveData') {
            recordProvider(
              name,
              false,
              err
            );
          }

          console.log(
            `⚠️ ${name} candles failed ${symbol} ${tf}:`,
            err.response?.status ||
            err.message
          );
        }
      }

      // Short-lived emergency candle fallback.
      // Never fabricate candles from spot prices.
      const emergency =
        emergencyCandles(key);

      if (emergency) {
        console.log(
          `🟡 EMERGENCY CANDLE CACHE ${key} | source=${emergency.provider} | age=${Math.round(emergency.ageMs / 1000)}s`
        );

        return emergency.candles;
      }

      throw (
        lastError ||
        new Error(
          `All candle providers failed for ${symbol} ${tf}`
        )
      );
    })();

  candleRequests.set(
    key,
    promise
  );

  try {
    return await promise;
  } finally {
    candleRequests.delete(key);
  }
}

function getMarketDataHealth() {
  const providers = {};
  for (const [name,state] of providerHealth.entries()) {
    providers[name] = {
      ...state,
      lastSuccessAgoSec: state.lastSuccessAt
        ? Math.round((Date.now()-state.lastSuccessAt)/1000) : null,
      lastFailureAgoSec: state.lastFailureAt
        ? Math.round((Date.now()-state.lastFailureAt)/1000) : null
    };
  }

  return {
    queueLength: requestQueue.length,
    queueRunning,
    cooldownActive: twelveCooldownUntil > Date.now(),
    cooldownRemainingMs: Math.max(0, twelveCooldownUntil - Date.now()),
    candleRequests: candleRequests.size,
    priceRequests: priceRequests.size,
    emergencyCandleCaches:
      candleFallbackCache.size,
    candleStaleMaxMs:
      CANDLE_STALE_MAX_MS,
    minRequestGap: TWELVE_MIN_REQUEST_GAP_MS,
    providers,
    configured: {
      siftingIO: Boolean(siftingKey()),
      twelveData: Boolean(config.twelveDataKey),
      eodhd: Boolean(config.eodhdApiKey),
      alphaVantage: Boolean(alphaKey()),
      binance: true,
      coinGecko: true,
      goldApi: true,
      frankfurterReference: true
    },

    circuits: Object.fromEntries(
      [...providerCircuit.entries()].map(
        ([name, state]) => [
          name,
          {
            failures: state.failures,
            blocked:
              Boolean(
                state.blockedUntil &&
                state.blockedUntil > Date.now()
              ),
            cooldownRemainingMs:
              Math.max(
                0,
                (state.blockedUntil || 0) -
                Date.now()
              )
          }
        ]
      )
    )
  };
}

module.exports = {
  getCandles,
  getPrice,
  getMarketDataHealth
};
