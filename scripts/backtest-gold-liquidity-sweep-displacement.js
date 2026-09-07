#!/usr/bin/env node
'use strict';

// RESEARCH ONLY. Does not import or modify live strategy code.
// XAUUSD M5: liquidity sweep -> displacement/reclaim -> next-bar entry.
const { getHistoricalRates } = require('dukascopy-node');
const FROM=process.argv[2]||'2025-08-24';
const TO=process.argv[3]||'2026-08-24';
const CACHE='./data/dukascopy-cache';

function atr(c,p=14){const a=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc));}a[i]=s/p;}return a;}
function stat(t){let eq=0,peak=0,dd=0,gp=0,gl=0,w=0,ls=0,maxls=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(x.r>0){w++;gp+=x.r;ls=0}else{gl+=-x.r;maxls=Math.max(maxls,++ls)}}return{n:t.length,wr:t.length?w/t.length*100:0,net:eq,pf:gl?gp/gl:(gp?999:0),dd,ls:maxls};}
function fmt(s){return `${s.n} trades | WR ${s.wr.toFixed(1)}% | PF ${s.pf.toFixed(2)} | Net ${s.net>=0?'+':''}${s.net.toFixed(1)}R | DD ${s.dd.toFixed(1)}R | LS ${s.ls}`;}

(async()=>{
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',priceType:'bid',volumes:true,useCache:true,cacheFolderPath:CACHE});
 const c=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).sort((a,b)=>a.timestamp-b.timestamp);const A=atr(c);
 console.log(`LIQUIDITY SWEEP LAB | ${c.length} M5 candles | ${FROM} -> ${TO}`);
 const configs=[];for(const lookback of [6,9,12,18])for(const sweepATR of [.05,.10,.15,.20])for(const bodyATR of [.20,.30,.40])for(const slATR of [.55,.75,1])for(const rr of [1,1.25,1.5])configs.push({lookback,sweepATR,bodyATR,slATR,rr});
 function run(q,start,end){const T=[];for(let i=Math.max(30,start);i<Math.min(end,c.length-20);i++){if(!A[i])continue;const h=new Date(c[i].timestamp).getUTCHours();if(h<6||h>19)continue;let hi=-Infinity,lo=Infinity;for(let k=i-q.lookback;k<i;k++){hi=Math.max(hi,c[k].high);lo=Math.min(lo,c[k].low)}const x=c[i],range=x.high-x.low,body=Math.abs(x.close-x.open);if(!(range>0&&body>=A[i]*q.bodyATR))continue;let side=null;if(x.high>=hi+A[i]*q.sweepATR&&x.close<hi&&x.close<x.open)side='SELL';else if(x.low<=lo-A[i]*q.sweepATR&&x.close>lo&&x.close>x.open)side='BUY';if(!side)continue;const entry=c[i+1].open,risk=A[i]*q.slATR,stop=side==='BUY'?entry-risk:entry+risk,target=side==='BUY'?entry+risk*q.rr:entry-risk*q.rr;let r=null;for(let j=i+1;j<=i+12;j++){const sl=side==='BUY'?c[j].low<=stop:c[j].high>=stop,tp=side==='BUY'?c[j].high>=target:c[j].low<=target;if(sl||tp){r=sl?-1:q.rr;break}}if(r===null){const exit=c[i+12].close;r=(side==='BUY'?(exit-entry):(entry-exit))/risk;r=Math.max(-1,Math.min(q.rr,r));}T.push({r,time:c[i].timestamp});i+=2;}return T;}
 // Strict chronological split by candles: optimize only first 75%; final 25% is untouched holdout.
 const cut=Math.floor(c.length*.75),rank=[];for(const q of configs){const d=run(q,0,cut),s=stat(d);if(s.n>=80&&s.pf>1&&s.net>0)rank.push({q,s,score:s.net-0.35*s.dd});}rank.sort((a,b)=>b.score-a.score);
 console.log(`Tested ${configs.length} configs; DEV candidates ${rank.length}`);console.log('TOP DEV');rank.slice(0,10).forEach((x,n)=>console.log(`${n+1}. ${JSON.stringify(x.q)} | ${fmt(x.s)}`));
 console.log('\nUNTOUCHED HOLDOUT');for(const [n,x] of rank.slice(0,5).entries()){const o=stat(run(x.q,cut,c.length));console.log(`${n+1}. ${JSON.stringify(x.q)} | ${fmt(o)}`);}
 if(!rank.length)console.log('NO DEV CANDIDATE PASSED. Do not promote to live.');
})().catch(e=>{console.error(e);process.exit(1)});
