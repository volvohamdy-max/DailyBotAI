#!/usr/bin/env node
'use strict';

const { getHistoricalRates } = require('dukascopy-node');
const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';
const CACHE = './data/dukascopy-cache';
const TP = 5, SL = 5;

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);let a=null;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));if(i===p){let s=0;for(let j=1;j<=p;j++)s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));a=s/p;o[i]=a}else if(i>p){a=(a*(p-1)+tr)/p;o[i]=a}}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let g=0,l=0;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],up=Math.max(d,0),dn=Math.max(-d,0);if(i<=p){g+=up;l+=dn;if(i===p){g/=p;l/=p;o[i]=l===0?100:100-100/(1+g/l)}}else{g=(g*(p-1)+up)/p;l=(l*(p-1)+dn)/p;o[i]=l===0?100:100-100/(1+g/l)}}return o}
function stats(t){let eq=0,peak=0,dd=0,w=0,g=0,l=0,ls=0,maxls=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(x.r>0){w++;g+=x.r;ls=0}else{l-=x.r;ls++;maxls=Math.max(maxls,ls)}}return{n:t.length,wr:t.length?100*w/t.length:0,net:eq,pf:l?g/l:(g?999:0),dd,ls:maxls}}
function fmt(s){return `${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`}
function yearStats(t){const m={};for(const x of t){const y=new Date(x.time).getUTCFullYear();(m[y]??=[]).push(x)}return Object.entries(m).map(([y,a])=>`${y}: ${fmt(stats(a))}`).join('\n')}
function outcome(c,i,side,maxBars){const entry=c[i+1].open,tp=side==='BUY'?entry+TP:entry-TP,sl=side==='BUY'?entry-SL:entry+SL;for(let j=i+1;j<=Math.min(c.length-1,i+maxBars);j++){const hitSL=side==='BUY'?c[j].low<=sl:c[j].high>=sl,hitTP=side==='BUY'?c[j].high>=tp:c[j].low<=tp;if(hitSL||hitTP)return {r:hitSL?-1:1,bars:j-i,entry}}return null}

