const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';

function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function runRange(m5){
  const out=[];
  const closes=m5.map(x=>x.close),E20=ema(closes,20),R=rsi(closes,14),A=atr(m5,14),D=adx(m5,14);
  let busy=-1;
  for(let i=80;i<m5.length-2;i++){
    if(i<=busy) continue;
    if(![E20[i],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0)) continue;

    // Only operate in quiet/ranging conditions.
    if(D[i] > 18) continue;
    const atrAvg=A.slice(i-40,i).filter(Number.isFinite);
    if(atrAvg.length<35) continue;
    const atrMean=atrAvg.reduce((a,b)=>a+b,0)/atrAvg.length;
    const atrRatio=A[i]/atrMean;
    if(atrRatio>1.20) continue;

    const look=m5.slice(i-23,i+1);
    const hi=Math.max(...look.map(x=>x.high));
    const lo=Math.min(...look.map(x=>x.low));
    const width=hi-lo;
    if(width < A[i]*2.2 || width > A[i]*6.5) continue;

    const c=m5[i], range=Math.max(1e-9,c.high-c.low);
    const lowerZone=lo+width*0.20, upperZone=hi-width*0.20;
    const lowerWick=(Math.min(c.open,c.close)-c.low)/range;
    const upperWick=(c.high-Math.max(c.open,c.close))/range;

    let side=null;
    if(c.low<=lowerZone && c.close>lo+width*0.12 && lowerWick>=0.28 && R[i]<=45) side='BUY';
    if(c.high>=upperZone && c.close<hi-width*0.12 && upperWick>=0.28 && R[i]>=55) side='SELL';
    if(!side) continue;

    // Don't fade a candle that closed too far through the EMA/range structure.
    if(side==='BUY' && c.close < E20[i]-A[i]*0.9) continue;
    if(side==='SELL' && c.close > E20[i]+A[i]*0.9) continue;

    const en=m5[i+1].open;
    const slDist=Math.max(A[i]*1.15,width*0.16);
    const sl=side==='BUY'?en-slDist:en+slDist;
    const target=Math.min(A[i]*1.15,width*0.34);
    const tp=side==='BUY'?en+target:en-target;
    const rr=target/slDist;
    if(rr<0.65) continue;

    for(let j=i+1;j<m5.length;j++){
      const b=m5[j];
      const loss=side==='BUY'?b.low<=sl:b.high>=sl;
      const win=side==='BUY'?b.high>=tp:b.low<=tp;
      // conservative same-bar assumption: SL first
      if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side,name:'GOLD_RANGE_MR',hour:new Date(m5[i+1].timestamp).getUTCHours()});busy=j;break}
      if(j-i>=24){
        const mark=side==='BUY'?(b.close-en)/slDist:(en-b.close)/slDist;
        out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side,name:'GOLD_RANGE_MR',hour:new Date(m5[i+1].timestamp).getUTCHours()});busy=j;break;
      }
    }
  }
  return out;
}

(async()=>{
  console.log('🌊 GOLD M5 RANGE / MEAN-REVERSION — RESEARCH BACKTEST');
  console.log(`📅 ${FROM} → ${TO}`);
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  console.log(`✅ M5 ${m5.length}`);
  const T=runRange(m5);
  console.log('\n📊 TOTAL\n'+fmt(stats(T)));
  console.log('\n📅 YEARLY');
  const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
  console.log('\n🕐 BY UTC HOUR');
  for(let h=0;h<24;h++){const z=T.filter(x=>x.hour===h);if(z.length)console.log(`${String(h).padStart(2,'0')}:00 | ${fmt(stats(z))}`)}
})().catch(e=>{console.error(e);process.exit(1)});
