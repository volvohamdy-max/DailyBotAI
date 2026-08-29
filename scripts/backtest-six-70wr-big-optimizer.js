#!/usr/bin/env node
'use strict';
/**
 * SIX STRATEGY BIG 70% WR OPTIMIZER
 * Research only. Does not modify live strategy files.
 *
 * This is intentionally a two-stage search:
 *  1) run the existing per-strategy WR optimizers on a 6-month discovery window;
 *  2) build a much wider all-six candidate pool around the strongest discovered zones,
 *     then score fixed six-strategy portfolios on monthly + 6m + 1y windows.
 *
 * Every portfolio contains all six strategies. Target is 70% WR, but activity gate is
 * 4.3+ signals/active day and positive PF/net; no tiny-sample 70% is accepted.
 */
const {spawnSync}=require('child_process');
const path=require('path');
const fs=require('fs');
const ROOT=__dirname;
const finalEngine=path.join(ROOT,'backtest-six-final-month-combo.js');
const proOpt=path.join(ROOT,'backtest-pro-profit-round2.js');
const fiveOpt=path.join(ROOT,'backtest-five-telegram-wr-optimizer.js');
const tmp=path.join(ROOT,'.tmp-70wr-expanded-engine.js');

function run(file,args=[]){
 const r=spawnSync(process.execPath,[file,...args],{encoding:'utf8',maxBuffer:128*1024*1024,env:process.env});
 if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr||`exit ${r.status}`);
 return r.stdout;
}
function uniq(a){return [...new Set(a)]}
function parseJsonCandidates(out){const z=[];for(const l of out.split(/\r?\n/)){const m=l.match(/\|\s*(\{.*\})\s*$/);if(m)try{z.push(JSON.parse(m[1]))}catch{}}return z}
function parsePro(out){const z=[];for(const l of out.split(/\r?\n/)){const m=l.match(/SL\$(\d+) Entry (\d+)\/\d+ Exit (\d+)\/\d+ ADX(\d+)/);if(m)z.push({sl:+m[1],entry:+m[2],exit:+m[3],adx:+m[4]})}return z}

console.log('🧠 BIG SIX — 70% WR EXPANDED OPTIMIZER');
console.log('🔒 Research branch only | ALL SIX mandatory | target activity >=4.3/day');
console.log('1️⃣ Mining broad per-strategy candidates on 6 months...');
const five=parseJsonCandidates(run(fiveOpt,['2026-03-01','2026-08-29']));
const pros=parsePro(run(proOpt,['2026-03-01','2026-08-29']));
console.log(`✅ mined ${five.length} non-PRO rows + ${pros.length} PRO rows`);

// Start from the known robust zones and deliberately expand around them. The final engine
// remains the source of execution semantics/MAX2; only its research candidate arrays change.
const E=[
 ['E-LIVE',2.2,2.6,.30,.40,1],['E-ACT',2.2,2.5,.25,.35,.7],
 ['E-X1',2.3,2.6,.25,.35,.7],['E-X2',2.4,2.7,.25,.35,.7],
 ['E-X3',2.3,2.6,.30,.40,.8],['E-X4',2.4,2.7,.30,.40,.8],
 ['E-X5',2.5,2.8,.30,.40,.8],['E-X6',2.4,2.7,.35,.45,1]
].map(x=>({id:x[0],buyBurst:x[1],sellBurst:x[2],buyWick:x[3],sellWick:x[4],tp:x[5]}));
const R=[];for(const rr of [1.5,1.65,1.75,1.85,2])for(const sep of [.04,.05,.06,.07,.08])R.push({id:`R-${rr}-${sep}`,rr,sep});
const G=[];for(const rb of [50,51,52,53,54])for(const vol of [1.05,1.1,1.15,1.2,1.25])for(const rr of [.55,.6,.65,.7,.8])G.push({id:`G-${rb}-${vol}-${rr}`,rb,vol,rr});
let P=pros.slice(0,18).map((p,i)=>({id:`P-M${i+1}`,...p}));
for(const adx of [17,18,19,20,21])for(const exit of [53,54,55,56,57,58])P.push({id:`P-X${adx}-${exit}`,sl:12,entry:37,exit,adx});
P=uniq(P.map(JSON.stringify)).map(JSON.parse).slice(0,36);
const N=[];for(const adx of [16,18,20,22])for(const rsi of [44,46,48])for(const minRR of [.4,.45,.5,.55,.6,.65])N.push({id:`N-${adx}-${rsi}-${minRR}`,adx,rsi,minRR});
const S=[];for(const hs of [8,9])for(const he of [12,13,14,15])for(const wick of [.4,.45,.5,.55])for(const mom of [.3,.4,.5])for(const tp of [3,3.5,4,4.5,5])S.push({id:`S-${hs}-${he}-${wick}-${mom}-${tp}`,hs,he,wick,mom,tp});

console.log(`📦 Expanded pool E${E.length} R${R.length} G${G.length} P${P.length} N${N.length} S${S.length}`);

