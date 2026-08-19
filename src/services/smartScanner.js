const core = require('./smartScannerCore');

const CACHE_MS = Number(process.env.SMART_SCANNER_CACHE_MS) || 30000;

let inFlight = null;
let lastResult = null;
let lastFinishedAt = 0;

async function scanMarkets() {
  const now = Date.now();

  if (
    Array.isArray(lastResult) &&
    lastResult.length &&
    now - lastFinishedAt <= CACHE_MS
  ) {
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
      const result = await core.scanMarkets();
      lastResult = result;
      lastFinishedAt = Date.now();
      return result;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = {
  scanMarkets,
  calculateTechnicalScore: core.calculateTechnicalScore,
  getTechnicalDirection: core.getTechnicalDirection
};
