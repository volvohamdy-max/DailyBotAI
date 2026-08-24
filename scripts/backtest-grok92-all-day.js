const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2025-08-24';
const TO = process.argv[3] || '2026-08-24';

function tf(a,min){const ms=min*60000,m=new Map();for(const x of a){const t=Math.floor(x.timestamp/ms)*ms;if(!m.has(t))m.set(t,{timestamp:t,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume||0});else{const b=m.get(t);b.high=Math.max(b.high,x.high);b.low=Math.min(b.low,x.low);b.close=x.close;b.volume+=x.volume||0}}return[...m.values()].sort((a,b)=>a.timestamp-b.timestamp)}
function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}let T=0,P=0,M=0;for(let i=1;i<=p;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function prev(a,t){let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(a[m].timestamp<t)l=m+1;else h=m}return l-1}

function run(m5,h1){
  const out=[],C=m5.map(x=>x.close),e9=ema(C,9),e21=ema(C,21),R=rsi(C),A=atr(m5),H=h1.map(x=>x.close),e200=ema(H,200),HA=atr(h1),HD=adx(h1);let busy=-1;
  for(let i=60;i<m5.length-1;i++){
    if(i<=busy)continue;
    const side=e9[i-1]<=e21[i-1]&&e9[i]>e21[i]&&R[i]>52?'BUY':e9[i-1]>=e21[i-1]&&e9[i]<e21[i]&&R[i]<48?'SELL':null;
    if(!side||!A[i]||Math.abs(e9[i]-e21[i])/A[i]<.04)continue;
    const vv=m5.slice(i-20,i).map(x=>x.volume||0),va=vv.reduce((a,b)=>a+b,0)/20;
    if(!(va>0&&(m5[i].volume||0)>=va*1.25))continue;
    const h=prev(h1,m5[i].timestamp);if(h<200||!HA[h]||HD[h]<20)continue;
    const bias=H[h]>e200[h]?'BUY':'SELL';if(side!==bias||Math.abs(H[h]-e200[h])/HA[h]<.10)continue;
    const en=m5[i+1].open,risk=A[i]*2,sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+risk*.8:en-risk*.8;
    for(let j=i+1;j<m5.length;j++){
      const loss=side==='BUY'?m5[j].low<=sl:m5[j].high>=sl,win=side==='BUY'?m5[j].high>=tp:m5[j].low<=tp;
      if(loss||win){out.push({time:m5[i+1].timestamp,exitTime:m5[j].timestamp,r:loss?-1:.8,side,hour:new Date(m5[i+1].timestamp).getUTCHours()});busy=j;break}
    }
  }
  return out;
}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;maxLs=Math.max(maxLs,ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?w/t.length*100:0,net,avg:t.length?net/t.length:0,pf:gl?gp/gl:999,dd,ls:maxLs}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

(async()=>{
 console.log('⚡ GROK GOLD 92 — ALL-DAY BACKTEST');console.log(`📅 ${FROM} → ${TO}`);
 const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
 const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp),h1=tf(m5,60);
 console.log(`✅ M5 ${m5.length} | H1 ${h1.length}`);
 const T=run(m5,h1);console.log('\n📊 ALL DAY\n'+fmt(stats(T)));
 const old=T.filter(x=>(x.hour>=13&&x.hour<16)||(x.hour>=18&&x.hour<20));console.log('\n🕒 OLD SESSION TRADES INSIDE SAME RUN\n'+fmt(stats(old)));
 const outside=T.filter(x=>!((x.hour>=13&&x.hour<16)||(x.hour>=18&&x.hour<20)));console.log('\n🌍 NEW OUTSIDE-SESSION TRADES\n'+fmt(stats(outside)));
 console.log('\n📅 YEARLY');const y={};for(const t of T)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
 console.log('\n🕐 BY UTC HOUR');for(let h=0;h<24;h++){const z=T.filter(x=>x.hour===h);if(z.length)console.log(`${String(h).padStart(2,'0')}:00 | ${fmt(stats(z))}`)}
})().catch(e=>{console.error(e);process.exit(1)});
