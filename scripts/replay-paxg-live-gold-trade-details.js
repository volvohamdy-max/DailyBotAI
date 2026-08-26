#!/usr/bin/env node
'use strict';
/**
 * PAXG diagnostic wrapper.
 * Runs the exact 6-strategy portfolio against the already-downloaded Binance
 * PAXGUSDT M5 dataset and prints every accepted trade with entry/exit bars.
 * AUDIT ONLY: no live strategy or VIP routing changes.
 */
const fs=require('fs');
const path=require('path');
const Module=require('module');
function arg(name){const p=`--${name}=`;const x=process.argv.find(v=>v.startsWith(p));return x?x.slice(p.length):null;}
const FROM=arg('from')||'2026-08-24';
const TO=arg('to')||'2026-08-26';
const dataFile=path.resolve(`data/paxg-m5-${FROM}-${TO}.json`);
const runner=path.resolve('scripts/backtest-live-gold-portfolio-6-exact.js');
if(!fs.existsSync(dataFile)){console.error(`❌ Missing ${dataFile}\nRun: node scripts/download-binance-paxg-m5-history.js ${FROM} ${TO}`);process.exit(1);}
const rows=JSON.parse(fs.readFileSync(dataFile,'utf8'));
if(!Array.isArray(rows)||rows.length<300){console.error(`❌ Invalid/short PAXG dataset: ${rows?.length||0}`);process.exit(1);}
let src=fs.readFileSync(runner,'utf8');
const needle="console.log('\\n📅 YEARLY PORTFOLIO');";
const inject=`console.log('\\n🔬 EXACT PAXG ACCEPTED TRADE DETAILS');\nfor(const t of accepted){\n const bi=m5.findIndex(b=>b.timestamp===t.time);\n const b=bi>=0?m5[bi]:null;\n const exit=m5.find(x=>x.timestamp===t.exitTime);\n console.log(JSON.stringify({strategy:t.strategy,side:t.side,entryTimeUTC:new Date(t.time).toISOString(),entryTimeCairo:new Date(t.time+3*3600000).toISOString().replace('T',' ').replace('.000Z',''),exitTimeUTC:new Date(t.exitTime).toISOString(),entry:b?b.open:null,entryBar:b?{open:b.open,high:b.high,low:b.low,close:b.close}:null,exitBar:exit?{open:exit.open,high:exit.high,low:exit.low,close:exit.close}:null,r:Number(t.r.toFixed(4))}));\n}\n`;
if(!src.includes(needle))throw new Error('Runner layout changed; detail injection anchor not found');
src=src.replace(needle,inject+needle);
const tmp=path.resolve('scripts/.tmp-paxg-live-gold-details.js');
fs.writeFileSync(tmp,src);
const original=Module._load;
Module._load=function(request,parent,isMain){if(request==='dukascopy-node')return{getHistoricalRates:async()=>rows};return original.apply(this,arguments);};
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔬 BINANCE PAXG — EXACT RECENT TRADE DETAILS');
console.log(`📅 ${FROM} → ${TO} | M5=${rows.length}`);
console.log('🔒 Audit only — live/VIP untouched');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
try{
 process.argv=[process.argv[0],tmp,FROM,TO];
 require(tmp);
}catch(e){console.error(e);process.exitCode=1;}
process.on('exit',()=>{try{fs.unlinkSync(tmp)}catch{}});
