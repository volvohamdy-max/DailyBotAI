const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2025-08-23';
const TO = process.argv[3] || '2026-08-23';

function dayKey(ts){ return new Date(ts).toISOString().slice(0,10); }
function emaSeries(v,p){ const o=Array(v.length).fill(null),k=2/(p+1); let e=v[0]; for(let i=0;i<v.length;i++){ if(i>0)e=v[i]*k+e*(1-k); if(i>=p-1)o[i]=e; } return o; }
function rsiSeries(v,p=14){ const o=Array(v.length).fill(null); let ag=null,al=null; for(let i=1;i<v.length;i++){ const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0); if(i===p){ let gs=0,ls=0; for(let j=1;j<=p;j++){ const x=v[j]-v[j-1]; gs+=Math.max(x,0); ls+=Math.max(-x,0); } ag=gs/p; al=ls/p; } else if(i>p){ ag=(ag*(p-1)+g)/p; al=(al*(p-1)+l)/p; } if(i>=p)o[i]=al===0?100:100-100/(1+ag/al); } return o; }
function atrSeries(c,p=14){ const o=Array(c.length).fill(null); for(let i=p;i<c.length;i++){ let s=0; for(let j=i-p+1;j<=i;j++){ const pc=c[j-1].close; s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc)); } o[i]=s/p; } return o; }
function adxSeries(c,p=14){ const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0); for(let i=1;i<c.length;i++){ const up=c[i].high-c[i-1].high,dn=c[i-1].low-c[i].low; pd[i]=up>dn&&up>0?up:0; md[i]=dn>up&&dn>0?dn:0; tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)); } if(c.length<=p*2)return o; let trN=0,pN=0,mN=0; for(let i=1;i<=p;i++){ trN+=tr[i]; pN+=pd[i]; mN+=md[i]; } const dx=Array(c.length).fill(null); for(let i=p;i<c.length;i++){ if(i>p){ trN=trN-trN/p+tr[i]; pN=pN-pN/p+pd[i]; mN=mN-mN/p+md[i]; } if(trN<=0)continue; const pdi=100*pN/trN,mdi=100*mN/trN,den=pdi+mdi; if(den>0)dx[i]=100*Math.abs(pdi-mdi)/den; } let seed=0,count=0; for(let i=p;i<c.length;i++){ if(!Number.isFinite(dx[i]))continue; if(count<p){ seed+=dx[i]; count++; if(count===p)o[i]=seed/p; } else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p; } return o; }
function tf(rows,min){ const ms=min*60000,m=new Map(); for(const x of rows){ const t=Math.floor(x.timestamp/ms)*ms; if(!m.has(t))m.set(t,{timestamp:t,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume||0}); else { const b=m.get(t); b.high=Math.max(b.high,x.high); b.low=Math.min(b.low,x.low); b.close=x.close; b.volume+=(x.volume||0); } } return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp); }
function prevIndex(rows,ts){ let lo=0,hi=rows.length; while(lo<hi){ const m=(lo+hi)>>1; if(rows[m].timestamp<ts)lo=m+1; else hi=m; } return lo-1; }

function testPro(m5,h1){
  const out=[];
  const rs=rsiSeries(m5.map(x=>x.close),14);
  const adx=adxSeries(m5,14);
  const atr=atrSeries(m5,14);
  const days=tf(h1,1440);
  const dEma=emaSeries(days.map(x=>x.close),50);
  let lastExit=-1,cooldownUntil=0,lossDay='',losses=0;

  for(let i=80;i<m5.length-2;i++){
    if(i<=lastExit)continue;
    const now=m5[i+1].timestamp,d=new Date(now),dk=dayKey(now);
    if(lossDay!==dk){ lossDay=dk; losses=0; }
    if(losses>=2 || now<cooldownUntil)continue;

    const hour=d.getUTCHours();
    if(new Set([1,2,3,4,5,15,16,21,22,23]).has(hour))continue;
    if(d.getUTCDay()===3){ const mins=hour*60+d.getUTCMinutes(); if(mins>=1020&&mins<=1230)continue; }

    const di=prevIndex(days,m5[i].timestamp);
    if(di<50 || !Number.isFinite(dEma[di]))continue;
    const bias=days[di].close>dEma[di]?'BUY':'SELL';

    if(!(adx[i]>=15) || !Number.isFinite(atr[i]))continue;
    const prevAtr=atr.slice(Math.max(0,i-50),i).filter(Number.isFinite);
    if(prevAtr.length<50)continue;
    const ar=atr[i]/(prevAtr.reduce((a,b)=>a+b,0)/prevAtr.length);
    if(ar>1.15)continue;

    let side=null;
    if(rs[i-1]>=37 && rs[i]<37 && bias==='BUY')side='BUY';
    if(rs[i-1]<=63 && rs[i]>63 && bias==='SELL')side='SELL';
    if(!side)continue;

    const range=m5[i].high-m5[i].low;
    if(!(range>0) || Math.abs(m5[i].close-m5[i].open)/range<0.5)continue;

    const entry=m5[i+1].open;
    const sl=side==='BUY'?entry-10:entry+10;
    let result=null;

    for(let j=i+1;j<m5.length && j<=i+4320;j++){
      const b=m5[j];
      if(side==='BUY' && b.low<=sl){ result={r:-1,exit:j,won:false}; break; }
      if(side==='SELL' && b.high>=sl){ result={r:-1,exit:j,won:false}; break; }
      const rj=rs[j];
      if(side==='BUY' && Number.isFinite(rj) && rj>=63){ result={r:(b.close-entry)/10,exit:j,won:b.close>=entry}; break; }
      if(side==='SELL' && Number.isFinite(rj) && rj<=37){ result={r:(entry-b.close)/10,exit:j,won:b.close<=entry}; break; }
      const jd=new Date(b.timestamp);
      if(jd.getUTCDay()===5 && (jd.getUTCHours()>21 || (jd.getUTCHours()===21 && jd.getUTCMinutes()>=45))){
        result={r:side==='BUY'?(b.close-entry)/10:(entry-b.close)/10,exit:j,won:side==='BUY'?b.close>=entry:b.close<=entry};
        break;
      }
    }

    if(!result)continue;
    out.push({time:m5[i+1].timestamp,r:result.r,side});
    lastExit=result.exit;
    i=result.exit;
    if(!result.won){ losses++; cooldownUntil=m5[result.exit].timestamp+180*60000; }
  }
  return out;
}

