const axios = require('axios');
const config = require('../config');

const requests = new Map();
let lastRequestAt = 0;
let cooldownUntil = 0;
const MIN_GAP_MS = Number(process.env.TWELVE_FX_FALLBACK_GAP_MS) || 2500;
const COOLDOWN_MS = Number(process.env.TWELVE_FX_FALLBACK_429_MS) || 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function symbol(pair) {
  const p = String(pair || '').trim().toUpperCase();
  return `${p.slice(0, 3)}/${p.slice(3, 6)}`;
}

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice()
    .reverse()
    .map(r => ({
      timestamp: r.datetime || null,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number.isFinite(Number(r.volume)) && Number(r.volume) > 0 ? Number(r.volume) : null
    }))
    .filter(c =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    );
}

async function getTwelveForexCandles(pair, interval = '15min') {
  const p = String(pair || '').trim().toUpperCase();
  if (p === 'XAUUSD' || p === 'BTCUSD') {
    throw new Error(`Twelve forex fallback disabled for ${p}`);
  }
  if (!config.twelveDataKey) throw new Error('Twelve Data API key not configured');

  const key = `${p}:${interval}`;
  if (requests.has(key)) return requests.get(key);

  const promise = (async () => {
    const now = Date.now();
    if (cooldownUntil > now) {
      throw new Error(`TWELVE_FX_COOLDOWN_${Math.ceil((cooldownUntil - now) / 1000)}S`);
    }

    const gap = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    try {
      console.log(`🟠 TWELVEDATA FX FALLBACK: ${p} ${interval}`);
      const { data } = await axios.get('https://api.twelvedata.com/time_series', {
        params: {
          symbol: symbol(p),
          interval,
          outputsize: 60,
          apikey: config.twelveDataKey
        },
        timeout: Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000
      });

      if (!Array.isArray(data?.values)) {
        throw new Error(data?.message || 'No TwelveData candle values');
      }

      const candles = normalize(data.values);
      if (candles.length < 20) throw new Error(`Insufficient TwelveData candles ${p} ${interval}`);
      console.log(`✅ TWELVEDATA FX CANDLES ${p} ${interval}: ${candles.length}`);
      return candles;
    } catch (error) {
      if (Number(error?.response?.status) === 429 || /429/.test(String(error?.message || ''))) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        console.log(`🧊 TwelveData FX fallback cooldown activated (${Math.round(COOLDOWN_MS / 1000)}s)`);
      }
      throw error;
    }
  })();

  requests.set(key, promise);
  try {
    return await promise;
  } finally {
    requests.delete(key);
  }
}

module.exports = { getTwelveForexCandles };
