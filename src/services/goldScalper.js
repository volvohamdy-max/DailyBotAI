require('./installMassiveMarketFallback');

const grokGold92Strategy = require('./scalpStrategies/grokGold92Strategy');
const proStrategy = require('./scalpStrategies/proStrategy');
const { getGoldCandlesResilient } = require('./goldCandleRecovery');

// Full-day experiment: keep every Grok filter/SL/TP unchanged, but remove the
// old validated-session restriction. [[0,24]] makes its existing inSession()
// gate true during every UTC hour while the market/scheduler is running.
grokGold92Strategy.CONFIG.sessionsUTC = [[0, 24]];

const STRATEGIES = [grokGold92Strategy, proStrategy];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
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

function ema(values, period) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < period) return null;
  const k = 2 / (period + 1);
  let value = nums[0];
  for (let i = 1; i < nums.length; i++) value = nums[i] * k + value * (1 - k);
  return Number.isFinite(value) ? value : null;
}

function rollingVwap(rows, lookback = 20) {
  if (!Array.isArray(rows) || rows.length < lookback) return null;
  const sample = rows.slice(-lookback);
  let pv = 0, vol = 0;
  for (const bar of sample) {
    const high = finiteOrNull(bar?.high), low = finiteOrNull(bar?.low), close = finiteOrNull(bar?.close), volume = finiteOrNull(bar?.volume);
    if ([high, low, close, volume].some(v => v === null) || !(volume > 0)) continue;
    pv += ((high + low + close) / 3) * volume;
    vol += volume;
  }
  return vol > 0 ? pv / vol : null;
}

async function getGoldIndicatorDiagnostics() {
  try {
    const raw = await getGoldCandlesResilient('5min');
    const closed = Array.isArray(raw) && raw.length > 1 ? raw.slice(0, -1) : [];
    if (closed.length < 20) return { ema20: null, vwap5: null };
    const closes = closed.map(x => finiteOrNull(x?.close)).filter(v => v !== null);
    return { ema20: ema(closes, 20), vwap5: rollingVwap(closed, 20) };
  } catch (error) {
    console.log('⚠️ GOLD INDICATOR DIAGNOSTICS:', error.message);
    return { ema20: null, vwap5: null };
  }
}

async function scanGoldScalp() {
  const waits = [];
  for (const strategy of STRATEGIES) {
    try {
      const result = await strategy.scan();
      if (result?.ready) {
        console.log(`⚡ GOLD MULTI-SCALP READY | ${result.strategyLabel} | ${result.direction} | score=${result.score}`);
        return result;
      }
      waits.push(result || { ready:false, status:`${strategy.CONFIG?.id || 'UNKNOWN'}_NO_RESULT` });
      console.log(`🟡 GOLD SCALP WAIT | ${strategy.CONFIG?.label || strategy.CONFIG?.id} | ${result?.status || 'WAIT'}`);
    } catch (e) {
      console.log(`❌ GOLD SCALP STRATEGY ERROR | ${strategy.CONFIG?.label || strategy.CONFIG?.id}:`, e.message);
      waits.push({ ready:false, status:`${strategy.CONFIG?.id || 'UNKNOWN'}_ERROR`, error:e.message });
    }
  }
  const diagnostics = await getGoldIndicatorDiagnostics();
  const primaryWait = waits[0] || { ready:false,status:'NO_SCALP_STRATEGY_READY',pair:'XAUUSD' };
  return {
    ...primaryWait,
    atr5: finiteOrNull(primaryWait?.atr5) ?? firstFiniteFrom(waits,['atr5','atr']),
    rsi5: finiteOrNull(primaryWait?.rsi5) ?? firstFiniteFrom(waits,['rsi5','rsi']),
    adx5: finiteOrNull(primaryWait?.adx5) ?? firstFiniteFrom(waits,['adx5','adx']),
    vwap5: finiteOrNull(primaryWait?.vwap5) ?? firstFiniteFrom(waits,['vwap5','vwap']) ?? diagnostics.vwap5,
    ema20: finiteOrNull(primaryWait?.ema20) ?? firstFiniteFrom(waits,['ema20']) ?? diagnostics.ema20
  };
}

async function buildGoldScalpResult() {
  const scalp = await scanGoldScalp();
  if (!scalp.ready) return { pair:'XAUUSD',signal:null,indicators:{atr:scalp.atr5 ?? null,rsi:scalp.rsi5 ?? null,ema20:scalp.ema20 ?? null,adx:scalp.adx5 ?? null,vwap:scalp.vwap5 ?? null},scalpMeta:scalp };
  return {
    pair:'XAUUSD',
    signal:{action:scalp.direction,entry:scalp.entry,stopLoss:scalp.stopLoss,targets:[scalp.tp1,scalp.tp2],confidence:Number(scalp.aiConfidence)>0?Number(scalp.aiConfidence):null,reason:`${scalp.strategyLabel} | ${scalp.entryMode} | Score ${scalp.score}/100`},
    indicators:{atr:scalp.atr5,rsi:scalp.rsi5,ema20:scalp.ema20,adx:scalp.adx5,vwap:scalp.vwap5},
    scalpMeta:scalp
  };
}

module.exports={scanGoldScalp,buildGoldScalpResult};
