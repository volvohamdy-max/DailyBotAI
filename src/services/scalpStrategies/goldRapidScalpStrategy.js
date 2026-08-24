const { getGoldCandlesResilient } = require('../goldCandleRecovery');
const { getPrice } = require('../marketService');

const CONFIG = {
  id: 'GOLD_RAPID_SCALP_V5', label: '🚀 Gold Rapid Scalp V5', pair: 'XAUUSD',
  rr: 2, breakAtr: 0.05, bodyMin: 0.5, closePos: 0.72, h1Sep: 0.08,
  rangeMax: 2.2, emaDistMax: 1.5, slAtr: 0.65, riskCap: 1.35, maxBars: 8,
  hoursUTC: [11,12,13,14,15,17]
};
const STATE={lastSignalBar:null};
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function closed(rows){return Array.isArray(rows)&&rows.length>1?rows.slice(0,-1):[]}
function emaSeries(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atrSeries(c,p=14){const o=Array(c.length).fill(null);let s=0;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));s+=tr;if(i>p){const j=i-p,old=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));s-=old}if(i>=p)o[i]=s/p}return o}
function wait(status,extra={}){return{ready:false,status,pair:CONFIG.pair,strategyId:CONFIG.id,strategyLabel:CONFIG.label,...extra}}
async function scan(){
  const [r5,r1,live]=await Promise.all([getGoldCandlesResilient('5min',150),getGoldCandlesResilient('1h',120),getPrice('XAUUSD')]);
  const c=closed(r5),h1=closed(r1); if(c.length<60||h1.length<55)return wait('RAPID_NO_DATA',{m5:c.length,h1:h1.length});
  const i=c.length-1,h=h1.length-1,hour=new Date(c[i].timestamp).getUTCHours();
  if(!CONFIG.hoursUTC.includes(hour))return wait(hour===16?'RAPID_EXCLUDED_16UTC':'RAPID_OUTSIDE_SESSION',{hourUTC:hour});
  const C=c.map(x=>+x.close),E20=emaSeries(C,20),A=atrSeries(c),HC=h1.map(x=>+x.close),H20=emaSeries(HC,20),H50=emaSeries(HC,50),HA=atrSeries(h1);
  if(![E20[i],A[i],H20[h],H50[h],HA[h],H20[h-2]].every(Number.isFinite)||!(A[i]>0&&HA[h]>0))return wait('RAPID_INDICATORS_NOT_READY');
  const sep=Math.abs(H20[h]-H50[h])/HA[h]; if(sep<CONFIG.h1Sep)return wait('RAPID_H1_SEPARATION_LOW',{h1Sep:sep});
  // Validated V5 D is BUY ONLY. Keep exact V4 bullish H1 regime.
  const bullish=HC[h]>H20[h]&&H20[h]>H50[h]&&H20[h]>H20[h-2]; if(!bullish)return wait('RAPID_NO_BULLISH_H1_REGIME');
  let hi=-Infinity;for(let j=i-3;j<i;j++)hi=Math.max(hi,c[j].high);
  const range=c[i].high-c[i].low,body=Math.abs(c[i].close-c[i].open); if(!range||body/A[i]<CONFIG.bodyMin)return wait('RAPID_BODY_TOO_SMALL');
  if(range/A[i]>CONFIG.rangeMax)return wait('RAPID_RANGE_TOO_LARGE');
  const pos=(c[i].close-c[i].low)/range; if(pos<CONFIG.closePos)return wait('RAPID_CLOSE_POSITION_WEAK');
  if(Math.abs(c[i].close-E20[i])/A[i]>CONFIG.emaDistMax)return wait('RAPID_TOO_FAR_EMA20');
  if(!(c[i].close>hi+CONFIG.breakAtr*A[i]&&c[i].close>E20[i]))return wait('RAPID_NO_BREAKOUT');
  const signalBar=String(c[i].timestamp);if(STATE.lastSignalBar===signalBar)return wait('RAPID_SIGNAL_ALREADY_SENT');
  const entry=finite(live);if(entry===null)return wait('RAPID_NO_LIVE_PRICE');
  // Backtest enters next-bar open and rejects gaps > .3 ATR. Live equivalent: reject if current GoldAPI entry chased too far from signal close.
  if(Math.abs(entry-c[i].close)>A[i]*0.3)return wait('RAPID_ENTRY_GAP_TOO_LARGE');
  const swing=Math.min(c[i].low,c[i-1].low),risk=Math.max(A[i]*CONFIG.slAtr,Math.abs(entry-swing));if(risk>A[i]*CONFIG.riskCap)return wait('RAPID_RISK_TOO_LARGE');
  const stopLoss=entry-risk,tp=entry+risk*CONFIG.rr;STATE.lastSignalBar=signalBar;
  return{ready:true,status:'RAPID_READY',pair:CONFIG.pair,direction:'BUY',strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'M5_MOMENTUM_BREAKOUT_H1_TREND',grade:'A',score:90,aiConfidence:0,entry,stopLoss,tp1:tp,tp2:tp,risk,rrTp1:CONFIG.rr,rrTp2:CONFIG.rr,atr5:A[i],ema20:E20[i],h1Sep:sep,hourUTC:hour,signalBar,reasons:['Validated V5 D BUY-only','16:00 UTC excluded','M5 breakout + strong candle close','H1 EMA20/50 bullish regime','Binance PAXG proxy candles + GoldAPI live entry']};
}
function markSent(){}
module.exports={CONFIG,scan,markSent};
