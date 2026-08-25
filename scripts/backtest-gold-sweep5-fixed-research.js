#!/usr/bin/env node
'use strict';

const { getHistoricalRates } = require('dukascopy-node');
const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';
const CACHE = './data/dukascopy-cache';
const TP = 5, SL = 5;

function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function stats(t){let eq=0,peak=0,dd=0,g=0,l=0,w=0,ls=0,maxls=0,dur=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);dur+=x.bars;if(x.r>0){w++;g+=x.r;ls=0}else{l-=x.r;ls++;maxls=Math.max(maxls,ls)}}return{n:t.length,wr:t.length?w/t.length*100:0,net:eq,pf:l?g/l:(g?999:0),dd,ls:maxls,mins:t.length?dur/t.length*5:0}}
function F(s){return `${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls} | Avg ${s.mins.toFixed(1)}m`}
function yearly(t){const m={};for(const x of t){const y=new Date(x.time).getUTCFullYear();(m[y]??=[]).push(x)}return Object.entries(m).map(([y,a])=>`${y} | ${F(stats(a))}`).join('\n')}
function outcome(c,i,side,maxBars){const entry=c[i+1].open,tp=side==='BUY'?entry+TP:entry-TP,sl=side==='BUY'?entry-SL:entry+SL;for(let j=i+1;j<=Math.min(c.length-1,i+maxBars);j++){const hs=side==='BUY'?c[j].low<=sl:c[j].high>=sl,ht=side==='BUY'?c[j].high>=tp:c[j].low<=tp;if(hs||ht)return {r:hs?-1:1,bars:j-i}}return null}

(async()=>{
 console.log('🌊 GOLD SWEEP 5 — FIXED $5/$5 RESEARCH');
 console.log(`📅 ${FROM} → ${TO} | M5 | BUY+SELL | research only`);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',priceType:'bid',volumes:true,useCache:true,cacheFolderPath:CACHE});
 const c=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).sort((a,b)=>a.timestamp-b.timestamp),A=atr(c);
 console.log(`✅ M5 ${c.length}`);
 const results=[];
 for(const lb of [3,5,8,12]) for(const sweepAtr of [0,.03,.06,.10,.15]) for(const wick of [.35,.45,.55,.65]) for(const bodyMax of [.35,.45,.55,.65]) for(const atrMin of [.7,1,1.5,2]) for(const session of [[6,15],[7,15],[8,15],[9,13],[9,15],[10,15],[12,16]]) for(const maxBars of [2,3,4,6]){
  const T=[];
  for(let i=30;i<c.length-maxBars-2;i++){
   if(!Number.isFinite(A[i])||A[i]<atrMin)continue;
   const h=new Date(c[i].timestamp).getUTCHours();if(h<session[0]||h>=session[1])continue;
   const b=c[i],range=b.high-b.low;if(!(range>0))continue;
   const body=Math.abs(b.close-b.open)/range;if(body>bodyMax)continue;
   let hi=-Infinity,lo=Infinity;for(let k=i-lb;k<i;k++){hi=Math.max(hi,c[k].high);lo=Math.min(lo,c[k].low)}
   const lw=(Math.min(b.open,b.close)-b.low)/range,uw=(b.high-Math.max(b.open,b.close))/range,minSweep=A[i]*sweepAtr;
   let side=null;
   if(b.low<=lo-minSweep&&b.close>lo&&b.close>b.open&&lw>=wick)side='BUY';
   else if(b.high>=hi+minSweep&&b.close<hi&&b.close<b.open&&uw>=wick)side='SELL';
   if(!side)continue;
   const o=outcome(c,i,side,maxBars);if(!o)continue;
   T.push({time:c[i+1].timestamp,side,r:o.r,bars:o.bars});i+=Math.max(0,o.bars-1);
  }
  if(T.length<40)continue;
  const cut=Math.floor(T.length*.7),all=stats(T),dev=stats(T.slice(0,cut)),oos=stats(T.slice(cut));
  const ys=Object.values(T.reduce((m,x)=>{const y=new Date(x.time).getUTCFullYear();(m[y]??=[]).push(x);return m},{})).map(stats),pos=ys.filter(s=>s.net>0).length;
  const pass=all.n>=70&&dev.net>0&&oos.net>0&&dev.pf>=1.08&&oos.pf>=1.08&&all.pf>=1.12&&all.dd<=15&&pos>=Math.max(2,ys.length-1);
  const score=Math.min(dev.pf,3)*15+Math.min(oos.pf,3)*20+all.net-all.dd*2+pos*4;
  results.push({lb,sweepAtr,wick,bodyMax,atrMin,session,maxBars,T,all,dev,oos,pos,years:ys.length,pass,score});
 }
 results.sort((a,b)=>b.score-a.score);
 console.log(`🔬 Viable configs ${results.length}`);
 console.log('\n🏆 TOP 20');
 for(const x of results.slice(0,20)){console.log(`\nLB${x.lb} | sweep>=${x.sweepAtr}ATR | wick>=${x.wick} | body<=${x.bodyMax} | ATR>=${x.atrMin} | UTC ${x.session[0]}-${x.session[1]} | max ${x.maxBars*5}m | ${x.pass?'PASS':'FAIL'}`);console.log('ALL  '+F(x.all));console.log('DEV  '+F(x.dev));console.log('OOS  '+F(x.oos));console.log('BUY  '+F(stats(x.T.filter(t=>t.side==='BUY'))));console.log('SELL '+F(stats(x.T.filter(t=>t.side==='SELL'))));console.log(yearly(x.T))}
 const p=results.filter(x=>x.pass);console.log(`\n✅ ROBUSTNESS PASS: ${p.length}/${results.length}`);
 if(p.length){const x=p[0];console.log('\n🥇 BEST GOLD SWEEP 5');console.log(`LB${x.lb} | sweep>=${x.sweepAtr}ATR | wick>=${x.wick} | body<=${x.bodyMax} | ATR>=${x.atrMin} | UTC ${x.session[0]}-${x.session[1]} | max ${x.maxBars*5}m`);console.log('ALL '+F(x.all));console.log('DEV '+F(x.dev));console.log('OOS '+F(x.oos));console.log(yearly(x.T))}
 console.log('\n📌 Fixed TP=$5 / SL=$5. Entry next M5 open after sweep+reclaim. Same-bar TP+SL => SL. No AI/score/ADX/RSI filters. No live/VIP changes.');
})().catch(e=>{console.error(e);process.exit(1)});
