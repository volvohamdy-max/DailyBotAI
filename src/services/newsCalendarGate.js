const newsProviders = require('./newsProviders');

let inFlight = null;
let shortCache = null;
let shortCacheTime = 0;

const SHORT_CACHE_MS = Number(process.env.NEWS_GATE_CACHE_MS) || 30000;

async function getMultiSourceCalendar(forceRefresh = false) {
  if (
    !forceRefresh &&
    shortCache &&
    Date.now() - shortCacheTime < SHORT_CACHE_MS
  ) {
    console.log('📰 Using shared news calendar cache');
    return shortCache;
  }

  if (inFlight) {
    console.log('⏳ Waiting existing news calendar request');
    return inFlight;
  }

  if (forceRefresh) {
    console.log('🔄 Bypassing shared news cache');
  }

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
