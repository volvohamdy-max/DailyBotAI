const cache = {};

// Closed-candle cache expires when the timeframe bucket changes.
function getTTL(key) {
  const value = String(key || '').toLowerCase();
  if (value.includes('xauusd') && value.includes('5min')) return 5 * 60 * 1000;
  if (value.includes('xauusd') && value.includes('15min')) return 15 * 60 * 1000;
  if (value.includes('xauusd') && value.includes('1h')) return 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

function getCache(pair) {
  const item = cache[pair];
  if (!item) return null;
  const timeframeMs = getTTL(pair);
  const storedBucket = Math.floor(item.time / timeframeMs);
  const currentBucket = Math.floor(Date.now() / timeframeMs);
  if (storedBucket !== currentBucket) {
    delete cache[pair];
    return null;
  }
  return item.data;
}

function setCache(pair, data) {
  cache[pair] = { data, time: Date.now() };
}
module.exports = { getCache, setCache };
