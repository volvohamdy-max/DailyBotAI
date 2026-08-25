#!/usr/bin/env node
'use strict';

const { getHistoricalRates } = require('dukascopy-node');
const FROM = process.argv[2] || '2025-08-24';
const TO = process.argv[3] || '2026-08-24';
const CACHE = './data/dukascopy-cache';

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function stats(t){let eq=0,peak=0,dd=0,g=0,l=0,w=0,ls=0,maxls=0,dur=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);dur+=x.bars;if(x.r>0){w++;g+=x.r;ls=0}else{l-=x.r;ls++;maxls=Math.max(maxls,ls)}}return{n:t.length,wr:t.length?w/t.length*100:0,net:eq,pf:l?g/l:(g?999:0),dd,ls:maxls,mins:t.length?dur/t.length*5:0}}
function F(s){return `${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls} | Avg ${s.mins.toFixed(1)}m`}
function failure(x){const r=[];if(x.all.n<50)r.push('TRADES<50');if(x.all.n>1200)r.push('TRADES>1200');if(x.dev.net<=0)r.push('DEV_NET<=0');if(x.oos.net<=0)r.push('OOS_NET<=0');if(x.dev.pf<1.05)r.push('DEV_PF<1.05');if(x.oos.pf<1.05)r.push('OOS_PF<1.05');if(x.all.dd>20)r.push('DD>20R');return r.length?r.join(','):'PASS'}

(async()=>{
 console.log('⚡ GOLD MICRO SCALPER V2 — SWEEP / REJECTION RESEARCH');
 console.log(`📅 ${FROM} → ${TO}`);
 console.log('🔒 Research only. Current live strategies + VIP untouched.');
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',priceType:'bid',volumes:true,useCache:true,cacheFolderPath:CACHE});
 const c=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).sort((a,b)=>a.timestamp-b.timestamp);
 const cl=c.map(x=>x.close),E50=ema(cl,50),E200=ema(cl,200),A=atr(c,14);
 console.log(`✅ M5 ${c.length}`);
 const configs=[];
 for(const lookback of [3,5,8,12]) for(const wickMin of [.45,.55,.65]) for(const bodyMax of [.55,.70]) for(const atrMin of [.7,1.0]) for(const tp of [2,3,4,5]) for(const sl of [3,4,5,6]) for(const maxBars of [2,3,4]) configs.push({lookback,wickMin,bodyMax,atrMin,tp,sl,maxBars});
 const results=[];
 for(const q of configs){
   const T=[];
   for(let i=220;i<c.length-q.maxBars-2;i++){
     if(![E50[i],E200[i],A[i]].every(Number.isFinite)||A[i]<q.atrMin)continue;
     const d=new Date(c[i].timestamp),hr=d.getUTCHours();
     // Liquid London/NY window; avoid dead overnight hours.
     if(hr<6||hr>18)continue;
     const bar=c[i],range=bar.high-bar.low;if(!(range>0))continue;
     const body=Math.abs(bar.close-bar.open)/range;if(body>q.bodyMax)continue;
     let priorLow=Infinity,priorHigh=-Infinity;
     for(let k=i-q.lookback;k<i;k++){priorLow=Math.min(priorLow,c[k].low);priorHigh=Math.max(priorHigh,c[k].high)}
     const lowerWick=(Math.min(bar.open,bar.close)-bar.low)/range;
     const upperWick=(bar.high-Math.max(bar.open,bar.close))/range;
     const upTrend=E50[i]>E200[i]&&E50[i]>E50[i-3];
     const dnTrend=E50[i]<E200[i]&&E50[i]<E50[i-3];
     let side=null;
     // Sweep prior liquidity, close back inside range, reject in prevailing regime.
     if(upTrend&&bar.low<priorLow&&bar.close>priorLow&&lowerWick>=q.wickMin&&bar.close>bar.open)side='BUY';
     else if(dnTrend&&bar.high>priorHigh&&bar.close<priorHigh&&upperWick>=q.wickMin&&bar.close<bar.open)side='SELL';
     if(!side)continue;
     const entry=c[i+1].open,stop=side==='BUY'?entry-q.sl:entry+q.sl,target=side==='BUY'?entry+q.tp:entry-q.tp;
     let exit=c[i+q.maxBars].close,bars=q.maxBars;
     for(let j=i+1;j<=i+q.maxBars;j++){
       const hitSL=side==='BUY'?c[j].low<=stop:c[j].high>=stop;
       const hitTP=side==='BUY'?c[j].high>=target:c[j].low<=target;
       if(hitSL||hitTP){exit=hitSL?stop:target;bars=j-i;break}
     }
     const r=side==='BUY'?(exit-entry)/q.sl:(entry-exit)/q.sl;
     T.push({r,side,bars,time:c[i+1].timestamp});
     i+=bars-1;
   }
   const cut=Math.floor(T.length*.7),all=stats(T),dev=stats(T.slice(0,cut)),oos=stats(T.slice(cut));
   const buy=stats(T.filter(x=>x.side==='BUY')),sell=stats(T.filter(x=>x.side==='SELL'));
   const x={...q,all,dev,oos,buy,sell};x.reason=failure(x);
   x.score=(Math.min(dev.pf,3)+Math.min(oos.pf,3))*15+all.net-all.dd*2-Math.abs(dev.pf-oos.pf)*5;
   results.push(x);
 }
 results.sort((a,b)=>b.score-a.score);
 console.log(`🔬 Tested ${results.length} configurations`);
 console.log('\n🏆 TOP 15');
 for(const x of results.slice(0,15)){
   console.log(`\nLB ${x.lookback} | wick>=${x.wickMin} | body<=${x.bodyMax} | ATR>=${x.atrMin} | TP $${x.tp} | SL $${x.sl} | MAX ${x.maxBars*5}m | ${x.reason}`);
   console.log('ALL  '+F(x.all));console.log('DEV  '+F(x.dev));console.log('OOS  '+F(x.oos));console.log('BUY  '+F(x.buy));console.log('SELL '+F(x.sell));
 }
 const pass=results.filter(x=>x.reason==='PASS');
 console.log(`\n✅ ROBUSTNESS PASS: ${pass.length}/${results.length}`);
 if(pass.length){console.log('\n🥇 BEST PASSING CONFIGS');for(const x of pass.slice(0,10))console.log(`LB ${x.lookback} | wick ${x.wickMin} | body ${x.bodyMax} | ATR ${x.atrMin} | TP $${x.tp} | SL $${x.sl} | MAX ${x.maxBars*5}m | ${F(x.all)} | DEV PF ${x.dev.pf.toFixed(2)} | OOS PF ${x.oos.pf.toFixed(2)}`)}
 console.log('\n📌 Model: prior-liquidity sweep + rejection wick + EMA50/200 regime + ATR + London/NY hours. Same-bar conflict resolves SL first. Spread/slippage excluded at this discovery stage.');
})().catch(e=>{console.error(e);process.exit(1)});
