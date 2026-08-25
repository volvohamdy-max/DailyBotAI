#!/usr/bin/env node
'use strict';
const {getHistoricalRates}=require('dukascopy-node');
const FROM=process.argv[2]||'2025-08-24',TO=process.argv[3]||'2026-08-24',CACHE='./data/dukascopy-cache';
function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){let pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function stats(t){let eq=0,peak=0,dd=0,g=0,l=0,w=0,ls=0,ml=0,dur=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);dur+=x.bars;if(x.r>0){w++;g+=x.r;ls=0}else{l-=x.r;ls++;ml=Math.max(ml,ls)}}return{n:t.length,wr:t.length?w/t.length*100:0,net:eq,pf:l?g/l:(g?999:0),dd,ls:ml,mins:t.length?dur/t.length*5:0}}
function F(s){return `${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls} | Avg ${s.mins.toFixed(1)}m`}
function fail(x){const r=[];if(x.all.n<50)r.push('TRADES<50');if(x.dev.net<=0)r.push('DEV_NET<=0');if(x.oos.net<=0)r.push('OOS_NET<=0');if(x.dev.pf<1.10)r.push('DEV_PF<1.10');if(x.oos.pf<1.10)r.push('OOS_PF<1.10');if(x.all.dd>15)r.push('DD>15R');return r.length?r.join(','):'PASS'}
(async()=>{
 console.log('⚡ GOLD MICRO SCALPER V3 — BUY-ONLY FOCUSED RESEARCH');console.log(`📅 ${FROM} → ${TO}`);console.log('🔒 Research only. Live/VIP untouched.');
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',priceType:'bid',volumes:true,useCache:true,cacheFolderPath:CACHE});
 const c=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).sort((a,b)=>a.timestamp-b.timestamp),cl=c.map(x=>x.close),E50=ema(cl,50),E200=ema(cl,200),A=atr(c);console.log(`✅ M5 ${c.length}`);
 const out=[];
 for(const startHr of [6,7,8,9,10,11])for(const endHr of [13,14,15,16,17,18]){if(endHr-startHr<4)continue;for(const slopeBars of [2,3,5,8])for(const sepMin of [0,.05,.10,.20])for(const depthAtr of [0,.03,.06,.10])for(const atrMaxRatio of [1.2,1.5,2.0]){
  let T=[];
  for(let i=220;i<c.length-5;i++){
   if(![E50[i],E200[i],A[i]].every(Number.isFinite)||A[i]<1)continue;const hr=new Date(c[i].timestamp).getUTCHours();if(hr<startHr||hr>endHr)continue;
   const sep=Math.abs(E50[i]-E200[i])/A[i];if(E50[i]<=E200[i]||E50[i]<=E50[i-slopeBars]||sep<sepMin)continue;
   let av=0;for(let k=i-20;k<i;k++)av+=A[k];av/=20;if(!Number.isFinite(av)||av<=0||A[i]/av>atrMaxRatio)continue;
   const b=c[i],range=b.high-b.low;if(!(range>0))continue;let lo=Infinity;for(let k=i-5;k<i;k++)lo=Math.min(lo,c[k].low);
   const wick=(Math.min(b.open,b.close)-b.low)/range,depth=(lo-b.low)/A[i];if(!(b.low<lo&&b.close>lo&&b.close>b.open&&wick>=.55&&Math.abs(b.close-b.open)/range<=.55&&depth>=depthAtr))continue;
   const entry=c[i+1].open,sl=entry-3,tp=entry+5,maxBars=3;let exit=c[i+maxBars].close,bars=maxBars;
   for(let j=i+1;j<=i+maxBars;j++){const hs=c[j].low<=sl,ht=c[j].high>=tp;if(hs||ht){exit=hs?sl:tp;bars=j-i;break}}
   T.push({time:c[i+1].timestamp,r:(exit-entry)/3,bars});i+=bars-1;
  }
  const cut=Math.floor(T.length*.7),x={startHr,endHr,slopeBars,sepMin,depthAtr,atrMaxRatio,all:stats(T),dev:stats(T.slice(0,cut)),oos:stats(T.slice(cut))};x.reason=fail(x);x.score=Math.min(x.dev.pf,3)*15+Math.min(x.oos.pf,3)*15+x.all.net-x.all.dd*2-Math.abs(x.dev.pf-x.oos.pf)*8;out.push(x);
 }}
 out.sort((a,b)=>b.score-a.score);console.log(`🔬 Tested ${out.length} focused configurations`);console.log('\n🏆 TOP 20');for(const x of out.slice(0,20)){console.log(`\nUTC ${x.startHr}-${x.endHr} | slope ${x.slopeBars} | sep>=${x.sepMin}ATR | depth>=${x.depthAtr}ATR | ATRratio<=${x.atrMaxRatio} | ${x.reason}`);console.log('ALL '+F(x.all));console.log('DEV '+F(x.dev));console.log('OOS '+F(x.oos))}
 const pass=out.filter(x=>x.reason==='PASS');console.log(`\n✅ ROBUSTNESS PASS: ${pass.length}/${out.length}`);if(pass.length){console.log('\n🥇 PASSING CONFIGS');for(const x of pass.slice(0,15))console.log(`UTC ${x.startHr}-${x.endHr} | slope ${x.slopeBars} | sep ${x.sepMin} | depth ${x.depthAtr} | ATRratio ${x.atrMaxRatio} | ${F(x.all)} | DEV PF ${x.dev.pf.toFixed(2)} | OOS PF ${x.oos.pf.toFixed(2)}`)}
 console.log('\n📌 Fixed core from V2 BUY clue: LB5, wick>=0.55, body<=0.55, ATR>=1, TP=$5, SL=$3, max=15m. V3 tests session/trend separation/sweep depth/ATR regime only.');
})().catch(e=>{console.error(e);process.exit(1)});
