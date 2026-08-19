const { scanMarkets: scanMarketsRaw } = require('./smartScanner');

const CACHE_MS = Number(process.env.SMART_SCANNER_CACHE_MS) || 4 * 60 * 1000;

let inFlight = null;
let lastResult = null;
let lastFinishedAt = 0;

async function scanMarkets() {
  const now = Date.now();

  if (Array.isArray(lastResult) && now - lastFinishedAt <= CACHE_MS) {
    console.log(
      `🧠 Smart Scanner shared cache: ${Math.round((now - lastFinishedAt) / 1000)}s old`
    );
    return lastResult;
  }

  if (inFlight) {
    console.log('⏳ Waiting existing Smart Scanner cycle');
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const result = await scanMarketsRaw();
      lastResult = Array.isArray(result) ? result : [];
      lastFinishedAt = Date.now();
      return lastResult;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = { scanMarkets };