(async()=>{
 console.log('🔬 GOLD 5×5 RECURRING PATTERN DISCOVERY V2');
 console.log(`📅 ${FROM} → ${TO} | fixed TP $${TP} / SL $${SL} | BUY+SELL | research only`);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',priceType:'bid',volumes:true,useCache:true,cacheFolderPath:CACHE});
 const c=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).sort((a,b)=>a.timestamp-b.timestamp);
 const cl=c.map(x=>x.close),e9=ema(cl,9),e20=ema(cl,20),e50=ema(cl,50),A=atr(c),R=rsi(cl);
 console.log(`✅ M5 candles: ${c.length}`);
 const configs=[];
 const sessions=[[0,24],[6,10],[7,12],[8,13],[9,13],[9,15],[10,15],[12,17],[13,18]];
 const patterns=['MOMENTUM','PULLBACK','SWEEP','BREAKOUT','REVERSAL2','CONTINUATION2'];
 const maxBarsList=[2,3,4,6];
 for(const pattern of patterns)for(const sess of sessions)for(const atrMin of [1,1.5,2,2.5,3])for(const body of [.35,.45,.55,.65])for(const trend of ['NONE','EMA20','EMA9_20'])for(const maxBars of maxBarsList){
   const T=[];
   for(let i=60;i<c.length-maxBars-2;i++){
     if(![A[i],R[i],e9[i],e20[i],e50[i]].every(Number.isFinite)||A[i]<atrMin)continue;
     const h=new Date(c[i].timestamp).getUTCHours(); if(sess[1]!==24&&(h<sess[0]||h>=sess[1]))continue;
     const b=c[i],prev=c[i-1],range=b.high-b.low;if(!(range>0))continue;
     const br=Math.abs(b.close-b.open)/range;if(br<body)continue;
     let side=null;
     const upTrend=trend==='NONE'||(trend==='EMA20'?b.close>e20[i]:(e9[i]>e20[i]&&e20[i]>e50[i]));
     const dnTrend=trend==='NONE'||(trend==='EMA20'?b.close<e20[i]:(e9[i]<e20[i]&&e20[i]<e50[i]));
     if(pattern==='MOMENTUM'){if(b.close>b.open&&upTrend)side='BUY';if(b.close<b.open&&dnTrend)side='SELL'}
     if(pattern==='PULLBACK'){if(upTrend&&b.low<=e20[i]&&b.close>e20[i]&&b.close>b.open)side='BUY';if(dnTrend&&b.high>=e20[i]&&b.close<e20[i]&&b.close<b.open)side='SELL'}
     if(pattern==='SWEEP'){let hi=-Infinity,lo=Infinity;for(let k=i-5;k<i;k++){hi=Math.max(hi,c[k].high);lo=Math.min(lo,c[k].low)}if(b.low<lo&&b.close>lo&&b.close>b.open&&upTrend)side='BUY';if(b.high>hi&&b.close<hi&&b.close<b.open&&dnTrend)side='SELL'}
     if(pattern==='BREAKOUT'){let hi=-Infinity,lo=Infinity;for(let k=i-6;k<i;k++){hi=Math.max(hi,c[k].high);lo=Math.min(lo,c[k].low)}if(b.close>hi&&upTrend)side='BUY';if(b.close<lo&&dnTrend)side='SELL'}
     if(pattern==='REVERSAL2'){if(prev.close<prev.open&&b.close>b.open&&b.close>prev.open&&upTrend)side='BUY';if(prev.close>prev.open&&b.close<b.open&&b.close<prev.open&&dnTrend)side='SELL'}
     if(pattern==='CONTINUATION2'){if(prev.close>prev.open&&b.close>b.open&&b.close>prev.close&&upTrend)side='BUY';if(prev.close<prev.open&&b.close<b.open&&b.close<prev.close&&dnTrend)side='SELL'}
     if(!side)continue;
     const o=outcome(c,i,side,maxBars);if(!o)continue;
     T.push({time:c[i+1].timestamp,side,r:o.r,bars:o.bars});i+=Math.max(0,o.bars-1);
   }
   if(T.length<40)continue;
   const cut=Math.floor(T.length*.7),dev=stats(T.slice(0,cut)),oos=stats(T.slice(cut)),all=stats(T);
   const years=Object.values(T.reduce((m,x)=>{const y=new Date(x.time).getUTCFullYear();(m[y]??=[]).push(x);return m},{})).map(stats);
   const positiveYears=years.filter(x=>x.net>0).length;
   const pass=all.n>=80&&dev.net>0&&oos.net>0&&dev.pf>=1.1&&oos.pf>=1.1&&positiveYears>=Math.max(2,years.length-1)&&all.dd<=15;
   const score=Math.min(dev.pf,3)*15+Math.min(oos.pf,3)*20+all.net-all.dd*2+positiveYears*3;
   configs.push({pattern,sess,atrMin,body,trend,maxBars,T,all,dev,oos,positiveYears,years:years.length,pass,score});
 }
 configs.sort((a,b)=>b.score-a.score);
 console.log(`🔬 Tested ${configs.length} viable configurations`);
 console.log('\n🏆 TOP 25');
 for(const x of configs.slice(0,25)){
   console.log(`\n${x.pattern} | UTC ${x.sess[0]}-${x.sess[1]} | ATR>=${x.atrMin} | body>=${x.body} | trend=${x.trend} | max=${x.maxBars*5}m | ${x.pass?'PASS':'FAIL'}`);
   console.log('ALL '+fmt(x.all));console.log('DEV '+fmt(x.dev));console.log('OOS '+fmt(x.oos));
   console.log('BUY '+fmt(stats(x.T.filter(t=>t.side==='BUY'))));console.log('SELL '+fmt(stats(x.T.filter(t=>t.side==='SELL'))));
   console.log(yearStats(x.T));
 }
 const pass=configs.filter(x=>x.pass);
 console.log(`\n✅ ROBUSTNESS PASS: ${pass.length}/${configs.length}`);
 if(pass.length){const x=pass[0];console.log('\n🥇 BEST ROBUST CANDIDATE');console.log(`${x.pattern} | UTC ${x.sess[0]}-${x.sess[1]} | ATR>=${x.atrMin} | body>=${x.body} | trend=${x.trend} | max=${x.maxBars*5}m`);console.log('ALL '+fmt(x.all));console.log('DEV '+fmt(x.dev));console.log('OOS '+fmt(x.oos));console.log(yearStats(x.T));}
 console.log('\n📌 Same-bar TP+SL is counted as SL (conservative). Trades with neither TP nor SL inside max holding time are excluded. Spread/slippage excluded at discovery stage.');
})().catch(e=>{console.error(e);process.exit(1)});
