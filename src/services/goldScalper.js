require('./installMassiveMarketFallback');

const grokGold92Strategy = require('./scalpStrategies/grokGold92Strategy');
const proStrategy = require('./scalpStrategies/proStrategy');

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
  const primaryWait = waits[0] || { ready:false,status:'NO_SCALP_STRATEGY_READY',pair:'XAUUSD' };
  return {
    ...primaryWait,
    atr5: finiteOrNull(primaryWait?.atr5) ?? firstFiniteFrom(waits,['atr5','atr']),
    rsi5: finiteOrNull(primaryWait?.rsi5) ?? firstFiniteFrom(waits,['rsi5','rsi']),
    adx5: finiteOrNull(primaryWait?.adx5) ?? firstFiniteFrom(waits,['adx5','adx']),
    vwap5: finiteOrNull(primaryWait?.vwap5) ?? firstFiniteFrom(waits,['vwap5','vwap']),
    ema20: finiteOrNull(primaryWait?.ema20) ?? firstFiniteFrom(waits,['ema20'])
  };
}

async function buildGoldScalpResult() {
  const scalp = await scanGoldScalp();
  if (!scalp.ready) return { pair:'XAUUSD',signal:null,indicators:{atr:scalp.atr5||null,rsi:scalp.rsi5||null,adx:scalp.adx5||null,vwap:scalp.vwap5||null},scalpMeta:scalp };
  return {
    pair:'XAUUSD',
    signal:{action:scalp.direction,entry:scalp.entry,stopLoss:scalp.stopLoss,targets:[scalp.tp1,scalp.tp2],confidence:Number(scalp.aiConfidence)>0?Number(scalp.aiConfidence):null,reason:`${scalp.strategyLabel} | ${scalp.entryMode} | Score ${scalp.score}/100`},
    indicators:{atr:scalp.atr5,rsi:scalp.rsi5,ema20:scalp.ema20,adx:scalp.adx5,vwap:scalp.vwap5},
    scalpMeta:scalp
  };
}

module.exports={scanGoldScalp,buildGoldScalpResult};
