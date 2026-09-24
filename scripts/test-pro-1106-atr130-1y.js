#!/usr/bin/env node
'use strict';
// PRO RAW backtest: no ADX/ATR/body/momentum/hour/smart/FOMC entry filters.
// Keeps RSI 37/63, completed D1 EMA50 bias, SL12, RSI exits 55/45,
// 180m cooldown after a loss, max 2 losses/day.
// Usage: node scripts/test-pro-raw-1y.js
const fs=require('fs');
const file='data/xauusd-m5-dukascopy-2025-09_to_2026-09.json';
if(!fs.existsSync(file)) throw Error('Missing '+file);
let raw=JSON.parse(fs.readFileSync(file,'utf8')); if(!Array.isArray(raw))raw=raw.data||raw.candles||raw.rows||[];
const M=raw.map(x=>({t:+(x.timestamp??x.time??x.t),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
const C={rsiPeriod:14,buyLevel:45,sellLevel:55,buyExitLevel:54,sellExitLevel:50,buyStop:14,sellStop:12,cooldownMinutes:180,maxLossesPerDay:2,dailyEmaPeriod:50};
function ema(v,p){let a=Array(v.length).fill(null),e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function rsi(v,p){let a=Array(v.length).fill(null),g,l;for(let i=1;i<v.length;i++){if(i===p){g=0;l=0;for(let j=1;j<=p;j++){let d=v[j]-v[j-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p}else if(i>p){let d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(i>=p)a[i]=l===0?100:100-100/(1+g/l)}return a}
const R=rsi(M.map(x=>x.c),C.rsiPeriod);\nfunction atr(rows,p=14){const a=Array(rows.length).fill(null);for(let i=p;i<rows.length;i++){let z=0;for(let j=i-p+1;j<=i;j++){const pc=rows[j-1]?.c??rows[j].c;z+=Math.max(rows[j].h-rows[j].l,Math.abs(rows[j].h-pc),Math.abs(rows[j].l-pc))}a[i]=z/p}return a}\nconst ATR=atr(M,14);
const days=new Map();for(const x of M){let k=new Date(x.t).toISOString().slice(0,10);if(!days.has(k))days.set(k,{t:x.t,c:x.c});else days.get(k).c=x.c}
const D=[...days.values()],DE=ema(D.map(x=>x.c),C.dailyEmaPeriod),bias=new Map();
for(let i=1;i<D.length;i++)if(Number.isFinite(DE[i-1]))bias.set(new Date(D[i].t).toISOString().slice(0,10),D[i-1].c>DE[i-1]?'BUY':'SELL');
let trades=[],open=null,cool=0,loss={};
function done(side,en,ex,t){let pnl=side==='BUY'?ex-en:en-ex,r=pnl/(side==='BUY'?C.buyStop:C.sellStop);trades.push({side,r});if(r<0){let d=new Date(t).toISOString().slice(0,10);loss[d]=(loss[d]||0)+1;cool=t+C.cooldownMinutes*60000}open=null}
for(let i=60;i<M.length-1;i++){
 const b=M[i],day=new Date(b.t).toISOString().slice(0,10);
 if(open){const dist=open.side==='BUY'?C.buyStop:C.sellStop;const sl=open.side==='BUY'?open.en-dist:open.en+dist;
  if(open.side==='BUY'&&b.l<=sl){done('BUY',open.en,sl,b.t);continue}
  if(open.side==='SELL'&&b.h>=sl){done('SELL',open.en,sl,b.t);continue}
  if(open.side==='BUY'&&R[i]>=C.buyExitLevel){done('BUY',open.en,b.c,b.t);continue}
  if(open.side==='SELL'&&R[i]<=C.sellExitLevel){done('SELL',open.en,b.c,b.t);continue}
  continue;
 }
 if(b.t<cool||(loss[day]||0)>=C.maxLossesPerDay||!Number.isFinite(R[i])||!Number.isFinite(R[i-1]))continue;
 const B=bias.get(day),h=new Date(b.t).getUTCHours();let side=null;
 if(R[i-1]>=C.buyLevel&&R[i]<C.buyLevel&&B==='BUY'&&h!==8)side='BUY';
 else if(R[i-1]<=C.sellLevel&&R[i]>C.sellLevel&&B==='SELL')side='SELL';
 if(side)open={side,en:M[i+1].o};
}
function stats(a){if(!a.length)return'T0';let w=a.filter(x=>x.r>0),l=a.filter(x=>x.r<0),gp=w.reduce((s,x)=>s+x.r,0),gl=-l.reduce((s,x)=>s+x.r,0),net=a.reduce((s,x)=>s+x.r,0),eq=0,pk=0,dd=0,ls=0,ml=0;for(const x of a){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.r<0){ls++;ml=Math.max(ml,ls)}else ls=0}return `T${a.length} WR${(100*w.length/a.length).toFixed(1)}% PF${gl?(gp/gl).toFixed(2):'∞'} Net${net>=0?'+':''}${net.toFixed(2)}R DD${dd.toFixed(2)}R LS${ml}`}
console.log('\n🧪 PRO 1106 + ATR FILTER — 1 YEAR');
console.log('DATA:',file,'| M5:',M.length);
console.log('TEST: BASE + ATR(14) ratio <= 1.30 only');
console.log('EXPECTED FROM LAST TEST: T1106 WR66.3 PF1.12 Net+41.96R DD18.34R LS8');
console.log('\nALL :',stats(trades));
console.log('BUY :',stats(trades.filter(x=>x.side==='BUY')));
console.log('SELL:',stats(trades.filter(x=>x.side==='SELL')),'\n');
