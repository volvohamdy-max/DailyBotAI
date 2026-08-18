const analysisService = require('./analysisService');

const inFlight = new Map();
const cache = new Map();

const ANALYSIS_CACHE_MS =
  Number(process.env.ANALYSIS_GATE_CACHE_MS) || 20000;

async function analyzePair(pair, ...args) {
  const key = String(pair || '').toUpperCase();

  const cached = cache.get(key);

  if (
    cached &&
    Date.now() - cached.time < ANALYSIS_CACHE_MS
  ) {
    console.log(`🧠 Using analysis cache: ${key}`);
    return cached.data;
  }

  if (inFlight.has(key)) {
    console.log(`⏳ Waiting existing AI analysis: ${key}`);
    return inFlight.get(key);
  }

  const promise = (async () => {
    try {
      const result = await analysisService.analyzePair(pair, ...args);

      cache.set(key, {
        data: result,
        time: Date.now()
      });

      return result;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);

  return promise;
}

module.exports = {
  ...analysisService,
  analyzePair
};
