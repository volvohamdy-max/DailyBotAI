#!/usr/bin/env node
'use strict';

/*
 * Generic live-strategy backtester.
 * PRO is NOT copied here: its CONFIG is loaded directly from the live file.
 * Usage: node scripts/test-live-strategy.js pro
 */
const fs=require('fs'),vm=require('vm');

const name=(process.argv[2]||'pro').toLowerCase();
const paths={pro:'src/services/scalpStrategies/proStrategy.js'};
const livePath=paths[name];
if(!livePath||!fs.existsSync(livePath))throw Error('Unknown/missing live strategy: '+name);

const src=fs.readFileSync(livePath,'utf8');
const m=src.match(/const CONFIG\s*=\s*({[\s\S]*?\n});/);
if(!m)throw Error('Could not read CONFIG from '+livePath);
const C=vm.runInNewContext('('+m[1]+')');

const files=[
 'data/xauusd-m5-dukascopy-3year-2023-09_to_2026-09.json',
 'data/xauusd-m5-dukascopy-2025-09_to_2026-09.json',
 'data/xauusd-m5-dukascopy.json'
];
const file=files.find(fs.existsSync);
if(!file)throw Error('Dukascopy M5 data not found');

let raw=JSON.parse(fs.readFileSync(file,'utf8'));
if(!Array.isArray(raw))raw=raw.data||raw.candles||raw.rows||[];
const M=raw.map(x=>({t:+(x.timestamp??x.time??x.t),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)}))
 .filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
if(M.length<1000)throw Error('Invalid/short data');

function ema(v,p){let a=Array(v.length).fill(null),e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function rsi(v,p){let a=Array(v.length).fill(null),g,l;for(let i=1;i<v.length;i++){if(i===p){g=0;l=0;for(let j=1;j<=p;j++){let d=v[j]-v[j-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=p;l/=p}else if(i>p){let d=v[i]-v[i-1];g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}if(i>=p)a[i]=l===0?100:100-100/(1+g/l)}return a}
function atr(r,p){let a=Array(r.length).fill(null),tr=Array(r.length);for(let i=1;i<r.length;i++)tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c));let s=0;for(let i=1;i<r.length;i++){s+=tr[i];if(i>p)s-=tr[i-p];if(i>=p)a[i]=s/p}return a}
function adx(r,p){let o=Array(r.length).fill(null),tr=Array(r.length).fill(0),pd=Array(r.length).fill(0),md=Array(r.length).fill(0);for(let i=1;i<r.length;i++){let u=r[i].h-r[i-1].h,d=r[i-1].l-r[i].l;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c))}let T=0,P=0,N=0,dx=Array(r.length).fill(null);for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];N+=md[i]}for(let i=p;i<r.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];N=N-N/p+md[i]}let pi=100*P/T,ni=100*N/T;if(pi+ni)dx[i]=100*Math.abs(pi-ni)/(pi+ni)}let seed=0,n=0,last=null;for(let i=p;i<r.length;i++){if(!Number.isFinite(dx[i]))continue;if(n<p){seed+=dx[i];n++;if(n===p)last=o[i]=seed/p}else last=o[i]=(last*(p-1)+dx[i])/p}return o}

const closes=M.map(x=>x.c),R=rsi(closes,C.rsiPeriod),A=atr(M,C.atrPeriod),X=adx(M,C.adxPeriod);
const days=new Map();for(const x of M){let k=new Date(x.t).toISOString().slice(0,10);if(!days.has(k))days.set(k,{t:x.t,c:x.c});else days.get(k).c=x.c}
const D=[...days.values()],DE=ema(D.map(x=>x.c),C.dailyEmaPeriod),bias=new Map();
for(let i=1;i<D.length;i++)if(Number.isFinite(DE[i-1]))bias.set(new Date(D[i].t).toISOString().slice(0,10),D[i-1].c>DE[i-1]?'BUY':'SELL');

let trades=[],open=null,cool=0,loss={};
function done(side,en,ex,t){let pnl=side==='BUY'?ex-en:en-ex,r=pnl/C.stopDistance;trades.push({side,r});if(r<0){let d=new Date(t).toISOString().slice(0,10);loss[d]=(loss[d]||0)+1;cool=t+C.cooldownMinutes*60000}open=null}

