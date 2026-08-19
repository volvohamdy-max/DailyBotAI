const cache = {};

// Cache TTL حسب الفريم.
// Strategies use CLOSED candles, while live entry uses the dedicated price feed.
// Keep candles long enough to avoid re-requesting the same bar every scan.
function getTTL(key) {
  const value = String(key || '').toLowerCase();

  if (value.includes('xauusd') && value.includes('5min')) {
    return 4 * 60 * 1000; // 4 minutes: same closed 5M bar across minute scans
  }

  if (value.includes('xauusd') && value.includes('15min')) {
    return 10 * 60 * 1000; // 10 minutes
  }

  if (value.includes('xauusd') && value.includes('1h')) {
    return 30 * 60 * 1000; // 30 minutes
  }

  return 5 * 60 * 1000;
}

function getCache(pair) {
  const item = cache[pair];

  if (!item) return null;

  const ttl = getTTL(pair);
  const age = Date.now() - item.time;

  if (age > ttl) {
    delete cache[pair];
    return null;
  }

  return item.data;
}

function setCache(pair, data) {
  cache[pair] = {
    data,
    time: Date.now()
  };
}

module.exports = {
  getCache,
  setCache
};
