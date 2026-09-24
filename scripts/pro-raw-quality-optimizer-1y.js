#!/usr/bin/env node
'use strict';
// Fast PRO RAW quality optimizer — 1Y Dukascopy.
// Searches RSI entries/exits + SL, while keeping D1 EMA50, CD180, MAXLOSS2.
// No ADX/ATR/body/momentum/hour/FOMC filters.
const fs=require('fs');
const file='data/xauusd-m5-dukascopy-2025-09_to_2026-09.json';
if(!fs.existsSync(file))throw Error('Missing '+file);
let raw=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(raw))raw=raw.data||raw.candles||raw.rows||[];
const M=raw.map(x=>({t:+(x.timestamp??x.time??x.t),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
function ema(v,p){let a=Array(v.length).fill(null),e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function rsi(v,p=14){let a=Array(v.length).fill(null),g,l;for(let i=1;i<v.length;i++){if(i===p){g=0;l=0;for(let j=1;j<=p;j++){let d=v[j]-v[j-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p}else if(i>p){let d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(i>=p)a[i]=l===0?100:100-100/(1+g/l)}return a}
const R=rsi(M.map(x=>x.c),14);
const days=new Map();for(const x of M){let k=new Date(x.t).toISOString().slice(0,10);if(!days.has(k))days.set(k,{t:x.t,c:x.c});else days.get(k).c=x.c}
const D=[...days.values()],DE=ema(D.map(x=>x.c),50),B=new Array(M.length);
const bm=new Map();for(let i=1;i<D.length;i++)if(Number.isFinite(DE[i-1]))bm.set(new Date(D[i].t).toISOString().slice(0,10),D[i-1].c>DE[i-1]?'BUY':'SELL');
for(let i=0;i<M.length;i++)B[i]=bm.get(new Date(M[i].t).toISOString().slice(0,10));
function run(c){
 let tr=[],op=null,cool=0,loss={};
 const done=(s,en,ex,t)=>{let rr=(s==='BUY'?ex-en:en-ex)/c.sl;tr.push({s,r:rr});if(rr<0){let d=new Date(t).toISOString().slice(0,10);loss[d]=(loss[d]||0)+1;cool=t+10800000}op=null};
 for(let i=60;i<M.length-1;i++){let x=M[i],day=new Date(x.t).toISOString().slice(0,10);
  if(op){let sl=op.s==='BUY'?op.en-c.sl:op.en+c.sl;if(op.s==='BUY'&&x.l<=sl){done('BUY',op.en,sl,x.t);continue}if(op.s==='SELL'&&x.h>=sl){done('SELL',op.en,sl,x.t);continue}if(op.s==='BUY'&&R[i]>=c.bx){done('BUY',op.en,x.c,x.t);continue}if(op.s==='SELL'&&R[i]<=c.sx){done('SELL',op.en,x.c,x.t);continue}continue}
  if(x.t<cool||(loss[day]||0)>=2||!Number.isFinite(R[i])||!Number.isFinite(R[i-1]))continue;
  let s=null;if(R[i-1]>=c.bl&&R[i]<c.bl&&B[i]==='BUY')s='BUY';else if(R[i-1]<=c.slv&&R[i]>c.slv&&B[i]==='SELL')s='SELL';if(s)op={s,en:M[i+1].o};
 }
 return metrics(tr);
}
function metrics(a){let n=a.length,w=0,gp=0,gl=0,net=0,eq=0,pk=0,dd=0,ls=0,ml=0,bn=0,bw=0,sn=0,sw=0;for(const x of a){if(x.r>0){w++;gp+=x.r;ls=0}else if(x.r<0){gl-=x.r;ls++;ml=Math.max(ml,ls)}net+=x.r;eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.s==='BUY'){bn++;if(x.r>0)bw++}else{sn++;if(x.r>0)sw++}}return{n,wr:n?100*w/n:0,pf:gl?gp/gl:999,net,dd,ls:ml,bn,bwr:bn?100*bw/bn:0,sn,swr:sn?100*sw/sn:0}}
function fmt(c,m){return `BUY${c.bl}/SELL${c.slv} EXIT${c.bx}/${c.sx} SL${c.sl} | T${m.n} WR${m.wr.toFixed(1)} PF${m.pf.toFixed(2)} N${m.net>=0?'+':''}${m.net.toFixed(1)}R DD${m.dd.toFixed(1)} LS${m.ls} | B${m.bn}@${m.bwr.toFixed(1)}% S${m.sn}@${m.swr.toFixed(1)}%`}
console.log('\n🧪 PRO RAW QUALITY OPTIMIZER — 1 YEAR');
console.log('M5:',M.length,'| combos: 4,500');
const base={bl:37,slv:63,bx:55,sx:45,sl:12},baseM=run(base);console.log('\nBASE:',fmt(base,baseM));
let all=[],k=0;
for(const bl of [32,34,36,37,38])for(const slv of [62,63,64,66,68])for(const bx of [52,55,58])for(const sx of [42,45,48])for(const sl of [8,10,12,14]){
 let c={bl,slv,bx,sx,sl},m=run(c);k++;
 // Quality first, but punish tiny samples and excessive DD.
 let score=m.wr*1.8+m.pf*18+m.net*.18-Math.max(0,350-m.n)*.08-m.dd*.35;
 all.push({c,m,score});
}
all.sort((a,b)=>b.score-a.score);
console.log('\n🏆 TOP 20 — QUALITY + ENOUGH TRADES');
for(let i=0;i<20;i++)console.log(String(i+1).padStart(2),fmt(all[i].c,all[i].m));
const q=all.filter(x=>x.m.n>=350&&x.m.wr>=60).sort((a,b)=>b.m.net-a.m.net);
console.log('\n🎯 WR>=60% & T>=350 — BEST NET');
if(q.length)q.slice(0,15).forEach((x,i)=>console.log(String(i+1).padStart(2),fmt(x.c,x.m)));else console.log('No combo met both constraints.');
console.log('\nTested:',k,'combinations. LIVE NOT CHANGED.\n');
