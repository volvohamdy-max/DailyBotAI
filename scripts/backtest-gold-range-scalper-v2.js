const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function runRangeV2(m5){
  const out=[];
  const closes=m5.map(x=>x.close);
  const E20=ema(closes,20),R=rsi(closes,14),A=atr(m5,14),D=adx(m5,14);
  let busy=-1;

  for(let i=100;i<m5.length-2;i++){
    if(i<=busy) continue;
    if(![E20[i],E20[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0)) continue;

    // Quiet regime only: weak ADX, normal ATR, almost-flat EMA20.
    if(D[i] > 16) continue;
    const atrSample=A.slice(i-50,i).filter(Number.isFinite);
    if(atrSample.length<45) continue;
    const atrMean=atrSample.reduce((a,b)=>a+b,0)/atrSample.length;
    const atrRatio=A[i]/atrMean;
    if(atrRatio < 0.72 || atrRatio > 1.08) continue;
    const emaSlope=Math.abs(E20[i]-E20[i-6])/A[i];
    if(emaSlope>0.32) continue;

    // Build the range from PRIOR candles only; current candle must reject an established edge.
    const look=m5.slice(i-30,i);
    const hi=Math.max(...look.map(x=>x.high));
    const lo=Math.min(...look.map(x=>x.low));
    const width=hi-lo;
    if(width < A[i]*2.6 || width > A[i]*5.4) continue;

    const edgeBand=Math.max(A[i]*0.28,width*0.075);
    let lowTouches=0,highTouches=0;
    for(const b of look){
      if(b.low <= lo+edgeBand) lowTouches++;
      if(b.high >= hi-edgeBand) highTouches++;
    }
    if(lowTouches<2 || highTouches<2) continue;

    // Avoid ranges already breaking before the signal candle.
    const recent=look.slice(-6);
    if(recent.some(b=>b.close<lo-A[i]*0.10 || b.close>hi+A[i]*0.10)) continue;

    const c=m5[i];
    const barRange=Math.max(1e-9,c.high-c.low);
    const body=Math.abs(c.close-c.open)/barRange;
    const lowerWick=(Math.min(c.open,c.close)-c.low)/barRange;
    const upperWick=(c.high-Math.max(c.open,c.close))/barRange;
    const midpoint=(hi+lo)/2;

    let side=null;
    const buyReject=c.low<=lo+edgeBand && c.close>=lo+edgeBand*0.75 && lowerWick>=0.35 && body<=0.58 && R[i]<=42;
    const sellReject=c.high>=hi-edgeBand && c.close<=hi-edgeBand*0.75 && upperWick>=0.35 && body<=0.58 && R[i]>=58;
    if(buyReject) side='BUY';
    if(sellReject) side='SELL';
    if(!side) continue;

    // Signal must close back inside the established range, not continue the breakout.
    if(side==='BUY' && (c.close<=lo || c.close>=midpoint)) continue;
    if(side==='SELL' && (c.close>=hi || c.close<=midpoint)) continue;

    const en=m5[i+1].open;
    const structuralStop=side==='BUY'?Math.max(A[i]*0.90,en-(lo-A[i]*0.22)):Math.max(A[i]*0.90,(hi+A[i]*0.22)-en);
    const slDist=Math.min(structuralStop,A[i]*1.45);
    if(!(slDist>0)) continue;

    const midDistance=side==='BUY'?midpoint-en:en-midpoint;
    const maxTarget=slDist*1.35;
    const targetDist=Math.min(midDistance,maxTarget);
    const rr=targetDist/slDist;
    if(!(rr>=0.90 && rr<=1.35)) continue;

    const sl=side==='BUY'?en-slDist:en+slDist;
    const tp=side==='BUY'?en+targetDist:en-targetDist;

    for(let j=i+1;j<m5.length;j++){
      const b=m5[j];
      const loss=side==='BUY'?b.low<=sl:b.high>=sl;
      const win=side==='BUY'?b.high>=tp:b.low<=tp;
      // Conservative same-bar handling: if both touched, count the stop first.
      if(loss||win){
        out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side,name:'GOLD_RANGE_MR_V2',hour:new Date(m5[i+1].timestamp).getUTCHours()});
        busy=j;break;
      }
      // Range scalp should work quickly. Exit at market after 90 minutes.
      if(j-i>=18){
        const mark=side==='BUY'?(b.close-en)/slDist:(en-b.close)/slDist;
        out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side,name:'GOLD_RANGE_MR_V2',hour:new Date(m5[i+1].timestamp).getUTCHours()});
        busy=j;break;
      }
    }
  }
  return out;
}

(async()=>{
  console.log('🌊 GOLD RANGE MR V2 — STANDALONE BACKTEST');
  console.log('🧪 No portfolio / no Grok / no Pro / no H4 / no hour optimization');
  console.log(`📅 ${FROM} → ${TO}`);
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  console.log(`✅ M5 ${m5.length}`);
  const T=runRangeV2(m5);
  console.log('\n📊 TOTAL\n'+fmt(stats(T)));
  console.log('\n📅 YEARLY');
  const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
  console.log('\n📈 SIDE SPLIT');
  for(const side of ['BUY','SELL']){const z=T.filter(x=>x.side===side);console.log(`${side} | ${fmt(stats(z))}`)}
  console.log('\n🕐 BY UTC HOUR');
  for(let h=0;h<24;h++){const z=T.filter(x=>x.hour===h);if(z.length)console.log(`${String(h).padStart(2,'0')}:00 | ${fmt(stats(z))}`)}
})().catch(e=>{console.error(e);process.exit(1)});
