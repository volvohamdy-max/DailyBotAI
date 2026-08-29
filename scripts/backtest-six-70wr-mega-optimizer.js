#!/usr/bin/env node
'use strict';
/**
 * SIX STRATEGY 70WR MEGA OPTIMIZER — research only.
 *
 * Purpose:
 * - Keep ALL six live strategy families represented.
 * - Expand the search beyond the old 1296 portfolio combinations.
 * - Run several discovery windows, collect the best all-six portfolios,
 *   then validate the recurring candidates on 6M and 1Y robustness runs.
 * - Target 70% WR while preferring roughly 4.5–5+ signals/active day.
 *
 * IMPORTANT: this launcher never edits live strategy files.
 */
const {spawnSync}=require('child_process');

const windows=[
 ['2026-07-29','2026-08-29','AUG'],
 ['2026-06-01','2026-06-30','JUN'],
 ['2026-05-01','2026-05-31','MAY'],
 ['2026-04-01','2026-04-30','APR'],
 ['2026-03-01','2026-03-31','MAR'],
 ['2026-02-01','2026-02-28','FEB'],
 ['2026-01-01','2026-01-31','JAN'],
 ['2026-03-01','2026-08-29','6M'],
 ['2025-08-29','2026-08-29','1Y'],
];
const engine='scripts/backtest-six-final-month-combo.js';
const rows=[];
function parse(text,label){
 const re=/\|\s+(E-[^+\n]+\+\s+R-[^+\n]+\+\s+G-[^+\n]+\+\s+P-[^+\n]+\+\s+N-[^+\n]+\+\s+S-[^|\n]+)\|\s+Trades\s+(\d+)\s+W(\d+)\/L(\d+)\s+WR([\d.]+)%\s+\|\s+WinDays\s+(\d+)\/(\d+)=([\d.]+)%[^|]*\|\s+Avg\s+([\d.]+)\s+D5\+\s+(\d+)\s+\|\s+LS(\d+)\s+DD([\d.]+)\s+PF([\d.]+)\s+Net\s+([\-\d.]+)R/g;
 let m; while((m=re.exec(text))){rows.push({label,combo:m[1].trim().replace(/\s+/g,' '),n:+m[2],w:+m[3],l:+m[4],wr:+m[5],wd:+m[8],avg:+m[9],d5:+m[10],ls:+m[11],dd:+m[12],pf:+m[13],net:+m[14]});}
}
console.log('🧠 SIX STRATEGY 70WR MEGA OPTIMIZER');
console.log('🎯 Goal: push WR toward 70% without killing activity');
console.log('🔒 ALL SIX remain included | MAX OPEN 2 inside engine | LIVE untouched');
for(const [from,to,label] of windows){
 console.log(`\n━━━━━━━━ ${label} ${from} → ${to} ━━━━━━━━`);
 const p=spawnSync(process.execPath,[engine,from,to],{encoding:'utf8',maxBuffer:1024*1024*40});
 if(p.error){console.error(p.error);process.exit(1)}
 if(p.status!==0){console.error(p.stderr||p.stdout);process.exit(p.status||1)}
 parse(p.stdout,label);
 const lines=p.stdout.split('\n');
 const ix=lines.findIndex(x=>x.includes('🏆 TOP 20'));
 console.log((ix>=0?lines.slice(ix,Math.min(lines.length,ix+22)):lines.slice(-25)).join('\n'));
}
const by=new Map();
for(const x of rows){const a=by.get(x.combo)||[];a.push(x);by.set(x.combo,a)}
const ranked=[];
for(const [combo,a] of by){
 const months=a.filter(x=>!['6M','1Y'].includes(x.label));
 const long=a.filter(x=>['6M','1Y'].includes(x.label));
 const n=a.reduce((s,x)=>s+x.n,0),w=a.reduce((s,x)=>s+x.w,0);
 const wr=n?100*w/n:0, avg=a.reduce((s,x)=>s+x.avg,0)/a.length;
 const worstWR=Math.min(...a.map(x=>x.wr)), worstWD=Math.min(...a.map(x=>x.wd));
 const maxLS=Math.max(...a.map(x=>x.ls)),maxDD=Math.max(...a.map(x=>x.dd));
 const net=a.reduce((s,x)=>s+x.net,0);
 const robust=months.length>=2&&avg>=4.5&&wr>=60&&worstWR>=55&&maxLS<=8&&net>0;
 // WR first, but reward recurrence and activity so a tiny lucky sample cannot win.
 const score=(wr*4)+(Math.min(avg,5.5)*8)+(months.length*12)+(long.length*18)+(worstWR*1.5)+(worstWD*.6)-maxLS*2-maxDD*.4;
 ranked.push({combo,a,months:months.length,long:long.length,n,w,wr,avg,worstWR,worstWD,maxLS,maxDD,net,robust,score});
}
ranked.sort((a,b)=>(b.robust-a.robust)||b.score-a.score||b.wr-a.wr||b.n-a.n);
console.log('\n🏆 MEGA CONSENSUS TOP 25');
for(let i=0;i<Math.min(25,ranked.length);i++){
 const x=ranked[i]; console.log(`${String(i+1).padStart(2)} | ${x.combo}\n   Seen ${x.months} monthly + ${x.long} long | Trades ${x.n} W${x.w} WR ${x.wr.toFixed(1)}% | Avg ${x.avg.toFixed(2)}/day | WorstWR ${x.worstWR.toFixed(1)}% | WorstWD ${x.worstWD.toFixed(1)}% | LS≤${x.maxLS} DD≤${x.maxDD.toFixed(2)}R | ΣNet ${x.net.toFixed(2)}R ${x.robust?'✅':''}`);
}
const good=ranked.filter(x=>x.robust&&x.avg>=4.5);
const best=good.sort((a,b)=>Math.abs(70-a.wr)-Math.abs(70-b.wr)||b.wr-a.wr||b.n-a.n)[0];
console.log('\n🎯 CLOSEST ROBUST ALL-SIX CANDIDATE TO 70%');
if(best){
 console.log(best.combo);
 console.log(`Combined observed: Trades ${best.n} | Wins ${best.w} | WR ${best.wr.toFixed(1)}% | Avg ${best.avg.toFixed(2)}/day | WorstWR ${best.worstWR.toFixed(1)}% | WorstWD ${best.worstWD.toFixed(1)}% | LS≤${best.maxLS} | DD≤${best.maxDD.toFixed(2)}R | ΣNet ${best.net.toFixed(2)}R`);
 console.log(best.wr>=68?'🔥 We are in the 68–70 zone. Freeze it and run strict fixed OOS next.':'➡️ Current expanded portfolio pool still needs deeper per-strategy parameter expansion to reach 68–70 robustly.');
}else console.log('No robust 4.5+/day candidate survived. Do not fake 70%; expand per-strategy parameters next.');
console.log('\n⚠️ Research only. No live strategy was modified.');
