const axios = require('axios');

const BINANCE_BASE = process.env.BINANCE_MARKET_DATA_BASE || 'https://data-api.binance.vision';
const TIMEOUT = Number(process.env.MARKET_PROVIDER_TIMEOUT_MS) || 10000;

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
  if (String(tf) === '1h') return 500;
  return 120;
}

function outputLimit(tf) {
  if (String(tf) === '1h') return 420;
  return 100;
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

async function getGoldProxyPrice() {
  let lastError = null;

  for (const symbol of ['PAXGUSDT', 'XAUTUSDT']) {
    try {
      const { data } = await axios.get(`${BINANCE_BASE}/api/v3/ticker/price`, {
        params: { symbol },
        timeout: Math.min(TIMEOUT, 4000)
      });
      const price = Number(data?.price);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Invalid ${symbol} live proxy price`);
      }
      console.log(`⚡ GOLD LIVE PROXY ${symbol}=${price}`);
      return { price, symbol, time: Date.now() };
    } catch (error) {
      lastError = error;
      console.log(`⚠️ GOLD LIVE PROXY ${symbol} failed: ${error.response?.status || error.message}`);
    }
  }

  throw lastError || new Error('All Binance gold live proxy sources failed');
}

async function proxyCandles(symbol, tf) {
  const candles = await fetchProxy(symbol, tf);
  const last = candles.at(-1);
  const proxyPrice = Number(last?.close);
  if (!Number.isFinite(proxyPrice) || proxyPrice <= 0) {
    throw new Error(`Invalid ${symbol} proxy close`);
  }

  const ageMin = Math.max(0, Math.round((Date.now() - Number(last?.timestamp || 0)) / 60000));
  console.log(`🪙 GOLD PROXY OK ${symbol} ${tf} | bars=${candles.length} | age=${ageMin}m | direct Binance proxy`);
  return candles.slice(-outputLimit(tf));
}

async function getGoldProxyCandles(tf) {
  let lastError = null;

  for (const symbol of ['PAXGUSDT', 'XAUTUSDT']) {
    try {
      console.log(`🪙 GOLD PROXY TRY ${symbol}: XAUUSD ${tf}`);
      return await proxyCandles(symbol, tf);
    } catch (error) {
      lastError = error;
      console.log(`⚠️ GOLD PROXY ${symbol} failed ${tf}: ${error.response?.status || error.message}`);
    }
  }

  throw lastError || new Error(`All gold proxy sources failed ${tf}`);
}

module.exports = { getGoldProxyCandles, getGoldProxyPrice };
