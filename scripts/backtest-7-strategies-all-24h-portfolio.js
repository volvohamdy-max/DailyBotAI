'use strict';
// READ-ONLY: builds one 7-strategy 24H portfolio from the two existing research backtests.
// No live runtime strategy file is imported or modified.
const cp=require('child_process'),path=require('path');
const env={...process.env,BACKTEST_FROM:process.env.BACKTEST_FROM||'2025-09-10T00:00:00Z',BACKTEST_TO:process.env.BACKTEST_TO||'2026-09-10T23:59:59Z'};
function run(file){return cp.execFileSync(process.execPath,[path.join(__dirname,file)],{encoding:'utf8',env,maxBuffer:30*1024*1024});}
function parse24(out,name){const re=new RegExp('\\n'+name+'\\s*\\n[\\s\\S]*?24H\\s+\\| T(\\d+) WR([\\d.]+)% PF([\\d.]+) Net([+-][\\d.]+)R DD([\\d.]+)R');const m=out.match(re);if(!m)throw Error('Could not parse 24H '+name);return{n:name,t:+m[1],wr:+m[2],pf:+m[3],net:+m[4],dd:+m[5]};}
function parseCurrent(out,name){const re=new RegExp('^'+name+'\\s+\\| T(\\d+) WR([\\d.]+) PF([\\d.]+) N([+-][\\d.]+)R DD([\\d.]+)','m');const m=out.match(re);if(!m)throw Error('Could not parse '+name);return{n:name,t:+m[1],wr:+m[2],pf:+m[3],net:+m[4],dd:+m[5]};}
const hours=run('backtest-live-hours-24h-lab.js');
const live=run('backtest-all-live-gold-strategies.js');
const rows=[parse24(hours,'EXHAUSTION'),parse24(hours,'RAPID'),parseCurrent(live,'GROK92'),parse24(hours,'PRO'),parseCurrent(live,'RANGE_MR'),parse24(hours,'SWEEP5'),parse24(hours,'MICRO')];
// Aggregate WR exactly from each strategy's displayed rounded WR is approximate by <= a few trades;
// PF cannot be exactly reconstructed from summary PFs, so report weighted summary only and label it.
let T=0,W=0,net=0;for(const r of rows){T+=r.t;W+=r.t*r.wr/100;net+=r.net;}
console.log('\n📊 ALL 7 LIVE STRATEGY RULES — 24H SESSION PORTFOLIO (READ ONLY)');
console.log(env.BACKTEST_FROM.slice(0,10)+' -> '+env.BACKTEST_TO.slice(0,10));
for(const r of rows)console.log(`${r.n.padEnd(11)} T${String(r.t).padStart(4)} WR${r.wr.toFixed(1)}% PF${r.pf.toFixed(2)} Net${r.net>=0?'+':''}${r.net.toFixed(1)}R`);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`TOTAL TRADES : ${T}`);
console.log(`WIN RATE     : ${(100*W/T).toFixed(1)}%`);
console.log(`NET R (sum)  : ${net>=0?'+':''}${net.toFixed(1)}R`);
console.log('NOTE         : Grok92 + Range MR already have no hour gate; other five use their 24H results.');
console.log('NOTE         : Portfolio WR is trade-count weighted from displayed strategy WRs. For exact chronological PF/DD, use an event-level portfolio runner.');
console.log('🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');