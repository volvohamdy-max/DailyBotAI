#!/usr/bin/env node
'use strict';
/**
 * BIG SIX WR OPTIMIZER — research only.
 * Expands parameter discovery for ALL SIX strategies, then asks the existing
 * MAX OPEN 2 portfolio engine to validate combinations. Live files untouched.
 * Goal: push WR toward 70% without killing activity (~4.5-5+ signals/day).
 */
const {spawnSync}=require('child_process');
const path=require('path');
const five=path.join(__dirname,'backtest-five-telegram-wr-optimizer.js');
const pro=path.join(__dirname,'backtest-pro-profit-round2.js');
const combo=path.join(__dirname,'backtest-six-final-month-combo.js');
const FROM=process.argv[2]||'2026-03-01',TO=process.argv[3]||'2026-08-29';
const windows=[
 ['2026-03-01','2026-04-30','TRAIN-A'],
 ['2026-05-01','2026-06-30','TRAIN-B'],
 ['2026-07-01','2026-08-29','RECENT'],
 [FROM,TO,'FULL']
];
function run(file,a,b){const r=spawnSync(process.execPath,[file,a,b],{encoding:'utf8',maxBuffer:128*1024*1024,env:process.env});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr||`exit ${r.status}`);return r.stdout}
function parseStrategy(text){const sections={};let cur=null;for(const line of text.split(/\r?\n/)){let m=line.match(/^🎯 (EXHAUST|RAPID|GROK92|RANGE|SWEEP5) — WR FIRST/);if(m){cur=m[1];sections[cur]=[]}else if(cur&&(m=line.match(/^\s*\d+ \| (\d+) trades \| Wins (\d+) \| WR ([\d.]+)% \| Net ([+-]?[\d.]+)R \| PF ([\d.]+) \| DD ([\d.]+)R \| LS (\d+) \| (\{.*\})$/))){sections[cur].push({n:+m[1],w:+m[2],wr:+m[3],net:+m[4],pf:+m[5],dd:+m[6],ls:+m[7],p:JSON.parse(m[8])})}}return sections}
function parsePro(text){const a=[];for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*\d+ \| (\d+) \| Wins (\d+) \| WR ([\d.]+)% \| Net ([+-]?[\d.]+)R \| PF ([\d.]+) \| DD ([\d.]+)R \| LS (\d+) \| SL\$(\d+) Entry (\d+)\/\d+ Exit (\d+)\/\d+ ADX(\d+)/);if(m)a.push({n:+m[1],w:+m[2],wr:+m[3],net:+m[4],pf:+m[5],dd:+m[6],ls:+m[7],p:{sl:+m[8],entry:+m[9],exit:+m[10],adx:+m[11]}})}return a}
const bank={EXHAUST:new Map(),RAPID:new Map(),GROK92:new Map(),PRO:new Map(),RANGE:new Map(),SWEEP5:new Map()};
const key=p=>JSON.stringify(p);
function add(name,x,label){if(!x||x.n<8||x.net<=0||x.pf<=1)return;const k=key(x.p),old=bank[name].get(k)||{p:x.p,seen:0,n:0,w:0,wrSum:0,minWR:100,maxLS:0,maxDD:0,labels:[]};old.seen++;old.n+=x.n;old.w+=x.w;old.wrSum+=x.wr;old.minWR=Math.min(old.minWR,x.wr);old.maxLS=Math.max(old.maxLS,x.ls);old.maxDD=Math.max(old.maxDD,x.dd);old.labels.push(label);bank[name].set(k,old)}
console.log('🚀 BIG SIX WR OPTIMIZER');
console.log(`🎯 ${FROM} → ${TO} | ALL SIX remain included | target WR≈70% + activity`);
console.log('🔒 Research only — live strategies are untouched.');
for(const [a,b,label] of windows){console.log(`\n📆 ${label} ${a} → ${b}`);const s=parseStrategy(run(five,a,b));for(const n of ['EXHAUST','RAPID','GROK92','RANGE','SWEEP5'])for(const x of (s[n]||[]).slice(0,12))add(n,x,label);const pp=parsePro(run(pro,a,b));for(const x of pp.slice(0,25))add('PRO',x,label);console.log('✅ strategy grids harvested')}
function score(x){const wr=x.n?100*x.w/x.n:0;return x.seen*100+wr*3+x.minWR*1.5-x.maxLS*3-x.maxDD*.3+Math.min(x.n,500)*.03}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('🧬 ROBUST PARAMETER BANK — TOP PER STRATEGY');
for(const n of Object.keys(bank)){const a=[...bank[n].values()].map(x=>({...x,wr:x.n?100*x.w/x.n:0})).sort((x,y)=>score(y)-score(x)||y.wr-x.wr||y.n-x.n);console.log(`\n🎯 ${n} | unique robust candidates ${a.length}`);a.slice(0,10).forEach((x,i)=>console.log(`${String(i+1).padStart(2)} | Seen ${x.seen}/${windows.length} | ${x.n} trades W${x.w} WR ${x.wr.toFixed(1)}% | WorstWR ${x.minWR.toFixed(1)} | LS≤${x.maxLS} DD≤${x.maxDD.toFixed(2)} | ${JSON.stringify(x.p)}`))}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('🧠 PORTFOLIO CHECK — EXISTING ALL-SIX MAX OPEN 2 ENGINE');
const out=run(combo,FROM,TO);const lines=out.split(/\r?\n/),ix=lines.findIndex(x=>x.includes('🏆 TOP 20'));console.log((ix>=0?lines.slice(ix):lines.slice(-35)).join('\n'));
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎯 WHAT TO SEND ME');console.log('Send from 🧬 ROBUST PARAMETER BANK through the final portfolio TOP 20.');
console.log('ℹ️ This round expands each strategy grid across several windows. The next step freezes the strongest robust parameters into an all-six combinatorial OOS validator; nothing is deployed live automatically.');
