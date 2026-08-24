const { getHistoricalRates } = require('dukascopy-node');
const { emaSeries, rsiSeries, atrSeries, adxSeries } = require('../src/services/scalpStrategies/goldRangeMrStrategy');
const FROM = process.argv[2] || '2025-08-24';
const TO = process.argv[3] || '2026-08-24';

function stats(t) {
  let n=0,w=0,net=0,gp=0,gl=0,pk=0,dd=0,ls=0,ml=0;
  for (const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)) {
    n++; net += x.r;
    if (x.r > 0) { w++; gp += x.r; ls=0; } else { gl -= x.r; ls++; ml=Math.max(ml,ls); }
    pk=Math.max(pk,net); dd=Math.max(dd,pk-net);
  }
  return {n,wr:n?w/n*100:0,net,avg:n?net/n:0,pf:gl?gp/gl:999,dd,ls:ml};
}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function run(m5,p) {
  const out=[];
  const C=m5.map(x=>x.close), E=emaSeries(C,20), R=rsiSeries(C,14), A=atrSeries(m5,14), D=adxSeries(m5,14);
  let busy=-1;
  for (let i=100;i<m5.length-2;i++) {
    if (i<=busy || ![E[i],E[i-6],R[i],A[i],D[i]].every(Number.isFinite) || A[i]<=0) continue;
    if (D[i]>p.adxMax) continue;
    const sm=A.slice(i-50,i).filter(Number.isFinite);
    if (sm.length<45) continue;
    const ar=A[i]/(sm.reduce((a,b)=>a+b,0)/sm.length);
    if (ar<p.atrLo || ar>p.atrHi) continue;
    if (Math.abs(E[i]-E[i-6])/A[i]>p.emaSlopeMax) continue;
    const look=m5.slice(i-30,i), hi=Math.max(...look.map(x=>x.high)), lo=Math.min(...look.map(x=>x.low)), width=hi-lo;
    if (width<A[i]*p.widthMin || width>A[i]*p.widthMax) continue;
    const edge=Math.max(A[i]*p.edgeAtr,width*.075);
    let lt=0,ht=0;
    for (const b of look) { if(b.low<=lo+edge)lt++; if(b.high>=hi-edge)ht++; }
    if (lt<2 || ht<2 || look.slice(-6).some(b=>b.close<lo-A[i]*.1 || b.close>hi+A[i]*.1)) continue;
    const c=m5[i], br=Math.max(1e-9,c.high-c.low), body=Math.abs(c.close-c.open)/br;
    const lw=(Math.min(c.open,c.close)-c.low)/br, uw=(c.high-Math.max(c.open,c.close))/br, mid=(hi+lo)/2;
    for (const side of ['BUY','SELL']) {
      if (p.side!=='BOTH' && p.side!==side) continue;
      const ok = side==='BUY'
        ? c.low<=lo+edge && c.close>=lo+edge*.75 && lw>=p.wickMin && body<=p.bodyMax && R[i]<=p.rsiEdge && c.close>lo && c.close<mid
        : c.high>=hi-edge && c.close<=hi-edge*.75 && uw>=p.wickMin && body<=p.bodyMax && R[i]>=100-p.rsiEdge && c.close<hi && c.close>mid;
      if (!ok) continue;
      const entry=m5[i+1].open;
      const structural=side==='BUY' ? Math.max(A[i]*.9,entry-(lo-A[i]*.22)) : Math.max(A[i]*.9,(hi+A[i]*.22)-entry);
      const sd=Math.min(structural,A[i]*1.45);
      const md=side==='BUY' ? mid-entry : entry-mid;
      const td=Math.min(md,sd*1.35), rr=td/sd;
      if (!(rr>=p.minRR && rr<=1.35)) continue;
      const sl=side==='BUY'?entry-sd:entry+sd, tp=side==='BUY'?entry+td:entry-td;
      for (let j=i+1;j<m5.length;j++) {
        const b=m5[j], loss=side==='BUY'?b.low<=sl:b.high>=sl, win=side==='BUY'?b.high>=tp:b.low<=tp;
        if (loss||win) { out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:loss?-1:rr,side}); busy=j; break; }
        if (j-i>=18) {
          const mark=side==='BUY'?(b.close-entry)/sd:(entry-b.close)/sd;
          out.push({time:m5[i+1].timestamp,exitTime:b.timestamp,r:Math.max(-1,Math.min(rr,mark)),side}); busy=j; break;
        }
      }
      break;
    }
  }
  return out;
}

(async()=>{
  console.log('🌊 GOLD RANGE MR V3 — ROBUSTNESS RESEARCH');
  console.log(`📅 ${FROM} → ${TO}`);
  console.log('⚠️ Research only; live untouched.');
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  console.log(`✅ M5 ${m5.length}`);
  const variants=[];
  for(const side of ['BOTH','BUY','SELL']) for(const adxMax of [16,18,20]) for(const atr of [[.68,1.12],[.72,1.12]]) for(const emaSlopeMax of [.32,.42]) for(const width of [[2.3,5.8],[2.6,5.8]]) for(const rsiEdge of [42,45]) variants.push({side,adxMax,atrLo:atr[0],atrHi:atr[1],emaSlopeMax,widthMin:width[0],widthMax:width[1],edgeAtr:.28,wickMin:.35,bodyMax:.58,rsiEdge,minRR:.85});
  console.log(`🧪 Variants ${variants.length}`);
  const cut=new Date('2026-01-01T00:00:00Z').getTime(), rows=[];
  for(const p of variants){const t=run(m5,p),dev=t.filter(x=>x.time<cut),oos=t.filter(x=>x.time>=cut),a=stats(t),d=stats(dev),o=stats(oos);const pass=a.n>=40&&a.n<=180&&a.pf>=1.25&&a.dd<=12&&d.n>=12&&d.pf>=1.10&&d.net>0&&o.n>=20&&o.pf>=1.15&&o.net>0;rows.push({p,a,d,o,pass,score:o.net-o.dd+a.net*.2});}
  rows.sort((x,y)=>y.score-x.score);
  console.log('\n🏆 TOP 20');
  for(const x of rows.slice(0,20)) console.log(`${x.pass?'✅':'⚠️'} ${JSON.stringify(x.p)} | ALL ${fmt(x.a)} | DEV ${fmt(x.d)} | OOS ${fmt(x.o)}`);
  const passed=rows.filter(x=>x.pass);
  console.log(`\n🛡️ ROBUST PASS: ${passed.length}/${rows.length}`);
  if(passed.length){const b=passed[0];console.log('\n🏆 BEST ROBUST V3');console.log(JSON.stringify(b.p));console.log('ALL '+fmt(b.a));console.log('DEV '+fmt(b.d));console.log('OOS '+fmt(b.o));} else console.log('❌ No V3 variant passed. Do NOT modify live.');
  console.log('\n⚠️ Research only — live strategy/VIP routing untouched.');
})().catch(e=>{console.error(e);process.exit(1);});
