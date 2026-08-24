const { getHistoricalRates } = require('dukascopy-node');
const { CONFIG, emaSeries, rsiSeries, atrSeries, adxSeries } = require('../src/services/scalpStrategies/goldRangeMrStrategy');

const FROM=process.argv[2]||'2025-08-24';
const TO=process.argv[3]||'2026-08-24';

function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function run(m5){
 const out=[],closes=m5.map(x=>x.close),E20=emaSeries(closes,20),R=rsiSeries(closes,14),A=atrSeries(m5,14),D=adxSeries(m5,14);let busy=-1;
 for(let i=100;i<m5.length-2;i++){
  if(i<=busy)continue;
  if(![E20[i],E20[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0))continue;
  if(D[i]>CONFIG.adxMax)continue;
  const sample=A.slice(i-50,i).filter(Number.isFinite);if(sample.length<45)continue;const avg=sample.reduce((a,b)=>a+b,0)/sample.length,ratio=A[i]/avg;if(ratio<CONFIG.atrLo||ratio>CONFIG.atrHi)continue;
  const slope=Math.abs(E20[i]-E20[i-6])/A[i];if(slope>CONFIG.emaSlopeMax)continue;
  const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;if(width<A[i]*CONFIG.widthMin||width>A[i]*CONFIG.widthMax)continue;
  const edge=Math.max(A[i]*CONFIG.edgeAtr,width*CONFIG.edgeWidth);let lt=0,ht=0;for(const b of look){if(b.low<=lo+edge)lt++;if(b.high>=hi-edge)ht++;}if(lt<2||ht<2)continue;
  if(look.slice(-6).some(b=>b.close<lo-A[i]*.10||b.close>hi+A[i]*.10))continue;
  const c=m5[i],br=Math.max(1e-9,c.high-c.low),body=Math.abs(c.close-c.open)/br,lw=(Math.min(c.open,c.close)-c.low)/br,uw=(c.high-Math.max(c.open,c.close))/br,mid=(hi+lo)/2;let side=null;
  if(c.low<=lo+edge&&c.close>=lo+edge*.75&&lw>=CONFIG.wickMin&&body<=CONFIG.bodyMax&&R[i]<=CONFIG.rsiEdge)side='BUY';
  if(c.high>=hi-edge&&c.close<=hi-edge*.75&&uw>=CONFIG.wickMin&&body<=CONFIG.bodyMax&&R[i]>=100-CONFIG.rsiEdge)side='SELL';
  if(!side)continue;if(side==='BUY'&&(c.close<=lo||c.close>=mid))continue;if(side==='SELL'&&(c.close>=hi||c.close<=mid))continue;
  // Live obtains a fresh price after the closed signal bar. Historical next-bar open is the closest non-lookahead proxy.
  const entry=m5[i+1].open;
  const structuralStop=side==='BUY'?Math.max(A[i]*CONFIG.slMinAtr,entry-(lo-A[i]*CONFIG.stopPadAtr)):Math.max(A[i]*CONFIG.slMinAtr,(hi+A[i]*CONFIG.stopPadAtr)-entry),slDist=Math.min(structuralStop,A[i]*CONFIG.slCapAtr);if(!(slDist>0))continue;
  const midDistance=side==='BUY'?mid-entry:entry-mid,targetDist=Math.min(midDistance,slDist*CONFIG.maxRR),rr=targetDist/slDist;if(!(rr>=CONFIG.minRR&&rr<=CONFIG.maxRR))continue;
  const sl=side==='BUY'?entry-slDist:entry+slDist,tp=side==='BUY'?entry+targetDist:entry-targetDist;
  for(let j=i+1;j<m5.length;j++){
   const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp:b.low<=tp;
   // Conservative same-bar ambiguity: stop wins, matching the previous range backtest convention.
   if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side});busy=j;break}
   if(j-i>=CONFIG.maxBars){const mark=side==='BUY'?(b.close-entry)/slDist:(entry-b.close)/slDist;out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side});busy=j;break}
  }
 }
 return out;
}

(async()=>{
 console.log('🌊 GOLD RANGE MR V2 — EXACT CURRENT LIVE RULES');console.log(`📅 ${FROM} → ${TO}`);console.log('🔒 CONFIG imported directly from live strategy file');console.log(CONFIG);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
 const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);console.log(`✅ M5 ${m5.length}`);
 const T=run(m5);console.log('\n📊 TOTAL\n'+fmt(stats(T)));console.log('\n📈 SIDE SPLIT');for(const side of ['BUY','SELL'])console.log(`${side} | ${fmt(stats(T.filter(x=>x.side===side)))}`);
 console.log('\n📅 YEARLY');const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
 console.log('\n📆 MONTHLY');const mo={};for(const t of T){const d=new Date(t.time),k=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;(mo[k]??=[]).push(t)}for(const[k,v]of Object.entries(mo))console.log(`${k} | ${fmt(stats(v))}`);
 console.log('\n⚠️ Research only — live strategy and VIP routing untouched.');
})().catch(e=>{console.error(e);process.exit(1)});
