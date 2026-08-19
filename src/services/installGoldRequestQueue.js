const marketService = require('./marketService');

let chain = Promise.resolve();
let lastStartAt = 0;
const MIN_GAP_MS = Number(process.env.XAU_CANDLE_REQUEST_GAP_MS) || 1800;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (!marketService.__goldRequestQueueInstalled) {
  const previousGetCandles = marketService.getCandles.bind(marketService);

  marketService.getCandles = function queuedGoldCandles(pair, interval = '15min') {
    const symbol = String(pair || '').trim().toUpperCase();
    if (symbol !== 'XAUUSD') {
      return previousGetCandles(pair, interval);
    }

    const run = async () => {
      const wait = MIN_GAP_MS - (Date.now() - lastStartAt);
      if (wait > 0) await sleep(wait);
      lastStartAt = Date.now();
      return previousGetCandles(pair, interval);
    };

    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  };

  Object.defineProperty(marketService, '__goldRequestQueueInstalled', {
    value: true,
    enumerable: false
  });

  console.log(`🟨 XAU candle request queue READY | gap=${MIN_GAP_MS}ms`);
}

module.exports = marketService;
