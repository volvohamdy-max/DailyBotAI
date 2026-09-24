#!/usr/bin/env node
'use strict';
// PRO RAW backtest: no ADX/ATR/body/momentum/hour/smart/FOMC entry filters.
// Keeps RSI 37/63, completed D1 EMA50 bias, SL12, RSI exits 55/45,
// 180m cooldown after a loss, max 2 losses/day.
// Usage: node scripts/test-pro-raw-1y.js
const fs=require('fs');
const file='data/xauusdm-m5-exness-2026.json';
if(!fs.existsSync(file)) throw Error('Missing '+file);
let raw=JSON.parse(fs.readFileSync(file,'utf8')); if(!Array.isArray(raw))raw=raw.data||raw.candles||raw.rows||[];
const M=raw.map(x=>({t:+(x.timestamp??x.time??x.t),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
const C={rsiPeriod:14,buyLevel:45,sellLevel:55,buyExitLevel:54,sellExitLevel:50,buyStop:14,sellStop:12,cooldownMinutes:180,maxLossesPerDay:2,dailyEmaPeriod:50};
function ema(v,p){let a=Array(v.length).fill(null),e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function atr(rows,p=14){let a=Array(rows.length).fill(null),tr=[];for(let i=0;i<rows.length;i++){let pc=i?rows[i-1].c:rows[i].c;tr[i]=Math.max(rows[i].h-rows[i].l,Math.abs(rows[i].h-pc),Math.abs(rows[i].l-pc));if(i>=p-1)a[i]=tr.slice(i-p+1,i+1).reduce((x,y)=>x+y,0)/p}return a}
function adx(rows,p=14){let out=Array(rows.length).fill(null),tr=[],pd=[],md=[];for(let i=1;i<rows.length;i++){let up=rows[i].h-rows[i-1].h,dn=rows[i-1].l-rows[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(rows[i].h-rows[i].l,Math.abs(rows[i].h-rows[i-1].c),Math.abs(rows[i].l-rows[i-1].c))}for(let i=p*2;i<rows.length;i++){let ts=0,ps=0,ms=0;for(let j=i-p+1;j<=i;j++){ts+=tr[j]||0;ps+=pd[j]||0;ms+=md[j]||0}let pdi=ts?100*ps/ts:0,mdi=ts?100*ms/ts:0,dx=pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0;let ds=[];for(let k=i-p+1;k<=i;k++){let tt=0,pp=0,mm=0;for(let j=Math.max(1,k-p+1);j<=k;j++){tt+=tr[j]||0;pp+=pd[j]||0;mm+=md[j]||0}let pi=tt?100*pp/tt:0,mi=tt?100*mm/tt:0;ds.push(pi+mi?100*Math.abs(pi-mi)/(pi+mi):0)}out[i]=ds.reduce((x,y)=>x+y,0)/ds.length}return out}
function rsi(v,p){let a=Array(v.length).fill(null),g,l;for(let i=1;i<v.length;i++){if(i===p){g=0;l=0;for(let j=1;j<=p;j++){let d=v[j]-v[j-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p}else if(i>p){let d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(i>=p)a[i]=l===0?100:100-100/(1+g/l)}return a}
const R=rsi(M.map(x=>x.c),C.rsiPeriod),ATR=atr(M,14),ADX=adx(M,14);
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
 const B=bias.get(day),h=new Date(b.t).getUTCHours();if(h===1||h===6||h===8||(h>=14&&h<=19))continue;let side=null;
 let av=null;if(i>=50){let z=ATR.slice(i-50,i).filter(Number.isFinite);if(z.length===50)av=z.reduce((a,b)=>a+b,0)/50}
 let ar=Number.isFinite(ATR[i])&&av>0?ATR[i]/av:null,range=b.h-b.l,body=range>0?Math.abs(b.c-b.o)/range:0;
 let mom=i>=36?(b.c-M[i-36].c)/(ATR[i]||1):null;
 let wed=new Date(b.t).getUTCDay()===3,fomc=wed&&(h>=17&&h<=20);
 if(R[i-1]>=C.buyLevel&&R[i]<C.buyLevel&&B==='BUY'&&h!==8&&!fomc&&ADX[i]>=20&&ar>=0.50&&ar<=1.30&&body>=0.55&&mom>=-25)side='BUY';
 else if(R[i-1]<=C.sellLevel&&R[i]>C.sellLevel&&B==='SELL'&&!fomc&&ADX[i]>=18&&ar>=0.75&&ar<=1.30&&body>=0.45)side='SELL';
 if(side)open={side,en:M[i+1].o};
}
function stats(a){if(!a.length)return'T0';let w=a.filter(x=>x.r>0),l=a.filter(x=>x.r<0),gp=w.reduce((s,x)=>s+x.r,0),gl=-l.reduce((s,x)=>s+x.r,0),net=a.reduce((s,x)=>s+x.r,0),eq=0,pk=0,dd=0,ls=0,ml=0;for(const x of a){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.r<0){ls++;ml=Math.max(ml,ls)}else ls=0}return `T${a.length} WR${(100*w.length/a.length).toFixed(1)}% PF${gl?(gp/gl).toFixed(2):'∞'} Net${net>=0?'+':''}${net.toFixed(2)}R DD${dd.toFixed(2)}R LS${ml}`}
console.log('\nPRO CURRENT LIVE - EXNESS 4 MONTH BACKTEST');
console.log('DATA:',file,'| M5:',M.length);
console.log('FILTERS: ADX TEST BUY20 SELL18 | ATR BUY .50-1.30 SELL .75-1.30 | BODY TEST BUY .55 SELL .45 | BUY MOM3H TEST >= -25 | BUY BLOCK08 | WED 17-20 UTC BLOCK');
console.log('CURRENT LIVE: ADX BUY20 SELL18 | ATR BUY .50-1.30 SELL .75-1.30 | BODY BUY .55 SELL .45 | BUY MOM3H >= -25 | LOSS-HOUR BLOCKS');
console.log('\nALL :',stats(trades));
console.log('BUY :',stats(trades.filter(x=>x.side==='BUY')));
console.log('SELL:',stats(trades.filter(x=>x.side==='SELL')),'\n');
