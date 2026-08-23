const { getGoldHistoricalCandles } = require('./backtestHistoryDukascopyLocal');

const HISTORY=Math.max(30000,Math.min(141000,Number(process.env.BACKTEST_HISTORY||100000)));
const BB_PERIOD=20, BB_K=2, ATR_PERIOD=14, COMP_LOOKBACK=60, RANGE_BARS=6;
const WIDTH_Q=0.25, ATR_Q=0.30, EXP_BODY_ATR=0.9, COST_R=0.03;

function sma(v,p){const o=Array(v.length).fill(null);let s=0;for(let i=0;i<v.length;i++){s+=v[i];if(i>=p)s-=v[i-p];if(i>=p-1)o[i]=s/p}return o}
function stdev(v,p,ma){const o=Array(v.length).fill(null);for(let i=p-1;i<v.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const d=v[j]-ma[i];s+=d*d}o[i]=Math.sqrt(s/p)}return o}
function atr(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(null);for(let i=1;i<c.length;i++)tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=tr[j];o[i]=s/p}return o}
function quantile(a,q){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const p=(x.length-1)*q,l=Math.floor(p),h=Math.ceil(p);if(l===h)return x[l];return x[l]+(x[h]-x[l])*(p-l)}
function stats(t){if(!t.length)return{trades:0,wr:0,netR:0,avgR:0,pf:0,dd:0,ls:0};let w=0,gp=0,gl=0,e=0,pk=0,dd=0,ls=0,ml=0;for(const x of t){e+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;ml=Math.max(ml,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{trades:t.length,wr:100*w/t.length,netR:e,avgR:e/t.length,pf:gl?gp/gl:999,dd,ls:ml}}
const fmt=s=>`${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.netR>=0?'+':''}${s.netR.toFixed(2)}R | Avg ${s.avgR.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function run(c,start,end,rr){
  const C=c.map(x=>x.close),M=sma(C,BB_PERIOD),S=stdev(C,BB_PERIOD,M),A=atr(c,ATR_PERIOD),W=C.map((_,i)=>Number.isFinite(M[i])&&M[i]!==0&&Number.isFinite(S[i])?(4*S[i])/M[i]:null),out=[];let p=null;
  for(let i=Math.max(start,Math.max(BB_PERIOD,ATR_PERIOD)+COMP_LOOKBACK);i<Math.min(end,c.length-1);i++){
    if(p){const b=c[i],sl=p.side==='BUY'?b.low<=p.sl:b.high>=p.sl,tp=p.side==='BUY'?b.high>=p.tp:b.low<=p.tp;if(sl||tp){out.push({...p,exitTime:b.time,r:(sl?-1:rr)-COST_R});p=null}continue}
    if(![M[i],S[i],A[i],W[i]].every(Number.isFinite))continue;
    const wHist=W.slice(i-COMP_LOOKBACK,i),aHist=A.slice(i-COMP_LOOKBACK,i),wThr=quantile(wHist,WIDTH_Q),aThr=quantile(aHist,ATR_Q);if(!Number.isFinite(wThr)||!Number.isFinite(aThr))continue;
    const comp=W[i-1]<=wThr&&A[i-1]<=aThr;if(!comp)continue;
    const box=c.slice(i-RANGE_BARS,i),boxHi=Math.max(...box.map(x=>x.high)),boxLo=Math.min(...box.map(x=>x.low));
    const b=c[i],range=b.high-b.low,body=Math.abs(b.close-b.open);if(!range||body<A[i]*EXP_BODY_ATR)continue;
    let side=null;if(b.close>boxHi&&b.close>b.open)side='BUY';else if(b.close<boxLo&&b.close<b.open)side='SELL';if(!side)continue;
    const entry=c[i+1].open,rawRisk=side==='BUY'?entry-boxLo:boxHi-entry,risk=Math.max(rawRisk,A[i]*0.6);if(!Number.isFinite(risk)||risk<=0)continue;
    p={side,time:c[i+1].time,entry,risk,sl:side==='BUY'?entry-risk:entry+risk,tp:side==='BUY'?entry+risk*rr:entry-risk*rr};
  }
  return out;
}

(async()=>{
  console.log('⚡ GOLD VOLATILITY COMPRESSION → EXPANSION — M5');
  console.log('No RSI / EMA / ADX / session filter | BB-width + ATR compression | 6-bar box breakout | expansion body>=0.9ATR');
  const c=(await getGoldHistoricalCandles('5min',HISTORY)).map(x=>({...x,time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close}));
  console.log(`✅ Dukascopy local history: 5min ${c.length} candles`);
  const s=100,u=c.length-s,de=s+Math.floor(u*.6),ve=s+Math.floor(u*.8);
  for(const rr of [1,1.25]){
    const D=run(c,s,de,rr),V=run(c,de,ve,rr),O=run(c,ve,c.length,rr),F=run(c,s,c.length,rr);
    console.log(`\n━━━━━━━━━━ TP ${rr}R ━━━━━━━━━━`);
    console.log('\n📊 DEV\n'+fmt(stats(D))+'\n\n📊 VAL\n'+fmt(stats(V))+'\n\n🧪 OOS — UNTOUCHED 20%\n'+fmt(stats(O)));
    console.log('\n📈 OOS BUY\n'+fmt(stats(O.filter(x=>x.side==='BUY')))+'\n\n📉 OOS SELL\n'+fmt(stats(O.filter(x=>x.side==='SELL'))));
    console.log('\n📅 YEARLY — FULL HISTORY');const y={};for(const t of F)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
  }
})().catch(e=>{console.error(e);process.exit(1)});
