#!/usr/bin/env node
'use strict';

/**
 * Diagnostic wrapper: runs the exact 6-strategy replay and prints the actual
 * historical M5 bars at each accepted signal timestamp. Audit only.
 */
const { spawnSync } = require('child_process');
const { getHistoricalRates } = require('dukascopy-node');
const path = require('path');

function arg(name){ const p=`--${name}=`; const x=process.argv.find(v=>v.startsWith(p)); return x?x.slice(p.length):null; }
const FROM=arg('from')||'2026-08-24';
const TO=arg('to')||'2026-08-26';
const runner=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');

// Instrument the runner in memory only. No production/live file is changed.
const fs=require('fs');
let src=fs.readFileSync(runner,'utf8');
const needle="console.log('\\n📅 YEARLY PORTFOLIO');";
const inject=`console.log('\\n🔬 EXACT ACCEPTED TRADE DETAILS');\nfor(const t of accepted){\n const bi=m5.findIndex(b=>b.timestamp===t.time);\n const b=bi>=0?m5[bi]:null;\n const exit=m5.find(x=>x.timestamp===t.exitTime);\n console.log(JSON.stringify({strategy:t.strategy,side:t.side,entryTimeUTC:new Date(t.time).toISOString(),exitTimeUTC:new Date(t.exitTime).toISOString(),entry:b?b.open:null,entryBar:b?{open:b.open,high:b.high,low:b.low,close:b.close}:null,exitBar:exit?{open:exit.open,high:exit.high,low:exit.low,close:exit.close}:null,r:Number(t.r.toFixed(4))}));\n}\n`;
if(!src.includes(needle)) throw new Error('Runner layout changed; detail injection anchor not found');
src=src.replace(needle,inject+needle);
const tmp=path.join(__dirname,'.tmp-replay-live-gold-details.js');
fs.writeFileSync(tmp,src);
try{
 const r=spawnSync(process.execPath,[tmp,FROM,TO],{cwd:path.join(__dirname,'..'),stdio:'inherit',env:process.env});
 if(r.error) throw r.error;
 process.exitCode=r.status||0;
} finally { try{fs.unlinkSync(tmp)}catch{} }
