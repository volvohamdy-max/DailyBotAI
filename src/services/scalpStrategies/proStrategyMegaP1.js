'use strict';
const {getPrice}=require('../marketService');
const {getGoldCandlesResilient}=require('./../goldCandleRecovery');
const {rsiSeries}=require('./proStrategy');
const {emaSeries}=require('./goldRangeMrStrategy');

const CONFIG={
  id:'PRO_STRATEGY',label:'⭐ Pro Strategy',pair:'XAUUSD',
  buyEntryRsi:45,sellEntryRsi:55,buyExitRsi:54,sellExitRsi:50,
  buyStopDistance:14,sellStopDistance:12,
  cooldownMinutes:180,maxLossesPerDay:2,dailyEmaPeriod:50
};
const STATE={day:null,lossesToday:0,cooldownUntil:0,dailyCache:null};
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const day=t=>new Date(t).toISOString().slice(0,10);
const closed=r=>Array.isArray(r)&&r.length>1?r.slice(0,-1):[];
function reset(t=Date.now()){const d=day(t);if(STATE.day!==d){STATE.day=d;STATE.lossesToday=0}}
function wait(status,e={}){return{ready:false,status,pair:CONFIG.pair,strategyId:CONFIG.id,strategyLabel:CONFIG.label,...e}}
function aggregate(rows){const m=new Map;for(const x of rows){const k=day(x.timestamp),z=m.get(k);if(!z)m.set(k,{timestamp:Date.parse(k+'T00:00:00Z'),open:x.open,high:x.high,low:x.low,close:x.close});else{z.high=Math.max(z.high,x.high);z.low=Math.min(z.low,x.low);z.close=x.close}}return[...m.values()].sort((a,b)=>a.timestamp-b.timestamp)}
async function dailyBias(){const now=Date.now();let rows;if(STATE.dailyCache&&now-STATE.dailyCache.time<21600000)rows=STATE.dailyCache.rows;else{const {getHistoricalRates}=require('dukascopy-node');const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(now-90*86400000),to:new Date(now)},timeframe:'h1',format:'json',priceType:'bid',volumes:true,batchSize:1,pauseBetweenBatchesMs:1600,useCache:true,cacheFolderPath:'./data/dukascopy-cache',retryCount:0,retryOnEmpty:false});rows=aggregate((raw||[]).map(x=>({timestamp:Number(x.timestamp),open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>Number.isFinite(x.timestamp)));STATE.dailyCache={rows,time:now}}const done=rows.filter(x=>day(x.timestamp)<day(now));if(done.length<50)return null;const e=emaSeries(done.map(x=>x.close),50),i=done.length-1;return done[i].close>e[i]?'BUY':'SELL'}
async function scan(){
 reset();
 if(STATE.lossesToday>=CONFIG.maxLossesPerDay)return wait('PRO_MAX_DAILY_LOSSES');
 if(Date.now()<STATE.cooldownUntil)return wait('PRO_COOLDOWN');
 const [raw,live,bias]=await Promise.all([getGoldCandlesResilient('5min',150),getPrice('XAUUSD'),dailyBias()]);
 const c=closed(raw);if(c.length<60||!bias)return wait('PRO_NO_DATA');
 const R=rsiSeries(c.map(x=>+x.close),14),i=c.length-1;
 if(!Number.isFinite(R[i-1])||!Number.isFinite(R[i]))return wait('PRO_RSI_NOT_READY');
 let side=null;
 if(R[i-1]>=CONFIG.buyEntryRsi&&R[i]<CONFIG.buyEntryRsi&&bias==='BUY')side='BUY';
 else if(R[i-1]<=CONFIG.sellEntryRsi&&R[i]>CONFIG.sellEntryRsi&&bias==='SELL')side='SELL';
 if(!side)return wait('PRO_WAIT',{rsi5:R[i],dailyBias:bias});
 const signalHour=new Date(c[i].timestamp).getUTCHours();
 if(side==='BUY'&&signalHour===8)return wait('PRO_BLOCKED_08UTC_BUY');
 const entry=finite(live);if(entry===null)return wait('PRO_PRICE_NOT_READY');
 const risk=side==='BUY'?CONFIG.buyStopDistance:CONFIG.sellStopDistance;
 const stopLoss=side==='BUY'?entry-risk:entry+risk;
 return{ready:true,status:'PRO_READY',pair:'XAUUSD',direction:side,strategyId:CONFIG.id,strategyLabel:CONFIG.label,
 entryMode:'RSI_REVERSAL_D1_EMA50_LEGACY_1106',grade:'A',score:90,aiConfidence:0,entry,stopLoss,
 tp1:side==='BUY'?entry+10000:entry-10000,tp2:side==='BUY'?entry+20000:entry-20000,risk,
 rsi5:R[i],dailyBias:bias,exitRule:side==='BUY'?'RSI >= 54':'RSI <= 50',proExitRsi:side==='BUY'?54:50,
 reasons:['RSI reversal 45/55','D1 EMA50 bias',side==='BUY'?'SL $14':'SL $12',side==='BUY'?'Exit RSI >= 54':'Exit RSI <= 50',...(side==='BUY'?['No BUY at 08 UTC']:[])]};
}
function recordResult(won,t=Date.now()){reset(t);if(!won){STATE.lossesToday++;STATE.cooldownUntil=t+CONFIG.cooldownMinutes*60000}}
function markSent(){}
module.exports={CONFIG,scan,markSent,recordResult,rsiSeries};
