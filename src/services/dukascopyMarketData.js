const axios = require('axios');

const BASE_URL = 'https://freeserv.dukascopy.com/2.0/';
const TIMEOUT_MS = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;
const API_KEY = () => process.env.DUKASCOPY_API_KEY || '';

const instrumentCache = new Map();
const candleCache = new Map();
const inFlight = new Map();
let cooldownUntil = 0;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pairName(pair) {
  const p = String(pair || '').toUpperCase();
  return `${p.slice(0, 3)}/${p.slice(3, 6)}`;
}

function canonicalName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function ttl(interval) {
  if (interval === '5min') return 4 * 60 * 1000;
  if (interval === '15min') return 10 * 60 * 1000;
  if (interval === '1h') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

function maxAge(interval) {
  if (interval === '5min') return 20 * 60 * 1000;
  if (interval === '15min') return 45 * 60 * 1000;
  if (interval === '1h') return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

async function request(path, params = {}) {
  const now = Date.now();
  if (cooldownUntil > now) {
    throw new Error(`DUKASCOPY_COOLDOWN_${Math.ceil((cooldownUntil - now) / 1000)}S`);
  }

  const gap = 1200 - (now - lastRequestAt);
  if (gap > 0) await sleep(gap);
  lastRequestAt = Date.now();

  try {
    const { data } = await axios.get(BASE_URL, {
      params: {
        path,
        ...(API_KEY() ? { key: API_KEY() } : {}),
        ...params
      },
      timeout: TIMEOUT_MS
    });
    return data;
  } catch (error) {
    if (error?.response?.status === 429) {
      cooldownUntil = Date.now() + 5 * 60 * 1000;
      console.log('🧊 Dukascopy cooldown activated (300s)');
    }
    throw error;
  }
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.values)) return data.values;
  if (Array.isArray(data?.instruments)) return data.instruments;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;

  if (data && typeof data === 'object') {
    const numericValues = Object.entries(data)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => value);
    if (numericValues.length) return numericValues;
  }

  return [];
}

function instrumentFields(row) {
  if (Array.isArray(row)) {
    return {
      id: row[0],
      names: [row[1], row[3]].filter(Boolean)
    };
  }

  return {
    id: row?.id ?? row?.instrumentId ?? row?.instrument,
    names: [
      row?.name,
      row?.symbol,
      row?.ticker,
      row?.nameLong,
      row?.instrumentName
    ].filter(Boolean)
  };
}

async function instrumentId(pair) {
  const key = String(pair || '').toUpperCase();
  const cached = instrumentCache.get(key);
  if (cached && Date.now() - cached.time < 24 * 60 * 60 * 1000) return cached.id;

  const data = await request('api/instrumentList', {
    fields: 'id,name,pipValue,nameLong'
  });

  const rows = extractArray(data);
  if (!rows.length) {
    const detail = data?.message || data?.error || data?.status || 'empty instrument list';
    throw new Error(`Dukascopy instrument list unavailable: ${detail}`);
  }

  const wanted = canonicalName(key);
  const row = rows.find(item => {
    const fields = instrumentFields(item);
    return fields.names.some(name => canonicalName(name) === wanted);
  });

  const fields = row ? instrumentFields(row) : null;
  const id = Number(fields?.id);

  if (!Number.isFinite(id)) {
    const examples = rows
      .slice(0, 5)
      .map(item => instrumentFields(item).names[0])
      .filter(Boolean)
      .join(', ');

    throw new Error(
      `Dukascopy instrument not found: ${pairName(key)}` +
      (examples ? ` | examples=${examples}` : '')
    );
  }

  instrumentCache.set(key, { id, time: Date.now() });
  console.log(`🟢 Dukascopy instrument resolved: ${key} -> ${id}`);
  return id;
}

function toTimestamp(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return NaN;
}

function normalizeMinuteRows(data) {
  return extractArray(data)
    .map(row => {
      if (Array.isArray(row)) {
        return {
          timestamp: toTimestamp(row[0]),
          open: Number(row[1]), high: Number(row[2]),
          low: Number(row[3]), close: Number(row[4]),
          volume: Number.isFinite(Number(row[5])) ? Number(row[5]) : null
        };
      }
      return {
        timestamp: toTimestamp(row?.timestamp ?? row?.time ?? row?.date ?? row?.datetime ?? row?.t),
        open: Number(row?.open ?? row?.o),
        high: Number(row?.high ?? row?.h),
        low: Number(row?.low ?? row?.l),
        close: Number(row?.close ?? row?.c),
        volume: Number.isFinite(Number(row?.volume ?? row?.v)) ? Number(row?.volume ?? row?.v) : null
      };
    })
    .filter(c =>
      Number.isFinite(c.timestamp) && c.timestamp > 0 &&
      Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function aggregate(rows, minutes) {
  const bucketMs = minutes * 60 * 1000;
  const buckets = new Map();

  for (const c of rows) {
    const ts = Math.floor(c.timestamp / bucketMs) * bucketMs;
    let b = buckets.get(ts);
    if (!b) {
      b = { timestamp: ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0, hasVolume: false };
      buckets.set(ts, b);
    }
    b.high = Math.max(b.high, c.high);
    b.low = Math.min(b.low, c.low);
    b.close = c.close;
    if (Number.isFinite(Number(c.volume)) && Number(c.volume) > 0) {
      b.volume += Number(c.volume);
      b.hasVolume = true;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(b => ({ ...b, volume: b.hasVolume ? b.volume : null }))
    .slice(-100);
}

async function getDukascopyCandles(pair, interval) {
  const symbol = String(pair || '').toUpperCase();
  if (symbol === 'BTCUSD') throw new Error('Dukascopy fallback disabled for BTCUSD');
  if (!['5min', '15min', '1h'].includes(interval)) {
    throw new Error(`Unsupported Dukascopy interval: ${interval}`);
  }

  const cacheKey = `${symbol}:${interval}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.time <= ttl(interval)) {
    console.log(`🟢 Dukascopy candle cache: ${cacheKey}`);
    return cached.candles;
  }
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const promise = (async () => {
    const id = await instrumentId(symbol);
    const directHour = interval === '1h';
    const count = directHour ? 140 : interval === '15min' ? 1800 : 650;
    const data = await request('api/historicalPrices', {
      instrument: id,
      timeFrame: directHour ? '1hour' : '1min',
      count,
      offerSide: 'B',
      dayStartTime: 'UTC'
    });

    let rows = normalizeMinuteRows(data);
    if (!directHour) rows = aggregate(rows, interval === '15min' ? 15 : 5);
    rows = rows.slice(-100);

    const minimum = interval === '15min' ? 55 : interval === '5min' ? 30 : 20;
    if (rows.length < minimum) {
      throw new Error(`Insufficient Dukascopy candles ${symbol} ${interval}: ${rows.length}/${minimum}`);
    }

    const lastTs = Number(rows.at(-1)?.timestamp);
    if (!Number.isFinite(lastTs) || Date.now() - lastTs > maxAge(interval)) {
      throw new Error(`STALE_DUKASCOPY_CANDLES ${symbol} ${interval}`);
    }

    candleCache.set(cacheKey, { candles: rows, time: Date.now() });
    return rows;
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

module.exports = { getDukascopyCandles };
