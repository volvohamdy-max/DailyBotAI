const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';
const OOS_START = Date.parse(process.argv[4] || '2025-01-01T00:00:00Z');

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++)if(T||i>p){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R`;

const BASE={adxMax:16,atrLo:.72,atrHi:1.08,emaSlopeMax:.32,widthMin:2.6,widthMax:5.4,edgeAtr:.28,edgeWidth:.075,wickMin:.35,bodyMax:.58,rsiEdge:42,slMinAtr:.90,slCapAtr:1.45,stopPadAtr:.22,minRR:.90,maxRR:1.35,maxBars:18};

function run(m5,I,p){
 const out=[];let busy=-1;
 for(let i=100;i<m5.length-2;i++){
  if(i<=busy)continue;
  const {E20,R,A,D}=I;if(![E20[i],E20[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0))continue;
  if(D[i]>p.adxMax)continue;
  const as=A.slice(i-50,i).filter(Number.isFinite);if(as.length<45)continue;const am=as.reduce((a,b)=>a+b,0)/as.length,ar=A[i]/am;if(ar<p.atrLo||ar>p.atrHi)continue;
  if(Math.abs(E20[i]-E20[i-6])/A[i]>p.emaSlopeMax)continue;
  const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;if(width<A[i]*p.widthMin||width>A[i]*p.widthMax)continue;
  const edge=Math.max(A[i]*p.edgeAtr,width*p.edgeWidth);let lt=0,ht=0;for(const b of look){if(b.low<=lo+edge)lt++;if(b.high>=hi-edge)ht++;}if(lt<2||ht<2)continue;
  if(look.slice(-6).some(b=>b.close<lo-A[i]*.10||b.close>hi+A[i]*.10))continue;
  const c=m5[i],br=Math.max(1e-9,c.high-c.low),body=Math.abs(c.close-c.open)/br,lw=(Math.min(c.open,c.close)-c.low)/br,uw=(c.high-Math.max(c.open,c.close))/br,mid=(hi+lo)/2;
  let side=null;if(c.low<=lo+edge&&c.close>=lo+edge*.75&&lw>=p.wickMin&&body<=p.bodyMax&&R[i]<=p.rsiEdge)side='BUY';if(c.high>=hi-edge&&c.close<=hi-edge*.75&&uw>=p.wickMin&&body<=p.bodyMax&&R[i]>=100-p.rsiEdge)side='SELL';if(!side)continue;
  if(side==='BUY'&&(c.close<=lo||c.close>=mid))continue;if(side==='SELL'&&(c.close>=hi||c.close<=mid))continue;
  const en=m5[i+1].open,struct=side==='BUY'?Math.max(A[i]*p.slMinAtr,en-(lo-A[i]*p.stopPadAtr)):Math.max(A[i]*p.slMinAtr,(hi+A[i]*p.stopPadAtr)-en),slDist=Math.min(struct,A[i]*p.slCapAtr);if(!(slDist>0))continue;
  const md=side==='BUY'?mid-en:en-mid,target=Math.min(md,slDist*p.maxRR),rr=target/slDist;if(!(rr>=p.minRR&&rr<=p.maxRR))continue;
  const sl=side==='BUY'?en-slDist:en+slDist,tp=side==='BUY'?en+target:en-target;
  for(let j=i+1;j<m5.length;j++){const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp:b.low<=tp;if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side});busy=j;break}if(j-i>=p.maxBars){const mark=side==='BUY'?(b.close-en)/slDist:(en-b.close)/slDist;out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side});busy=j;break}}
 }
 return out;
}
function v(name,patch){return{name,p:{...BASE,...patch}}}
const variants=[v('BASE',{}),
 v('ADX15',{adxMax:15}),v('ADX17',{adxMax:17}),v('ATR_LO_068',{atrLo:.68}),v('ATR_LO_076',{atrLo:.76}),v('ATR_HI_104',{atrHi:1.04}),v('ATR_HI_112',{atrHi:1.12}),
 v('SLOPE026',{emaSlopeMax:.26}),v('SLOPE038',{emaSlopeMax:.38}),v('WIDTH_MIN24',{widthMin:2.4}),v('WIDTH_MIN28',{widthMin:2.8}),v('WIDTH_MAX50',{widthMax:5.0}),v('WIDTH_MAX58',{widthMax:5.8}),
 v('WICK032',{wickMin:.32}),v('WICK038',{wickMin:.38}),v('BODY054',{bodyMax:.54}),v('BODY062',{bodyMax:.62}),v('RSI40',{rsiEdge:40}),v('RSI44',{rsiEdge:44}),
 v('SLMIN085',{slMinAtr:.85}),v('SLMIN095',{slMinAtr:.95}),v('SLCAP135',{slCapAtr:1.35}),v('SLCAP155',{slCapAtr:1.55}),v('MINRR080',{minRR:.80}),v('MINRR100',{minRR:1.00}),v('MAXRR120',{maxRR:1.20}),v('MAXRR150',{maxRR:1.50}),v('TIME75M',{maxBars:15}),v('TIME105M',{maxBars:21}),
 // grouped neighborhood combinations: regime / rejection / exits
 v('LOOSE_ALL',{adxMax:17,atrLo:.68,atrHi:1.12,emaSlopeMax:.38,widthMin:2.4,widthMax:5.8,wickMin:.32,bodyMax:.62,rsiEdge:44,minRR:.80,maxRR:1.50,maxBars:21}),
 v('TIGHT_ALL',{adxMax:15,atrLo:.76,atrHi:1.04,emaSlopeMax:.26,widthMin:2.8,widthMax:5.0,wickMin:.38,bodyMax:.54,rsiEdge:40,minRR:1.00,maxRR:1.20,maxBars:15}),
 v('LOOSE_REGIME',{adxMax:17,atrLo:.68,atrHi:1.12,emaSlopeMax:.38,widthMin:2.4,widthMax:5.8}),
 v('TIGHT_REGIME',{adxMax:15,atrLo:.76,atrHi:1.04,emaSlopeMax:.26,widthMin:2.8,widthMax:5.0}),
 v('LOOSE_REJECT',{wickMin:.32,bodyMax:.62,rsiEdge:44}),v('TIGHT_REJECT',{wickMin:.38,bodyMax:.54,rsiEdge:40}),
 v('LOOSE_EXIT',{slMinAtr:.85,slCapAtr:1.55,minRR:.80,maxRR:1.50,maxBars:21}),v('TIGHT_EXIT',{slMinAtr:.95,slCapAtr:1.35,minRR:1.00,maxRR:1.20,maxBars:15})];

(async()=>{
 console.log('🧪 GOLD RANGE MR V2 — ROBUSTNESS STRESS TEST');console.log(`📅 ${FROM} → ${TO} | OOS starts ${new Date(OOS_START).toISOString().slice(0,10)}`);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
 const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);console.log(`✅ M5 ${m5.length} | variants=${variants.length}`);
 const closes=m5.map(x=>x.close),I={E20:ema(closes,20),R:rsi(closes,14),A:atr(m5,14),D:adx(m5,14)};
 const rows=[];for(const x of variants){const T=run(m5,I,x.p),dev=T.filter(t=>t.time<OOS_START),oos=T.filter(t=>t.time>=OOS_START),S=stats(T),DS=stats(dev),OS=stats(oos);rows.push({name:x.name,S,DS,OS});console.log(`${x.name.padEnd(13)} | ALL ${fmt(S)} | DEV ${fmt(DS)} | OOS ${fmt(OS)}`)}
 const profitable=rows.filter(x=>x.S.net>0).length,pf15=rows.filter(x=>x.S.pf>=1.5).length,oosPos=rows.filter(x=>x.OS.net>0&&x.OS.n>=8).length,both=rows.filter(x=>x.DS.net>0&&x.OS.net>0&&x.S.pf>=1.3).length;
 console.log('\n📊 ROBUSTNESS SUMMARY');console.log(`Profitable ALL: ${profitable}/${rows.length} (${(100*profitable/rows.length).toFixed(1)}%)`);console.log(`PF >= 1.50 ALL: ${pf15}/${rows.length} (${(100*pf15/rows.length).toFixed(1)}%)`);console.log(`Positive OOS (>=8 trades): ${oosPos}/${rows.length} (${(100*oosPos/rows.length).toFixed(1)}%)`);console.log(`DEV+OOS positive and PF>=1.30: ${both}/${rows.length} (${(100*both/rows.length).toFixed(1)}%)`);
 const ranked=[...rows].sort((a,b)=>(b.OS.net-b.OS.dd)-(a.OS.net-a.OS.dd));console.log('\n🏆 TOP 8 BY OOS Net-DD');for(const x of ranked.slice(0,8))console.log(`${x.name.padEnd(13)} | ALL ${fmt(x.S)} | OOS ${fmt(x.OS)}`);console.log('\n⚠️ BOTTOM 8 BY OOS Net-DD');for(const x of ranked.slice(-8))console.log(`${x.name.padEnd(13)} | ALL ${fmt(x.S)} | OOS ${fmt(x.OS)}`);
})().catch(e=>{console.error(e);process.exit(1)});
