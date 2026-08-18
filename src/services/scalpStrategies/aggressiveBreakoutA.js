const { getCandles, getPrice } = require('../marketService');

const CONFIG = {
  id: 'AGGRESSIVE_BREAKOUT_A',
  label: '🔥 Aggressive BREAKOUT-A',
  pair: 'XAUUSD',
  breakoutMaxAtr: 0.45,
  swingLookback: 8,
  slBufferAtr: 0.10,
  minRiskAtr: 0.45,
  tp1R: 1.0,
  tp2R: 2.0
};

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
function closed(r){return Array.isArray(r)&&r.length>1?r.slice(0,-1):[]}
function ema(v,p){if(v.length<p)return null;let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);for(let i=p;i<v.length;i++)e=v[i]*k+e*(1-k);return e}
function rsi(v,p=14){if(v.length<=p)return null;let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];d>=0?g+=d:l+=-d}if(!l)return 100;const rs=(g/p)/(l/p);return 100-100/(1+rs)}
function atr(c,p=14){if(c.length<p+1)return null;let t=0;for(let i=c.length-p;i<c.length;i++){const h=n(c[i].high),l=n(c[i].low),pc=n(c[i-1].close);if([h,l,pc].some(x=>x==null))return null;t+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}return t/p}
function momentum(c,k=3){const s=c.slice(-k);if(s.length<k)return null;let impulse=0,strength=0;for(const x of s){const d=n(x.close)-n(x.open);impulse+=d;strength+=d>0?1:d<0?-1:0}return{side:impulse>0?'BUY':impulse<0?'SELL':null,strength:Math.abs(strength),impulse}}
function recentRange(c,k=6){if(c.length<k+1)return null;const a=c.slice(-(k+1),-1);return{hi:Math.max(...a.map(x=>n(x.high))),lo:Math.min(...a.map(x=>n(x.low)))}}
function recentSwing(c,side,k=CONFIG.swingLookback){const a=c.slice(-k);return side==='BUY'?Math.min(...a.map(x=>n(x.low))):Math.max(...a.map(x=>n(x.high)))}
function trend15(c){const v=c.map(x=>n(x.close)).filter(Number.isFinite);const e20=ema(v,20),e50=ema(v,50);return e20>e50?'BUY':e20<e50?'SELL':null}

async function scan(){
  const [r5,r15,px]=await Promise.all([getCandles('XAUUSD','5min'),getCandles('XAUUSD','15min'),getPrice('XAUUSD')]);
  const c5=closed(r5),c15=closed(r15);
  if(c5.length<60||c15.length<60)return{ready:false,status:'BREAKOUT_A_NO_DATA',strategyId:CONFIG.id,strategyLabel:CONFIG.label};
  const side=trend15(c15),a=atr(c5),v=c5.map(x=>n(x.close)).filter(Number.isFinite),e9=ema(v,9),e20=ema(v,20),rr=rsi(v,14),m=momentum(c5,3),rg=recentRange(c5,6),signalClose=n(c5.at(-1).close);
  if(!side||![a,e9,e20,rr,signalClose].every(Number.isFinite)||!m||!rg)return{ready:false,status:'BREAKOUT_A_INDICATORS',strategyId:CONFIG.id,strategyLabel:CONFIG.label};
  if(m.side!==side||m.strength<2)return{ready:false,status:'BREAKOUT_A_MOMENTUM',strategyId:CONFIG.id,strategyLabel:CONFIG.label,direction:side};
  if(side==='BUY'){
    if(!(signalClose>rg.hi&&(signalClose-rg.hi)<=a*CONFIG.breakoutMaxAtr&&e9>e20&&rr>=55&&rr<=78))return{ready:false,status:'BREAKOUT_A_WAIT',strategyId:CONFIG.id,strategyLabel:CONFIG.label,direction:side};
  }else{
    if(!(signalClose<rg.lo&&(rg.lo-signalClose)<=a*CONFIG.breakoutMaxAtr&&e9<e20&&rr<=45&&rr>=22))return{ready:false,status:'BREAKOUT_A_WAIT',strategyId:CONFIG.id,strategyLabel:CONFIG.label,direction:side};
  }
  const entry=n(px)??n(r5.at(-1)?.close)??signalClose;
  const sw=recentSwing(c5,side);
  let risk=side==='BUY'?entry-(sw-a*CONFIG.slBufferAtr):(sw+a*CONFIG.slBufferAtr)-entry;
  risk=Math.max(risk,a*CONFIG.minRiskAtr);
  const stopLoss=side==='BUY'?entry-risk:entry+risk;
  const tp1=side==='BUY'?entry+risk*CONFIG.tp1R:entry-risk*CONFIG.tp1R;
  const tp2=side==='BUY'?entry+risk*CONFIG.tp2R:entry-risk*CONFIG.tp2R;
  return{ready:true,status:'BREAKOUT_A_READY',pair:'XAUUSD',direction:side,strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'BREAKOUT_A',grade:'TECH-BREAKOUT',score:88,aiConfidence:0,entry,stopLoss,tp1,tp2,risk,rrTp1:CONFIG.tp1R,rrTp2:CONFIG.tp2R,atr5:a,rsi5:rr,ema9:e9,ema20,momentum:m,reasons:['15M trend','5M EMA9/20 aligned','Momentum strength >= 2','Breakout distance <= 0.45 ATR','RSI in validated range']};
}
module.exports={CONFIG,scan};