function stats(trades){
  let net=0,peak=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;
  const years={};
  for(const t of trades){
    net+=t.r;
    if(t.r>0){ w++; gp+=t.r; ls=0; } else { gl+=Math.abs(t.r); ls++; maxLs=Math.max(maxLs,ls); }
    peak=Math.max(peak,net); dd=Math.max(dd,peak-net);
    const y=new Date(t.time).getUTCFullYear();
    if(!years[y])years[y]={n:0,r:0};
    years[y].n++; years[y].r+=t.r;
  }
  return {trades:trades.length,wr:trades.length?w/trades.length*100:0,net,avg:trades.length?net/trades.length:0,pf:gl?gp/gl:Infinity,dd,maxLs,years};
}

(async()=>{
  console.log('⭐ GOLD PRO — STANDALONE BACKTEST');
  console.log(`📅 ${FROM} → ${TO}`);
  console.log('⏳ Loading XAUUSD M5 from Dukascopy...');

  const raw=await getHistoricalRates({
    instrument:'xauusd',
    dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},
    timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:500,
    useCache:true,cacheFolderPath:'./data/dukascopy-cache'
  });

  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0}))
    .filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite))
    .sort((a,b)=>a.timestamp-b.timestamp);
  const h1=tf(m5,60);

  console.log(`✅ M5 candles: ${m5.length}`);
  console.log('');
  console.log('RULES');
  console.log('Daily bias: Daily Close vs EMA50');
  console.log('BUY: RSI14 crosses below 37 with BUY daily bias');
  console.log('SELL: RSI14 crosses above 63 with SELL daily bias');
  console.log('ADX M5 >= 15');
  console.log('ATR regime <= 1.15 vs previous 50 ATR average');
  console.log('Signal candle body >= 50% of range');
  console.log('Blocked UTC hours: 01-05, 15-16, 21-23');
  console.log('Wednesday blocked: 17:00-20:30 UTC');
  console.log('SL: fixed 10 price units');
  console.log('Exit BUY: RSI14 >= 63');
  console.log('Exit SELL: RSI14 <= 37');
  console.log('Friday forced exit: 21:45 UTC');
  console.log('Max 2 losses/day | Cooldown after loss: 180m');

  const trades=testPro(m5,h1);
  const s=stats(trades);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ⭐ GOLD PRO — RESULT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Trades: ${s.trades}`);
  console.log(`WR: ${s.wr.toFixed(1)}%`);
  console.log(`Net R: ${s.net>=0?'+':''}${s.net.toFixed(2)}R`);
  console.log(`Avg R: ${s.avg.toFixed(3)}R`);
  console.log(`PF: ${Number.isFinite(s.pf)?s.pf.toFixed(2):'∞'}`);
  console.log(`DD: ${s.dd.toFixed(2)}R`);
  console.log(`Max LS: ${s.maxLs}`);
  console.log('\n📅 Yearly');
  for(const [y,v] of Object.entries(s.years)) console.log(`${y} | ${v.n} | ${v.r>=0?'+':''}${v.r.toFixed(2)}R`);
})().catch(err=>{ console.error('❌ Backtest error:',err.message); process.exit(1); });
