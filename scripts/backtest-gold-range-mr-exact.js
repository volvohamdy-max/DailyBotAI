const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2022-08-24';
const TO = process.argv[3] || '2026-08-24';

function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function run(m5){
 const out=[],close=m5.map(c=>c.close),high=m5.map(c=>c.high),low=m5.map(c=>c.low),A=atr(m5),R=rsi(close),D=adx(m5); let busy=-1;
 for(let i=100;i<m5.length-2;i++){
  if(i<=busy||!A[i]||!R[i]||!D[i]) continue;
  const rangeHigh=Math.max(...high.slice(i-24,i));
  const rangeLow=Math.min(...low.slice(i-24,i));
  const width=rangeHigh-rangeLow;
  if(D[i]>20) continue;
  let side=null;
  if(close[i]<=rangeLow+width*0.25&&R[i]<44) side='BUY';
  if(close[i]>=rangeHigh-width*0.25&&R[i]>56) side='SELL';
  if(!side) continue;
  const entry=m5[i+1].open||close[i],risk=A[i]*2;
  const sl=side==='BUY'?entry-risk:entry+risk;
  const tp1=side==='BUY'?entry+risk:entry-risk;
  const tp2=side==='BUY'?entry+risk*2:entry-risk*2;
  // Exact signal/levels from supplied strategy. Backtest outcome uses TP2 as final win (+2R), SL as -1R.
  for(let j=i+1;j<m5.length;j++){
   const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp2:b.low<=tp2;
   if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:2,side,tp1});busy=j;break;}
  }
 }
 return out;
}

(async()=>{
 console.log('🌊 GOLD RANGE MR — EXACT SUPPLIED RULES BACKTEST');
 console.log('Rules: 24-bar range | ADX<=20 | RSI<44/>56 | SL=2ATR | TP1=1R | TP2=2R');
 console.log(`📅 ${FROM} → ${TO}`);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
 const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
 console.log(`✅ M5 ${m5.length}`); const T=run(m5);
 console.log('\n📊 TOTAL\n'+fmt(stats(T)));
 console.log('\n📅 YEARLY');const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
 console.log('\n📈 SIDE SPLIT');for(const side of ['BUY','SELL'])console.log(`${side} | ${fmt(stats(T.filter(x=>x.side===side)))}`);
})().catch(e=>{console.error(e);process.exit(1)});