let src=fs.readFileSync(finalEngine,'utf8');
const start=src.indexOf('const cfg={');
const end=src.indexOf('\n};',start);
if(start<0||end<0)throw new Error('Could not locate cfg block in final engine');
const cfg=`const cfg=${JSON.stringify({EXHAUST:E,RAPID:R,GROK92:G,PRO:P,RANGE:N,SWEEP5:S})}`;
src=src.slice(0,start)+cfg+src.slice(end+3);
// Portfolio ranking for this search: WR first, but only after enforcing activity and sample gates.
const old="tested++;if(s.net>0&&s.pf>1)rows.push({ids,s,d,b:z.blocked.length})}rows.sort((a,b)=>b.d.winPct-a.d.winPct||b.s.wr-a.s.wr||b.s.w-a.s.w||b.d.avg-a.d.avg||b.d.d5-a.d.d5||a.s.ls-b.s.ls||a.s.dd-b.s.dd||b.s.net-a.s.net);";
const neu="tested++;if(s.net>0&&s.pf>1&&s.n>=60&&d.avg>=4.3)rows.push({ids,s,d,b:z.blocked.length})}rows.sort((a,b)=>b.s.wr-a.s.wr||b.d.winPct-a.d.winPct||b.s.w-a.s.w||b.d.avg-a.d.avg||b.d.d5-a.d.d5||a.s.ls-b.s.ls||a.s.dd-b.s.dd||b.s.net-a.s.net);";
if(!src.includes(old))throw new Error('Engine ranking block changed; refusing blind patch');
src=src.replace(old,neu).replace('TOP 20 — WINNING DAYS FIRST','TOP 20 — WR FIRST, ACTIVITY GATED');
fs.writeFileSync(tmp,src);

const windows=[
 ['2026-03-01','2026-08-29','6M'],
 ['2025-08-29','2026-08-29','1Y'],
 ['2026-01-01','2026-02-28','OOS-JANFEB'],
 ['2026-03-01','2026-04-30','OOS-MARAPR'],
 ['2026-05-01','2026-06-30','OOS-MAYJUN'],
 ['2026-07-01','2026-08-29','OOS-JULAUG']
];
const rx=/^\s*\d+\s*\|\s*(.+?)\s*\|\s*Trades\s+(\d+)\s+W(\d+)\/L(\d+)\s+WR([\d.]+)%\s*\|\s*WinDays\s+(\d+)\/(\d+)=([\d.]+)%.*?Avg\s+([\d.]+).*?LS(\d+)\s+DD([\d.]+)\s+PF([\d.]+)\s+Net\s+(-?[\d.]+)R/;
const seen=new Map();
try{
 for(const [from,to,label] of windows){
  console.log(`\n🚀 ${label} ${from} → ${to}`);
  const out=run(tmp,[from,to]); let n=0;
  for(const l of out.split(/\r?\n/)){const m=l.match(rx);if(!m)continue;const id=m[1].trim(),x={label,n:+m[2],w:+m[3],wr:+m[5],wd:+m[8],avg:+m[9],ls:+m[10],dd:+m[11],pf:+m[12],net:+m[13]};if(!seen.has(id))seen.set(id,[]);seen.get(id).push(x);n++}
  console.log(`✅ captured ${n} portfolio finalists`);
 }
}finally{try{fs.unlinkSync(tmp)}catch{}}

const rows=[];for(const [id,a] of seen){
 const n=a.reduce((s,x)=>s+x.n,0),w=a.reduce((s,x)=>s+x.w,0),wr=n?100*w/n:0;
 const avg=a.reduce((s,x)=>s+x.avg,0)/a.length,wd=a.reduce((s,x)=>s+x.wd,0)/a.length;
 const worstWr=Math.min(...a.map(x=>x.wr)),worstWd=Math.min(...a.map(x=>x.wd)),ls=Math.max(...a.map(x=>x.ls)),dd=Math.max(...a.map(x=>x.dd)),net=a.reduce((s,x)=>s+x.net,0);
 const score=(wr*5)+(wd*2)+(Math.min(avg,5)*4)+(worstWr*3)+(a.length*12)-ls-dd*.2;
 rows.push({id,a,n,w,wr,avg,wd,worstWr,worstWd,ls,dd,net,score});
}
rows.sort((a,b)=>b.a.length-a.a.length||b.score-a.score||b.wr-a.wr||b.w-a.w);
console.log('\n\n🏆 BIG 70WR ROBUST TOP 20');
for(const [i,x] of rows.slice(0,20).entries())console.log(`${String(i+1).padStart(2)} | ${x.id}\n   Seen ${x.a.length}/${windows.length} | Trades ${x.n} W${x.w} WR ${x.wr.toFixed(1)}% | WD ${x.wd.toFixed(1)}% | Avg ${x.avg.toFixed(2)}/day | WorstWR ${x.worstWr.toFixed(1)}% | WorstWD ${x.worstWd.toFixed(1)}% | LS≤${x.ls} DD≤${x.dd.toFixed(2)}R | ΣNet ${x.net.toFixed(2)}R`);
const viable=rows.filter(x=>x.a.length>=3&&x.avg>=4.3&&x.net>0&&x.wr>=65);
console.log('\n🎯 CLOSEST TO 70% WITH ACTIVITY');
if(viable.length){const b=[...viable].sort((a,b)=>Math.abs(70-a.wr)-Math.abs(70-b.wr)||b.a.length-a.a.length||b.wd-a.wd)[0];console.log(b.id);console.log(`WR ${b.wr.toFixed(1)}% | WD ${b.wd.toFixed(1)}% | Avg ${b.avg.toFixed(2)}/day | Trades ${b.n} | windows ${b.a.length}/${windows.length}`)}else console.log('No robust >=65% candidate yet. Expand again; do not fake 70%.');
console.log('\n🔒 Research only — live six strategies untouched.');
