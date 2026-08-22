require('./installMassiveMarketFallback');

const grokGold92Strategy = require('./scalpStrategies/grokGold92Strategy');
const newYorkStrategy = require('./scalpStrategies/newYorkStrategy');
const proStrategy = require('./scalpStrategies/proStrategy');
const { getLatestRegimeDiagnostics } = require('./regimeDiagnosticsCache');

const STRATEGIES = [grokGold92Strategy, newYorkStrategy, proStrategy];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteFrom(waits, keys) {
  for (const wait of waits) {
    for (const key of keys) {
      const value = finiteOrNull(wait?.[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finiteOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function regimeDiagnosticFallback() {
  const latest = getLatestRegimeDiagnostics();
  if (!latest) return {};

  const meta = latest.regimeMeta || {};
  const indicators = latest.indicators || {};

  return {
    atr5: firstFinite(meta.atr5, meta.atr, indicators.atr),
    rsi5: firstFinite(meta.rsi5, indicators.rsi),
    adx5: firstFinite(meta.adx5, meta.adx15, indicators.adx),
    vwap5: firstFinite(meta.vwap5, meta.vwap, indicators.vwap),
    ema20: firstFinite(meta.ema20, indicators.ema20)
  };
}

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

  const primaryWait =
    waits[0] || {
      ready: false,
      status: 'NO_SCALP_STRATEGY_READY',
      pair: 'XAUUSD'
    };

  const regimeFallback = regimeDiagnosticFallback();

  return {
    ...primaryWait,
    atr5: firstFinite(
      primaryWait?.atr5,
      firstFiniteFrom(waits, ['atr5', 'atr']),
      regimeFallback.atr5
    ),
    rsi5: firstFinite(
      primaryWait?.rsi5,
      firstFiniteFrom(waits, ['rsi5', 'rsi']),
      regimeFallback.rsi5
    ),
    adx5: firstFinite(
      primaryWait?.adx5,
      firstFiniteFrom(waits, ['adx5', 'adx']),
      regimeFallback.adx5
    ),
    vwap5: firstFinite(
      primaryWait?.vwap5,
      firstFiniteFrom(waits, ['vwap5', 'vwap']),
      regimeFallback.vwap5
    ),
    ema20: firstFinite(
      primaryWait?.ema20,
      firstFiniteFrom(waits, ['ema20']),
      regimeFallback.ema20
    )
  };
}

async function buildGoldScalpResult() {
  const scalp = await scanGoldScalp();

  if (!scalp?.ready) {
    return {
      pair: 'XAUUSD',
      signal: null,
      indicators: {
        atr: scalp?.atr5 ?? null,
        rsi: scalp?.rsi5 ?? null,
        adx: scalp?.adx5 ?? null,
        vwap: scalp?.vwap5 ?? null,
        ema20: scalp?.ema20 ?? null
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
