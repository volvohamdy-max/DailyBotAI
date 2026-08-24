const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';
const MC_RUNS = Number(process.argv[4] || 10000);

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

// EXACT stress-test LOOSE_REGIME variant:
// only these six regime parameters differ from BASE.
const P = {
  adxMax:17,
  atrLo:0.68,
  atrHi:1.12,
  emaSlopeMax:0.38,
  widthMin:2.4,
  widthMax:5.8,
  // BASE rejection/exit parameters intentionally unchanged:
  edgeAtr:0.28,
  edgeWidth:0.075,
  wickMin:0.35,
  bodyMax:0.58,
  rsiEdge:42,
  slMinAtr:0.90,
  slCapAtr:1.45,
  stopPadAtr:0.22,
  minRR:0.90,
  maxRR:1.35,
  maxBars:18
};

function runLooseRegime(m5){
  const out=[];
  const closes=m5.map(x=>x.close);
  const E20=ema(closes,20),R=rsi(closes,14),A=atr(m5,14),D=adx(m5,14);
  let busy=-1;
  for(let i=100;i<m5.length-2;i++){
    if(i<=busy)continue;
    if(![E20[i],E20[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0))continue;
    if(D[i]>P.adxMax)continue;
    const as=A.slice(i-50,i).filter(Number.isFinite);if(as.length<45)continue;
    const am=as.reduce((a,b)=>a+b,0)/as.length,ar=A[i]/am;if(ar<P.atrLo||ar>P.atrHi)continue;
    if(Math.abs(E20[i]-E20[i-6])/A[i]>P.emaSlopeMax)continue;
    const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;
    if(width<A[i]*P.widthMin||width>A[i]*P.widthMax)continue;
    const edge=Math.max(A[i]*P.edgeAtr,width*P.edgeWidth);let lt=0,ht=0;
    for(const b of look){if(b.low<=lo+edge)lt++;if(b.high>=hi-edge)ht++;}
    if(lt<2||ht<2)continue;
    if(look.slice(-6).some(b=>b.close<lo-A[i]*.10||b.close>hi+A[i]*.10))continue;
    const c=m5[i],br=Math.max(1e-9,c.high-c.low),body=Math.abs(c.close-c.open)/br,lw=(Math.min(c.open,c.close)-c.low)/br,uw=(c.high-Math.max(c.open,c.close))/br,mid=(hi+lo)/2;
    let side=null;
    if(c.low<=lo+edge&&c.close>=lo+edge*.75&&lw>=P.wickMin&&body<=P.bodyMax&&R[i]<=P.rsiEdge)side='BUY';
    if(c.high>=hi-edge&&c.close<=hi-edge*.75&&uw>=P.wickMin&&body<=P.bodyMax&&R[i]>=100-P.rsiEdge)side='SELL';
    if(!side)continue;
    if(side==='BUY'&&(c.close<=lo||c.close>=mid))continue;
    if(side==='SELL'&&(c.close>=hi||c.close<=mid))continue;
    const en=m5[i+1].open;
    const structuralStop=side==='BUY'?Math.max(A[i]*P.slMinAtr,en-(lo-A[i]*P.stopPadAtr)):Math.max(A[i]*P.slMinAtr,(hi+A[i]*P.stopPadAtr)-en);
    const slDist=Math.min(structuralStop,A[i]*P.slCapAtr);if(!(slDist>0))continue;
    const midDistance=side==='BUY'?mid-en:en-mid;
    const targetDist=Math.min(midDistance,slDist*P.maxRR),rr=targetDist/slDist;
    if(!(rr>=P.minRR&&rr<=P.maxRR))continue;
    const sl=side==='BUY'?en-slDist:en+slDist,tp=side==='BUY'?en+targetDist:en-targetDist;
    for(let j=i+1;j<m5.length;j++){
      const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp:b.low<=tp;
      if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side,name:'GOLD_RANGE_LOOSE_REGIME'});busy=j;break}
      if(j-i>=P.maxBars){const mark=side==='BUY'?(b.close-en)/slDist:(en-b.close)/slDist;out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side,name:'GOLD_RANGE_LOOSE_REGIME'});busy=j;break}
    }
  }
  return out;
}

function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
function ddOfRs(rs){let eq=0,pk=0,dd=0,ls=0,maxLs=0;for(const r of rs){eq+=r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(r<=0){ls++;maxLs=Math.max(maxLs,ls)}else ls=0;}return{dd,maxLs};}
function percentile(sorted,p){if(!sorted.length)return 0;const i=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));return sorted[i];}
function monteCarlo(T,runs){const rs=T.map(x=>x.r),dds=[],lss=[];for(let k=0;k<runs;k++){const z=ddOfRs(shuffle(rs));dds.push(z.dd);lss.push(z.maxLs);}dds.sort((a,b)=>a-b);lss.sort((a,b)=>a-b);return{runs,dd50:percentile(dds,.50),dd90:percentile(dds,.90),dd95:percentile(dds,.95),dd99:percentile(dds,.99),ddMax:dds[dds.length-1]||0,ls50:percentile(lss,.50),ls90:percentile(lss,.90),ls95:percentile(lss,.95),ls99:percentile(lss,.99),lsMax:lss[lss.length-1]||0};}

(async()=>{
  console.log('🌊 GOLD RANGE MR — EXACT LOOSE_REGIME FINAL TEST');
  console.log('✅ Exact variant from V2 stress test; rejection/exit stay BASE');
  console.log(`📅 ${FROM} → ${TO} | Monte Carlo runs=${MC_RUNS}`);
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  console.log(`✅ M5 ${m5.length}`);
  const T=runLooseRegime(m5);
  const S=stats(T);
  console.log('\n📊 TOTAL\n'+fmt(S));
  console.log(`\n🔎 STRESS BASELINE CHECK | expected≈110 trades / +49.19R / PF≈2.20 | actual=${S.n} / ${S.net.toFixed(2)}R / PF=${S.pf.toFixed(2)}`);
  console.log('\n📅 YEARLY');const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
  console.log('\n📈 SIDE SPLIT');for(const side of ['BUY','SELL'])console.log(`${side} | ${fmt(stats(T.filter(x=>x.side===side)))}`);
  const mc=monteCarlo(T,MC_RUNS);
  console.log('\n🎲 MONTE CARLO — SEQUENCE SHUFFLE');
  console.log(`DD P50 ${mc.dd50.toFixed(2)}R | P90 ${mc.dd90.toFixed(2)}R | P95 ${mc.dd95.toFixed(2)}R | P99 ${mc.dd99.toFixed(2)}R | Worst ${mc.ddMax.toFixed(2)}R`);
  console.log(`LS P50 ${mc.ls50} | P90 ${mc.ls90} | P95 ${mc.ls95} | P99 ${mc.ls99} | Worst ${mc.lsMax}`);
})().catch(e=>{console.error(e);process.exit(1)});
