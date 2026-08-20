require('./installMassiveMarketFallback');

const newYorkStrategy = require('./scalpStrategies/newYorkStrategy');
const aggressiveBreakoutA = require('./scalpStrategies/aggressiveBreakoutA');
const proStrategy = require('./scalpStrategies/proStrategy');
const goldPrimeStrategy = require('./scalpStrategies/goldPrimeStrategy');

const STRATEGIES = [
  newYorkStrategy,
  aggressiveBreakoutA,
  proStrategy,
  goldPrimeStrategy
];

async function scanGoldScalp() {
  const waits = [];

  for (const strategy of STRATEGIES) {
    try {
      const result = await strategy.scan();

      if (result?.ready) {
        console.log(
          `⚡ GOLD MULTI-SCALP READY | ${result.strategyLabel} | ${result.direction} | score=${result.score}`
        );
        return result;
      }

      waits.push(
        result || {
          ready: false,
          status: `${strategy.CONFIG?.id || 'UNKNOWN'}_NO_RESULT`
        }
      );

      console.log(
        `🟡 GOLD SCALP WAIT | ${strategy.CONFIG?.label || strategy.CONFIG?.id} | ${result?.status || 'WAIT'}`
      );
    } catch (e) {
      console.log(
        `❌ GOLD SCALP STRATEGY ERROR | ${strategy.CONFIG?.label || strategy.CONFIG?.id}:`,
        e.message
      );

      waits.push({
        ready: false,
        status: `${strategy.CONFIG?.id || 'UNKNOWN'}_ERROR`,
        error: e.message
      });
    }
  }

  return (
    waits[0] || {
      ready: false,
      status: 'NO_SCALP_STRATEGY_READY',
      pair: 'XAUUSD'
    }
  );
}

async function buildGoldScalpResult() {
  const scalp = await scanGoldScalp();

  if (!scalp?.ready) {
    return {
      pair: 'XAUUSD',
      signal: null,
      indicators: {
        atr: scalp?.atr5 || null,
        rsi: scalp?.rsi5 || null,
        adx: scalp?.adx5 || null,
        vwap: scalp?.vwap5 || null
      },
      scalpMeta: scalp
    };
  }

  return {
    pair: 'XAUUSD',
    signal: {
      action: scalp.direction,
      entry: scalp.entry,
      stopLoss: scalp.stopLoss,
      targets: [scalp.tp1, scalp.tp2],
      confidence: null,
      reason: `${scalp.strategyLabel} | ${scalp.entryMode} | Score ${scalp.score}/100`
    },
    indicators: {
      atr: scalp.atr5,
      rsi: scalp.rsi5,
      adx: scalp.adx5,
      vwap: scalp.vwap5,
      ema20: scalp.ema20
    },
    scalpMeta: scalp
  };
}

function markGoldScalpSent(direction, entry, atr5, strategyId = 'NEW_YORK') {
  const s = STRATEGIES.find((x) => x.CONFIG?.id === strategyId);
  if (s?.markSent) s.markSent(direction, entry, atr5);
}

module.exports = {
  scanGoldScalp,
  buildGoldScalpResult,
  markGoldScalpSent,
  scalpStrategies: STRATEGIES.map((s) => ({
    id: s.CONFIG?.id,
    label: s.CONFIG?.label
  }))
};
