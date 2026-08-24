require('./installMassiveMarketFallback');

const grokGold92Strategy = require('./scalpStrategies/grokGold92Strategy');
const proStrategy = require('./scalpStrategies/proStrategy');
const goldRangeMrStrategy = require('./scalpStrategies/goldRangeMrStrategy');
const { getGoldCandlesResilient } = require('./goldCandleRecovery');

grokGold92Strategy.CONFIG.sessionsUTC = [[0, 24]];
const STRATEGIES = [grokGold92Strategy, proStrategy, goldRangeMrStrategy];

function finiteOrNull(value) { if (value === null || value === undefined || value === '') return null; const n=Number(value); return Number.isFinite(n)?n:null; }
function firstFiniteFrom(waits,keys){for(const wait of waits)for(const key of keys){const value=finiteOrNull(wait?.[key]);if(value!==null)return value;}return null;}
function ema(values,period){const nums=values.map(Number).filter(Number.isFinite);if(nums.length<period)return null;const k=2/(period+1);let value=nums[0];for(let i=1;i<nums.length;i++)value=nums[i]*k+value*(1-k);return Number.isFinite(value)?value:null;}
function atr(rows,period=14){if(!Array.isArray(rows)||rows.length<period+1)return null;const sample=rows.slice(-(period+1));let total=0;for(let i=1;i<sample.length;i++){const high=finiteOrNull(sample[i]?.high),low=finiteOrNull(sample[i]?.low),prevClose=finiteOrNull(sample[i-1]?.close);if([high,low,prevClose].some(v=>v===null))return null;total+=Math.max(high-low,Math.abs(high-prevClose),Math.abs(low-prevClose));}return total/period;}
function rollingVwap(rows,lookback=20){if(!Array.isArray(rows)||rows.length<lookback)return null;const sample=rows.slice(-lookback);let pv=0,vol=0;for(const bar of sample){const high=finiteOrNull(bar?.high),low=finiteOrNull(bar?.low),close=finiteOrNull(bar?.close),volume=finiteOrNull(bar?.volume);if([high,low,close,volume].some(v=>v===null)||!(volume>0))continue;pv+=((high+low+close)/3)*volume;vol+=volume;}return vol>0?pv/vol:null;}
async function getGoldIndicatorDiagnostics(){try{const raw=await getGoldCandlesResilient('5min');const closed=Array.isArray(raw)&&raw.length>1?raw.slice(0,-1):[];if(closed.length<20)return{atr5:null,ema20:null,vwap5:null};const closes=closed.map(x=>finiteOrNull(x?.close)).filter(v=>v!==null);return{atr5:atr(closed,14),ema20:ema(closes,20),vwap5:rollingVwap(closed,20)};}catch(error){console.log('⚠️ GOLD INDICATOR DIAGNOSTICS:',error.message);return{atr5:null,ema20:null,vwap5:null};}}

async function scanGoldScalp(){
 const waits=[];
 console.log('━━━━━━━━ GOLD LIVE STRATEGY CHECK ━━━━━━━━');
 for(const strategy of STRATEGIES){
  const label=strategy.CONFIG?.label||strategy.CONFIG?.id||'UNKNOWN';
  try{
   const result=await strategy.scan();
   if(result?.ready){
    console.log(`🟢 ${label} → READY | ${result.direction} | ${result.status||'READY'} | score=${result.score}`);
    console.log(`🏁 GOLD SCALP FINAL → ${label} | ${result.direction}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return result;
   }
   const wait=result||{ready:false,status:`${strategy.CONFIG?.id||'UNKNOWN'}_NO_RESULT`};
   waits.push(wait);
   console.log(`🟡 ${label} → WAIT | ${wait.status||'WAIT'}`);
  }catch(e){
   const wait={ready:false,status:`${strategy.CONFIG?.id||'UNKNOWN'}_ERROR`,error:e.message};waits.push(wait);
   console.log(`🔴 ${label} → ERROR | ${e.message}`);
  }
 }
 console.log('🏁 GOLD SCALP FINAL → WAIT | no M5 strategy ready');
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 const diagnostics=await getGoldIndicatorDiagnostics();
 const primaryWait=waits[0]||{ready:false,status:'NO_SCALP_STRATEGY_READY',pair:'XAUUSD'};
 return{...primaryWait,strategyChecks:waits.map((w,i)=>({strategyId:STRATEGIES[i]?.CONFIG?.id||w?.strategyId||'UNKNOWN',strategyLabel:STRATEGIES[i]?.CONFIG?.label||w?.strategyLabel||'UNKNOWN',ready:Boolean(w?.ready),status:w?.status||'WAIT'})),atr5:finiteOrNull(primaryWait?.atr5)??firstFiniteFrom(waits,['atr5','atr'])??diagnostics.atr5,rsi5:finiteOrNull(primaryWait?.rsi5)??firstFiniteFrom(waits,['rsi5','rsi']),adx5:finiteOrNull(primaryWait?.adx5)??firstFiniteFrom(waits,['adx5','adx']),vwap5:finiteOrNull(primaryWait?.vwap5)??firstFiniteFrom(waits,['vwap5','vwap'])??diagnostics.vwap5,ema20:finiteOrNull(primaryWait?.ema20)??firstFiniteFrom(waits,['ema20'])??diagnostics.ema20};
}
async function buildGoldScalpResult(){const scalp=await scanGoldScalp();if(!scalp.ready)return{pair:'XAUUSD',signal:null,indicators:{atr:scalp.atr5??null,rsi:scalp.rsi5??null,ema20:scalp.ema20??null,adx:scalp.adx5??null,vwap:scalp.vwap5??null},scalpMeta:scalp};return{pair:'XAUUSD',signal:{action:scalp.direction,entry:scalp.entry,stopLoss:scalp.stopLoss,targets:[scalp.tp1,scalp.tp2],confidence:Number(scalp.aiConfidence)>0?Number(scalp.aiConfidence):null,reason:`${scalp.strategyLabel} | ${scalp.entryMode} | Score ${scalp.score}/100`},indicators:{atr:scalp.atr5,rsi:scalp.rsi5,ema20:scalp.ema20,adx:scalp.adx5,vwap:scalp.vwap5},scalpMeta:scalp};}
module.exports={scanGoldScalp,buildGoldScalpResult};
