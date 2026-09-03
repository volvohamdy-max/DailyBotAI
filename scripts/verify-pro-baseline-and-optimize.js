'use strict';
// Deterministic PRO verifier + medium SL14 optimizer.
// IMPORTANT: research only. Does not import or modify live state/files.
const fs=require('fs'),path=require('path');
const f=path.join(__dirname,'../data/backtests/history-cache/XAUUSD_5min.json');
const raw=JSON.parse(fs.readFileSync(f,'utf8'));
const c=(Array.isArray(raw)?raw:(raw.values||raw.data||raw.candles||[])).map(x=>({timestamp:+(x.timestamp??x.time??x.datetime),open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>Number.isFinite(x.timestamp)&&[x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
const C=c.map(x=>x.close),DAY=86400000;
function ema(v,p){const o=Array(v.length).fill(NaN),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(NaN);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];gs+=Math.max(q,0);ls+=Math.max(-q,0)}ag=gs/p;al=ls/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(a,p=14){const o=Array(a.length).fill(NaN);for(let i=p;i<a.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=a[j-1].close;s+=Math.max(a[j].high-a[j].low,Math.abs(a[j].high-pc),Math.abs(a[j].low-pc))}o[i]=s/p}return o}
function adx(a,p=14){const o=Array(a.length).fill(NaN),tr=Array(a.length).fill(0),pd=Array(a.length).fill(0),md=Array(a.length).fill(0);for(let i=1;i<a.length;i++){const up=a[i].high-a[i-1].high,dn=a[i-1].low-a[i].low;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(a[i].high-a[i].low,Math.abs(a[i].high-a[i-1].close),Math.abs(a[i].low-a[i-1].close))}let tn=0,pn=0,mn=0;for(let i=1;i<=p;i++){tn+=tr[i];pn+=pd[i];mn+=md[i]}const dx=Array(a.length).fill(NaN);for(let i=p;i<a.length;i++){if(i>p){tn=tn-tn/p+tr[i];pn=pn-pn/p+pd[i];mn=mn-mn/p+md[i]}if(tn>0){const pdi=100*pn/tn,mdi=100*mn/tn;if(pdi+mdi)dx[i]=100*Math.abs(pdi-mdi)/(pdi+mdi)}}let seed=0,n=0;for(let i=p;i<a.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function agg(a){const m=new Map;for(const b of a){const k=Math.floor(b.timestamp/DAY)*DAY,z=m.get(k);if(!z)m.set(k,{timestamp:k,close:b.close});else z.close=b.close}return [...m.values()]}
const R=rsi(C),A=atr(c),D=adx(c),days=agg(c),DE=ema(days.map(x=>x.close),50),blocked=new Set([1,2,3,4,5,15,16,21,22,23]);
// Precompute day index, ATR heat and candle body ratio once: faster + deterministic.
const dayIdx=Array(c.length),atrHeat=Array(c.length).fill(NaN),body=Array(c.length).fill(0);let di=0;
for(let i=0;i<c.length;i++){while(di+1<days.length&&days[di+1].timestamp<c[i].timestamp)di++;dayIdx[i]=di;const rg=c[i].high-c[i].low;body[i]=rg>0?Math.abs(c[i].close-c[i].open)/rg:0;if(i>=50){let s=0,ok=true;for(let j=i-50;j<i;j++){if(!Number.isFinite(A[j])){ok=false;break}s+=A[j]}if(ok&&s>0)atrHeat[i]=A[i]/(s/50)}}
function stats(tr){const n=tr.length,w=tr.filter(x=>x.r>0).length,net=tr.reduce((s,x)=>s+x.r,0),gp=tr.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0),gl=-tr.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0);let eq=0,pk=0,dd=0;for(const x of tr){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{n,w,wr:n?100*w/n:0,net,pf:gl?gp/gl:(gp?Infinity:0),dd}}
// exactFresh=true reproduces the previous Fresh Live-7 PRO methodology: no daily loss/cooldown suppression and signals may overlap.
function test(q,exactFresh){const tr=[],lossDay={},coolUntil=0;for(let i=230;i<c.length-20;i++){const t=c[i].timestamp,dt=new Date(t),h=dt.getUTCHours(),day=dt.toISOString().slice(0,10),d=dayIdx[i];if(blocked.has(h))continue;if(!exactFresh&&dt.getUTCDay()===3&&(h*60+dt.getUTCMinutes()>=1020&&h*60+dt.getUTCMinutes()<=1230))continue;if(!exactFresh&&((lossDay[day]||0)>=2||t<coolUntil))continue;if(d<50||!Number.isFinite(DE[d])||!Number.isFinite(atrHeat[i])||atrHeat[i]>q.atrMax||!Number.isFinite(D[i])||D[i]<q.adxMin||body[i]<q.body)continue;const bias=days[d].close>DE[d]?'BUY':'SELL';const side=R[i-1]>=q.entry&&R[i]<q.entry&&bias==='BUY'?'BUY':R[i-1]<=100-q.entry&&R[i]>100-q.entry&&bias==='SELL'?'SELL':null;if(!side)continue;const entry=c[i+1]?.open;if(!Number.isFinite(entry))continue;const sl=side==='BUY'?entry-q.stop:entry+q.stop;let r=null,exitIndex=null;for(let j=i+1;j<c.length&&j<=i+1000;j++){const x=c[j];if(side==='BUY'?x.low<=sl:x.high>=sl){r=-1;exitIndex=j;break}if(side==='BUY'?R[j]>=q.exit:R[j]<=100-q.exit){r=(side==='BUY'?(x.close-entry):(entry-x.close))/q.stop;exitIndex=j;break}}if(r==null)continue;tr.push({r,i,exitIndex});if(!exactFresh&&r<0){lossDay[day]=(lossDay[day]||0)+1;coolUntil=c[exitIndex].timestamp+180*60000}}
return{...q,...stats(tr)}}
function line(name,x){console.log(`${name.padEnd(20)} T ${String(x.n).padStart(3)} | WR ${x.wr.toFixed(1)}% | Net ${x.net>=0?'+':''}${x.net.toFixed(2)}R | PF ${x.pf.toFixed(2)} | DD ${x.dd.toFixed(2)}R`)}
const current={stop:12,entry:37,exit:55,adxMin:18,atrMax:1.15,body:.50};
console.log(`\n🧪 PRO BASELINE VERIFIER | ${c.length} M5 candles`);
line('Fresh-Live7 baseline',test(current,true));
line('Stateful baseline',test(current,false));
console.log('\n🎯 SL14 TARGET SEARCH (deterministic Fresh-Live7 engine)');
const cfg=[];for(const adxMin of [10,12,14,16,18])for(const entry of [38,39,40,41,42])for(const exit of [51,52,53,54,55])for(const atrMax of [1.10,1.15,1.20,1.25])for(const bd of [.40,.50])cfg.push({stop:14,entry,exit,adxMin,atrMax,body:bd});
let out=cfg.map(q=>test(q,true)).filter(x=>x.n>=240&&x.n<=320&&x.net>0&&x.pf>1).sort((a,b)=>(b.wr-a.wr)||(b.pf-a.pf)||(b.net-a.net)||(a.dd-b.dd));
console.log(`Tested ${cfg.length} | Qualified 240-320 trades: ${out.length}\n`);
for(let i=0;i<Math.min(30,out.length);i++){const x=out[i];console.log(`${String(i+1).padStart(2)} | SL $14 | Entry ${x.entry}/${100-x.entry} | Exit ${x.exit}/${100-x.exit} | ADX ${x.adxMin} | ATR ${x.atrMax.toFixed(2)} | Body ${x.body.toFixed(2)} | T ${x.n} | WR ${x.wr.toFixed(1)}% | Net ${x.net>=0?'+':''}${x.net.toFixed(2)}R | PF ${x.pf.toFixed(2)} | DD ${x.dd.toFixed(2)}R`)}