for(let i=Math.max(70,C.atrAverageLookback+C.atrPeriod+2,36);i<M.length-1;i++){
 let b=M[i],dt=new Date(b.t),day=dt.toISOString().slice(0,10);
 if(open){let sl=open.side==='BUY'?open.en-C.stopDistance:open.en+C.stopDistance;
   if(open.side==='BUY'&&b.l<=sl){done('BUY',open.en,sl,b.t);continue}
   if(open.side==='SELL'&&b.h>=sl){done('SELL',open.en,sl,b.t);continue}
   if(open.side==='BUY'&&R[i]>=C.buyExitLevel){done('BUY',open.en,b.c,b.t);continue}
   if(open.side==='SELL'&&R[i]<=C.sellExitLevel){done('SELL',open.en,b.c,b.t);continue}
   continue;
 }
 if(b.t<cool||(loss[day]||0)>=C.maxLossesPerDay)continue;
 let h=dt.getUTCHours(),mins=h*60+dt.getUTCMinutes();
 if(C.blockedUtcHours.has(h)||(dt.getUTCDay()===3&&mins>=1020&&mins<=1230))continue;
 if(![R[i],R[i-1],A[i],X[i]].every(Number.isFinite))continue;
 let q=A.slice(i-C.atrAverageLookback,i).filter(Number.isFinite);if(q.length<C.atrAverageLookback)continue;
 let ar=A[i]/(q.reduce((a,z)=>a+z,0)/q.length);if(ar>C.atrRatioMax)continue;
 let B=bias.get(day),side=null;
 if(R[i-1]>=C.buyLevel&&R[i]<C.buyLevel&&B==='BUY')side='BUY';
 if(R[i-1]<=C.sellLevel&&R[i]>C.sellLevel&&B==='SELL')side='SELL';
 if(!side)continue;
 // Current smart blocks from LIVE proStrategy.js.
 if(side==='BUY'&&(h===2||h===16))continue;
 if(side==='SELL'&&h===13)continue;
 if(side==='SELL'&&ar>=1.30)continue;
 if(X[i]<(side==='BUY'?C.buyAdxMin:C.sellAdxMin))continue;
 let range=b.h-b.l;if(range<=0||Math.abs(b.c-b.o)/range<C.minBodyRange)continue;
 if(side==='BUY'&&(i<36||b.c-M[i-36].c<C.buyMomentum3hMin))continue;
 open={side,en:M[i+1].o};
}
function stats(a){if(!a.length)return'T0';let w=a.filter(x=>x.r>0),l=a.filter(x=>x.r<0),gp=w.reduce((s,x)=>s+x.r,0),gl=-l.reduce((s,x)=>s+x.r,0),net=a.reduce((s,x)=>s+x.r,0),eq=0,pk=0,dd=0,ls=0,ml=0;for(const x of a){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.r<0){ls++;ml=Math.max(ml,ls)}else ls=0}return`T${a.length} WR${(100*w.length/a.length).toFixed(1)}% PF${gl?(gp/gl).toFixed(2):'∞'} Net${net>=0?'+':''}${net.toFixed(2)}R DD${dd.toFixed(2)}R LS${ml}`}
console.log('\n🔥 LIVE STRATEGY TEST');
console.log('SOURCE:',livePath);
console.log('DATA:',file,'| M5:',M.length);
console.log('CONFIG:',{buy:C.buyLevel,sell:C.sellLevel,exitBuy:C.buyExitLevel,exitSell:C.sellExitLevel,SL:C.stopDistance,ADX:[C.buyAdxMin,C.sellAdxMin],ATRmax:C.atrRatioMax,body:C.minBodyRange,mom3h:C.buyMomentum3hMin,blocked:[...C.blockedUtcHours]});
console.log('\nALL :',stats(trades));
console.log('BUY :',stats(trades.filter(x=>x.side==='BUY')));
console.log('SELL:',stats(trades.filter(x=>x.side==='SELL')),'\n');
