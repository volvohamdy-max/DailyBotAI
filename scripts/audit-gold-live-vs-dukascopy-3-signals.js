#!/usr/bin/env node
'use strict';
const axios=require('axios');
const {getHistoricalRates}=require('dukascopy-node');

const EVENTS=[
 {strategy:'RANGE',side:'SELL',entry:Date.parse('2026-08-24T15:30:00Z')},
 {strategy:'RAPID',side:'SELL',entry:Date.parse('2026-08-26T11:10:00Z')},
 {strategy:'SWEEP5',side:'SELL',entry:Date.parse('2026-08-26T12:10:00Z')}
];
const FROM='2026-08-24',TO='2026-08-26';
function nearest(a,t){let best=null,d=Infinity;for(const x of a){const z=Math.abs(x.timestamp-t);if(z<d){d=z;best=x}}return best}
function f(n){return Number.isFinite(n)?n.toFixed(3):'n/a'}
function normD(raw){return raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
async function binance(){const start=Date.parse(FROM+'T00:00:00Z'),end=Date.parse(TO+'T23:59:59Z');let out=[],cursor=start;while(cursor<=end){const {data}=await axios.get('https://api.binance.com/api/v3/klines',{params:{symbol:'PAXGUSDT',interval:'5m',startTime:cursor,endTime:end,limit:1000},timeout:15000});if(!Array.isArray(data)||!data.length)break;for(const r of data)out.push({timestamp:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4]});const next=+data.at(-1)[0]+300000;if(next<=cursor)break;cursor=next;}return out}
(async()=>{
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
 console.log('🔬 GOLD LIVE DATA PARITY — 3 MISSED SIGNALS');
 console.log('Dukascopy XAUUSD vs Binance PAXGUSDT shape');
 console.log('⚠️ Diagnostic only — no live/VIP changes');
 const d=normD(await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:200,useCache:true,cacheFolderPath:'./data/dukascopy-cache'}));
 const b=await binance();
 console.log(`✅ Dukascopy M5=${d.length} | Binance PAXG M5=${b.length}`);
 for(const e of EVENTS){
   console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
   console.log(`${e.strategy} ${e.side} | backtest entry ${new Date(e.entry).toISOString()}`);
   // Signal candle is normally immediately before entry for Range/Rapid/Sweep.
   for(let off=-15;off<=5;off+=5){
     const t=e.entry+off*60000,db=nearest(d,t),bb=nearest(b,t);
     if(!db||!bb)continue;
     // Scale Binance locally to XAUUSD using the Dukascopy close at this historical bar.
     // This intentionally tests candle SHAPE, because live code calibrates PAXG to spot gold.
     const k=db.close/bb.close;
     const bs={open:bb.open*k,high:bb.high*k,low:bb.low*k,close:bb.close*k};
     const dRange=db.high-db.low,bRange=bs.high-bs.low;
     const closeDiff=bs.close-db.close;
     const rangeRatio=dRange>0?bRange/dRange:NaN;
     console.log(`${new Date(t).toISOString()} | D O/H/L/C ${f(db.open)}/${f(db.high)}/${f(db.low)}/${f(db.close)} | PAXG→XAU ${f(bs.open)}/${f(bs.high)}/${f(bs.low)}/${f(bs.close)} | rangeRatio=${f(rangeRatio)} closeΔ=${f(closeDiff)}`);
   }
 }
 console.log('\n📌 INTERPRETATION');
 console.log('If PAXG candle shape materially differs around the signal candle, Dukascopy can create a historical setup that the live Binance-PAXG strategy never saw.');
 console.log('If shapes are close, next suspect is scanner timing / closed-candle handling / routing, not strategy strictness.');
 console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
})().catch(e=>{console.error('❌',e?.response?.data||e);process.exit(1)});
