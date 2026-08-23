const newsProviders = require('./newsProviders');

let inFlight = null;
let shortCache = null;
let shortCacheTime = 0;

// The release watcher runs every minute. Keep the shared gate cache short so
// callers get fresh calendar/release data without hammering every provider.
const SHORT_CACHE_MS = Number(process.env.NEWS_GATE_CACHE_MS) || 20000;
const FORCE_MIN_INTERVAL_MS = Number(process.env.NEWS_FORCE_MIN_INTERVAL_MS) || 45000;

async function getMultiSourceCalendar(forceRefresh = false) {
  const now = Date.now();

  // Always share an already-running refresh, including force refreshes. This
  // prevents Daily Brief + Release Watch from hitting all providers twice.
  if (inFlight) {
    console.log('⏳ Waiting existing news calendar request');
    return inFlight;
  }

  if (!forceRefresh && shortCache && now - shortCacheTime < SHORT_CACHE_MS) {
    console.log('📰 Using shared news calendar cache');
    return shortCache;
  }

  // A one-minute release watcher does not need to force all remote providers
  // more than once inside the same minute. 45s keeps Actual releases fresh
  // while protecting providers from duplicate/rate-limited calls.
  if (forceRefresh && shortCache && now - shortCacheTime < FORCE_MIN_INTERVAL_MS) {
    console.log('⚡ Using fresh forced news snapshot');
    return shortCache;
  }

  if (forceRefresh) console.log('🔄 Force refreshing economic calendar...');

  inFlight = (async () => {
    try {
      const result = await newsProviders.getMultiSourceCalendar(forceRefresh);
      shortCache = result;
      shortCacheTime = Date.now();
      return result;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = {
  ...newsProviders,
  getMultiSourceCalendar
};
