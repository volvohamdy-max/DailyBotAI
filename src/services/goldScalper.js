require('./installMassiveMarketFallback');

const grokGold92Strategy = require('./scalpStrategies/grokGold92Strategy');
const proStrategy = require('./scalpStrategies/proStrategy');
const goldRangeMrStrategy = require('./scalpStrategies/goldRangeMrStrategy');
const goldRapidScalpStrategy = require('./scalpStrategies/goldRapidScalpStrategy');
const goldSweep5Strategy = require('./scalpStrategies/goldSweep5Strategy');
const { getGoldCandlesResilient } = require('./goldCandleRecovery');

grokGold92Strategy.CONFIG.sessionsUTC = [[0, 24]];
const STRATEGIES = [goldRapidScalpStrategy, grokGold92Strategy, proStrategy, goldRangeMrStrategy, goldSweep5Strategy];

function finiteOrNull(value) { if (value === null || value === undefined || value === '') return null; const n=Number(value); return Number.isFinite(n)?n:null; }
function firstFiniteFrom(waits,keys){for(const wait of waits)for(const key of keys){const value=finiteOrNull(wait?.[key]);if(value!==null)return value;}return null;}
function ema(values,period){const nums=values.map(Number).filter(Number.isFinite);if(nums.length<period)return null;const k=2/(period+1);let value=nums[0];for(let i=1;i<nums.length;i++)value=nums[i]*k+value*(1-k);return Number.isFinite(value)?value:null;}
function atr(rows,period=14){if(!Array.isArray(rows)||rows.length<period+1)return null;const sample=rows.slice(-(period+1));let total=0;for(let i=1;i<sample.length;i++){const high=finiteOrNull(sample[i]?.high),low=finiteOrNull(sample[i]?.low),prevClose=finiteOrNull(sample[i-1]?.close);if([high,low,prevClose].some(v=>v===null))return null;total+=Math.max(high-low,Math.abs(high-prevClose),Math.abs(low-prevClose));}return total/period;}
function rollingVwap(rows,lookback=20){if(!Array.isArray(rows)||rows.length<lookback)return null;const sample=rows.slice(-lookback);let pv=0,vol=0;for(const bar of sample){const high=finiteOrNull(bar?.high),low=finiteOrNull(bar?.low),close=finiteOrNull(bar?.close),volume=finiteOrNull(bar?.volume);if([high,low,close,volume].some(v=>v===null)||!(volume>0))continue;pv+=((high+low+close)/3)*volume;vol+=volume;}return vol>0?pv/vol:null;}
async function getGoldIndicatorDiagnostics(){try{const raw=await getGoldCandlesResilient('5min');const closed=Array.isArray(raw)&&raw.length>1?raw.slice(0,-1):[];if(closed.length<20)return{atr5:null,ema20:null,vwap5:null};const closes=closed.map(x=>finiteOrNull(x?.close)).filter(v=>v!==null);return{atr5:atr(closed,14),ema20:ema(closes,20),vwap5:rollingVwap(closed,20)};}catch(error){console.log('⚠️ GOLD INDICATOR DIAGNOSTICS:',error.message);return{atr5:null,ema20:null,vwap5:null};}}

async function scanGoldScalp(){
 const results=[];
 console.log('━━━━━━━━ GOLD LIVE STRATEGY CHECK ━━━━━━━━');
 for(const strategy of STRATEGIES){
  const label=strategy.CONFIG?.label||strategy.CONFIG?.id||'UNKNOWN';
  try{
   const result=await strategy.scan();
   const normalized=result||{ready:false,status:`${strategy.CONFIG?.id||'UNKNOWN'}_NO_RESULT`,pair:'XAUUSD'};
   results.push(normalized);
   if(normalized.ready) console.log(`🟢 ${label} → READY | ${normalized.direction} | ${normalized.status||'READY'} | score=${normalized.score}`);
   else console.log(`🟡 ${label} → WAIT | ${normalized.status||'WAIT'}`);
  }catch(e){
   const wait={ready:false,status:`${strategy.CONFIG?.id||'UNKNOWN'}_ERROR`,pair:'XAUUSD',strategyId:strategy.CONFIG?.id,strategyLabel:label,error:e.message};
   results.push(wait);
   console.log(`🔴 ${label} → ERROR | ${e.message}`);
  }
 }
 const readyResults=results.filter(x=>x?.ready);
 const strategyChecks=results.map((w,i)=>({strategyId:STRATEGIES[i]?.CONFIG?.id||w?.strategyId||'UNKNOWN',strategyLabel:STRATEGIES[i]?.CONFIG?.label||w?.strategyLabel||'UNKNOWN',ready:Boolean(w?.ready),status:w?.status||'WAIT'}));
 if(readyResults.length){
  const selected=readyResults[0];
  console.log(`🏁 GOLD SCALP FINAL → ${readyResults.map(x=>`${x.strategyLabel}:${x.direction}`).join(' | ')} | ready=${readyResults.length}/${STRATEGIES.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return{...selected,strategyChecks,readyResults,readyStrategies:readyResults.map(x=>({strategyId:x.strategyId,strategyLabel:x.strategyLabel,direction:x.direction,status:x.status}))};
 }
 console.log('🏁 GOLD SCALP FINAL → WAIT | no M5 strategy ready');
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 const diagnostics=await getGoldIndicatorDiagnostics();
 const primaryWait=results[0]||{ready:false,status:'NO_SCALP_STRATEGY_READY',pair:'XAUUSD'};
 return{...primaryWait,strategyChecks,readyResults:[],atr5:finiteOrNull(primaryWait?.atr5)??firstFiniteFrom(results,['atr5','atr'])??diagnostics.atr5,rsi5:finiteOrNull(primaryWait?.rsi5)??firstFiniteFrom(results,['rsi5','rsi']),adx5:finiteOrNull(primaryWait?.adx5)??firstFiniteFrom(results,['adx5','adx']),vwap5:finiteOrNull(primaryWait?.vwap5)??firstFiniteFrom(results,['vwap5','vwap'])??diagnostics.vwap5,ema20:finiteOrNull(primaryWait?.ema20)??firstFiniteFrom(results,['ema20'])??diagnostics.ema20};
}

function buildReadyResult(scalp){
 return{pair:'XAUUSD',signal:{action:scalp.direction,entry:scalp.entry,stopLoss:scalp.stopLoss,targets:[scalp.tp1,scalp.tp2],confidence:Number(scalp.aiConfidence)>0?Number(scalp.aiConfidence):null,reason:`${scalp.strategyLabel} | ${scalp.entryMode} | Score ${scalp.score}/100`},indicators:{atr:scalp.atr5,rsi:scalp.rsi5,ema20:scalp.ema20,adx:scalp.adx5,vwap:scalp.vwap5},scalpMeta:scalp};
}

async function buildGoldScalpResult(){
 const scalp=await scanGoldScalp();
 if(!scalp.ready)return{pair:'XAUUSD',signal:null,indicators:{atr:scalp.atr5??null,rsi:scalp.rsi5??null,ema20:scalp.ema20??null,adx:scalp.adx5??null,vwap:scalp.vwap5??null},scalpMeta:scalp,readySignalResults:[]};
 const readyScalps=Array.isArray(scalp.readyResults)&&scalp.readyResults.length?scalp.readyResults:[scalp];
 const readySignalResults=readyScalps.map(item=>buildReadyResult({...item,strategyChecks:scalp.strategyChecks}));
 return{...readySignalResults[0],readySignalResults};
}
module.exports={scanGoldScalp,buildGoldScalpResult};
