const axios = require('axios');

const BINANCE_BASE = process.env.BINANCE_MARKET_DATA_BASE || 'https://data-api.binance.vision';
const GOLD_API_URL = 'https://api.gold-api.com/price/XAU';
const TIMEOUT = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;
const MAX_DEVIATION_PCT = Number(process.env.GOLD_PROXY_MAX_DEVIATION_PCT) || 1.0;

function mapInterval(tf) {
  return ({
    '1min': '1m',
    '5min': '5m',
    '15min': '15m',
    '30min': '30m',
    '1h': '1h'
  })[String(tf)] || null;
}

function proxyLimit(tf) {
  // H1 needs enough history for Grok EMA200/ADX and GOLD H4 aggregation.
  if (String(tf) === '1h') return 500;
  return 120;
}

function outputLimit(tf) {
  if (String(tf) === '1h') return 420;
  return 100;
}

async function getGoldApiPrice() {
  const { data } = await axios.get(GOLD_API_URL, {
    timeout: TIMEOUT,
    headers: { 'User-Agent': 'ForexAIBot/1.0' }
  });

  const price = Number(data?.price ?? data?.ask ?? data?.bid);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid GoldAPI XAU price');
  }
  return price;
}

async function fetchProxy(symbol, tf) {
  const interval = mapInterval(tf);
  if (!interval) throw new Error(`Unsupported gold proxy interval ${tf}`);

  const { data } = await axios.get(`${BINANCE_BASE}/api/v3/klines`, {
    params: { symbol, interval, limit: proxyLimit(tf) },
    timeout: TIMEOUT
  });

  if (!Array.isArray(data) || data.length < 30) {
    throw new Error(`Insufficient ${symbol} candles ${tf}: ${Array.isArray(data) ? data.length : 0}`);
  }

  return data.map(row => ({
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  })).filter(c =>
    Number.isFinite(c.timestamp) &&
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close)
  );
}

async function calibratedProxy(symbol, tf) {
  const [candles, goldPrice] = await Promise.all([
    fetchProxy(symbol, tf),
    getGoldApiPrice()
  ]);

  const last = candles.at(-1);
  const proxyPrice = Number(last?.close);
  if (!Number.isFinite(proxyPrice) || proxyPrice <= 0) {
    throw new Error(`Invalid ${symbol} proxy close`);
  }

  const deviationPct = Math.abs((proxyPrice - goldPrice) / goldPrice) * 100;
  if (deviationPct > MAX_DEVIATION_PCT) {
    throw new Error(`${symbol} deviation too high: ${deviationPct.toFixed(4)}% > ${MAX_DEVIATION_PCT}%`);
  }

  const ratio = goldPrice / proxyPrice;
  const out = candles.map(c => ({
    timestamp: c.timestamp,
    open: c.open * ratio,
    high: c.high * ratio,
    low: c.low * ratio,
    close: c.close * ratio,
    volume: c.volume
  }));

  const ageMin = Math.max(0, Math.round((Date.now() - Number(out.at(-1)?.timestamp || 0)) / 60000));

  console.log(
    `🪙 GOLD PROXY OK ${symbol} ${tf} | bars=${out.length} | age=${ageMin}m | dev=${deviationPct.toFixed(4)}% | calibration=${ratio.toFixed(6)}`
  );

  return out.slice(-outputLimit(tf));
}

async function getGoldProxyCandles(tf) {
  let lastError = null;

  for (const symbol of ['PAXGUSDT', 'XAUTUSDT']) {
    try {
      console.log(`🪙 GOLD PROXY TRY ${symbol}: XAUUSD ${tf}`);
      return await calibratedProxy(symbol, tf);
    } catch (error) {
      lastError = error;
      console.log(`⚠️ GOLD PROXY ${symbol} failed ${tf}: ${error.response?.status || error.message}`);
    }
  }

  throw lastError || new Error(`All gold proxy sources failed ${tf}`);
}

module.exports = { getGoldProxyCandles };
