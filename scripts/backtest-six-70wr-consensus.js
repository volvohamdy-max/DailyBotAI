#!/usr/bin/env node
'use strict';
/**
 * SIX-STRATEGY 70% WR CONSENSUS OPTIMIZER
 * Research only. Live strategy files are never changed.
 *
 * Instead of trusting the winner of one period, this runner repeatedly executes
 * the existing all-six MAX OPEN 2 optimizer on many independent windows, parses
 * every TOP-20 portfolio, then ranks configurations by cross-window robustness.
 * Every portfolio MUST contain all six strategies.
 *
 * Primary target: approach 70% WR while keeping roughly 4.5-5.0+ signals per
 * active day and positive PF/net. Winning-days consistency is also rewarded.
 */
const {spawnSync}=require('child_process');
const path=require('path');
const engine=path.join(__dirname,'backtest-six-final-month-combo.js');

const windows=[
 ['2025-09-01','2025-09-30','2025-09'],['2025-10-01','2025-10-31','2025-10'],
 ['2025-11-01','2025-11-30','2025-11'],['2025-12-01','2025-12-31','2025-12'],
 ['2026-01-01','2026-01-31','2026-01'],['2026-02-01','2026-02-28','2026-02'],
 ['2026-03-01','2026-03-31','2026-03'],['2026-04-01','2026-04-30','2026-04'],
 ['2026-05-01','2026-05-31','2026-05'],['2026-06-01','2026-06-30','2026-06'],
 ['2026-07-01','2026-07-31','2026-07'],['2026-08-01','2026-08-29','2026-08'],
 ['2025-09-01','2026-02-28','H1'],['2026-03-01','2026-08-29','H2'],
 ['2025-08-29','2026-08-29','YEAR']
];

const rows=new Map();
const rx=/^\s*\d+\s*\|\s*(.+?)\s*\|\s*Trades\s+(\d+)\s+W(\d+)\/L(\d+)\s+WR([\d.]+)%\s*\|\s*WinDays\s+(\d+)\/(\d+)=([\d.]+)%\s+LoseDays\s+(\d+)\s+Eq(\d+)\s*\|\s*Avg\s+([\d.]+)\s+D5\+\s+(\d+)\s*\|\s*LS(\d+)\s+DD([\d.]+)\s+PF([\d.]+)\s+Net\s+(-?[\d.]+)R/;

console.log('🧠 SIX STRATEGY — 70% WR CONSENSUS OPTIMIZER');
console.log('🔒 Research only | ALL SIX required | MAX OPEN 2 comes from base engine');
console.log('🎯 Target: WR≈70% with ~4.5–5+ signals/active day, strong Winning Days and positive PF/net');

for(const [from,to,label] of windows){
  process.stdout.write(`\n📆 ${label} ${from} → ${to} ... `);
  const r=spawnSync(process.execPath,[engine,from,to],{encoding:'utf8',maxBuffer:64*1024*1024,env:process.env});
  if(r.error||r.status!==0){console.log('❌');console.error(r.error?.message||r.stderr||`exit ${r.status}`);process.exit(1)}
  let n=0;
  for(const line of r.stdout.split(/\r?\n/)){
    const m=line.match(rx); if(!m)continue;
    const x={label,trades:+m[2],wins:+m[3],losses:+m[4],wr:+m[5],winDays:+m[6],active:+m[7],wd:+m[8],loseDays:+m[9],eq:+m[10],avg:+m[11],d5:+m[12],ls:+m[13],dd:+m[14],pf:+m[15],net:+m[16]};
    const combo=m[1].trim();
    if(combo.split('+').length!==6)continue;
    if(!rows.has(combo))rows.set(combo,[]);
    rows.get(combo).push(x); n++;
  }
  console.log(`✅ parsed ${n} TOP rows`);
}

function agg(combo,a){
  const months=a.filter(x=>/^202[56]-\d\d$/.test(x.label));
  const evals=months.length?months:a;
  const trades=evals.reduce((s,x)=>s+x.trades,0),wins=evals.reduce((s,x)=>s+x.wins,0);
  const wr=trades?100*wins/trades:0;
  const active=evals.reduce((s,x)=>s+x.active,0),wdn=evals.reduce((s,x)=>s+x.winDays,0);
  const wd=active?100*wdn/active:0;
  const avg=active?trades/active:0;
  const minWr=Math.min(...evals.map(x=>x.wr)),minWd=Math.min(...evals.map(x=>x.wd));
  const maxLs=Math.max(...evals.map(x=>x.ls)),maxDd=Math.max(...evals.map(x=>x.dd));
  const net=evals.reduce((s,x)=>s+x.net,0);
  const appearances=new Set(evals.map(x=>x.label)).size;
  const near70=wr>=68?2:wr>=66?1:0;
  const activity=avg>=4.5&&avg<=5.5?2:avg>5.5?1:0;
  const score=appearances*100 + near70*30 + activity*15 + wd + wr - maxLs*2 - maxDd*.25;
  return{combo,appearances,trades,wins,wr,wd,avg,minWr,minWd,maxLs,maxDd,net,score};
}

let all=[...rows].map(([c,a])=>agg(c,a));
// Robustness first: a combo must recur; then WR/activity/Winning Days decide.
all.sort((a,b)=>b.score-a.score||b.wr-a.wr||b.wd-a.wd||b.trades-a.trades);

console.log('\n\n🏆 CONSENSUS TOP 20');
for(const [i,x] of all.slice(0,20).entries()){
 console.log(`${String(i+1).padStart(2)} | ${x.combo}`);
 console.log(`   Seen ${x.appearances} monthly TOPs | Trades ${x.trades} W${x.wins} WR ${x.wr.toFixed(1)}% | WinningDays ${x.wd.toFixed(1)}% | Avg ${x.avg.toFixed(2)}/day | WorstWR ${x.minWr.toFixed(1)}% | WorstWD ${x.minWd.toFixed(1)}% | LS≤${x.maxLs} DD≤${x.maxDd.toFixed(2)}R | ΣNet ${x.net.toFixed(2)}R`);
}

const viable=all.filter(x=>x.appearances>=3&&x.avg>=4.3&&x.wr>=60&&x.net>0);
const closest=[...viable].sort((a,b)=>Math.abs(70-a.wr)-Math.abs(70-b.wr)||b.wd-a.wd||b.appearances-a.appearances)[0];
console.log('\n🎯 CLOSEST ROBUST CANDIDATE TO 70%');
if(closest){
 console.log(closest.combo);
 console.log(`WR ${closest.wr.toFixed(1)}% | WinningDays ${closest.wd.toFixed(1)}% | Avg ${closest.avg.toFixed(2)}/day | monthly TOP appearances ${closest.appearances}`);
}else console.log('No candidate passed robustness/activity gates. Do NOT force 70%.');

console.log('\nℹ️ This is a consensus/robustness search over the current candidate pool, not a live change. If it cannot approach 70%, the next round must expand strategy parameter candidates rather than overfit one month.');
