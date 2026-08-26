const { getPrice } = require('../marketService');
const { getGoldCandlesResilient } = require('../goldCandleRecovery');

const CONFIG = {
  id: 'GROK_GOLD_92', label: '⚡ Grok Gold 92', pair: 'XAUUSD', fastEma: 9, slowEma: 21,
  rsiPeriod: 14, atrPeriod: 14, volumePeriod: 20, volumeSpikeMult: 1.25, stopAtr: 2.0,
  rewardR: 0.8, adxMin: 20, rsiBuyMin: 52, rsiSellMax: 48, emaGapAtr: 0.04,
  h1DistanceAtr: 0.10, sessionsUTC: [[0, 24]]
};
const STATE = { pendingSignalBar:null, lastSentSignalBar:null, lastSentAt:0 };
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function closedBars(rows){return Array.isArray(rows)&&rows.length>1?rows.slice(0,-1):[]}
function closes(rows){return rows.map(x=>finite(x.close)).filter(x=>x!=null)}
function emaSeries(v,p){const o=Array(v.length).fill(null);if(v.length<p)return o;const k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function ema(v,p){return emaSeries(v,p).at(-1)}
function rsiSeries(v,p=14){const o=Array(v.length).fill(null);let ag=null,al=null;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const x=v[j]-v[j-1];gs+=Math.max(x,0);ls+=Math.max(-x,0)}ag=gs/p;al=ls/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atrSeries(r,p=14){const o=Array(r.length).fill(null);for(let i=p;i<r.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=finite(r[j-1]?.close),h=finite(r[j]?.high),l=finite(r[j]?.low);if([pc,h,l].some(x=>x==null)){s=NaN;break}s+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}if(Number.isFinite(s))o[i]=s/p}return o}
function sma(v,p){if(!Array.isArray(v)||v.length<p)return null;const s=v.slice(-p).map(Number);return s.every(Number.isFinite)?s.reduce((a,b)=>a+b,0)/p:null}
function adxSeries(r,p=14){const o=Array(r.length).fill(null),tr=Array(r.length).fill(0),pd=Array(r.length).fill(0),md=Array(r.length).fill(0);for(let i=1;i<r.length;i++){const h=finite(r[i].high),l=finite(r[i].low),ph=finite(r[i-1].high),pl=finite(r[i-1].low),pc=finite(r[i-1].close);if([h,l,ph,pl,pc].some(x=>x==null))continue;const up=h-ph,dn=pl-l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}let tn=0,pn=0,mn=0;for(let i=1;i<=p&&i<r.length;i++){tn+=tr[i];pn+=pd[i];mn+=md[i]}const dx=Array(r.length).fill(null);for(let i=p;i<r.length;i++){if(i>p){tn=tn-tn/p+tr[i];pn=pn-pn/p+pd[i];mn=mn-mn/p+md[i]}if(!(tn>0))continue;const a=100*pn/tn,b=100*mn/tn,d=a+b;if(d>0)dx[i]=100*Math.abs(a-b)/d}let seed=0,count=0;for(let i=p;i<r.length;i++){if(!Number.isFinite(dx[i]))continue;if(count<p){seed+=dx[i];count++;if(count===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o}
function barKey(b){return String(b?.timestamp??b?.datetime??b?.time??b?.date??'')}
function wait(status,extra={}){return{ready:false,status,pair:CONFIG.pair,strategyId:CONFIG.id,strategyLabel:CONFIG.label,...extra}}

async function scanGrokGold92Strategy(){
 const pair=CONFIG.pair;
 // Same unified live-gold candle stream as the other portfolio strategies.
 const [raw5,raw1h,livePrice]=await Promise.all([getGoldCandlesResilient('5min',150),getGoldCandlesResilient('1h',260),getPrice(pair)]);
 const c5=closedBars(raw5),c1h=closedBars(raw1h);if(c5.length<60||c1h.length<230)return wait('GROK92_NO_DATA',{m5Count:c5.length,h1Count:c1h.length});
 const cc=closes(c5),e9=emaSeries(cc,CONFIG.fastEma),e21=emaSeries(cc,CONFIG.slowEma),rs=rsiSeries(cc,CONFIG.rsiPeriod),as=atrSeries(c5,CONFIG.atrPeriod),i=c5.length-1,prev=i-1,rsi5=rs[i],atr5=as[i];
 if(![e9[i],e21[i],e9[prev],e21[prev],rsi5,atr5].every(Number.isFinite)||!(atr5>0))return wait('GROK92_M5_INDICATORS_NOT_READY');
 const up=e9[prev]<=e21[prev]&&e9[i]>e21[i],dn=e9[prev]>=e21[prev]&&e9[i]<e21[i];let side=null;if(up&&rsi5>CONFIG.rsiBuyMin)side='BUY';if(dn&&rsi5<CONFIG.rsiSellMax)side='SELL';if(!side)return wait('GROK92_NO_EMA_RSI_TRIGGER',{rsi5,ema9:e9[i],ema21:e21[i]});
 const emaGapAtr=Math.abs(e9[i]-e21[i])/atr5;if(emaGapAtr<CONFIG.emaGapAtr)return wait('GROK92_EMA_GAP_TOO_SMALL',{side,rsi5,atr5,emaGapAtr});
 const volumes=c5.map(x=>finite(x.volume)??0),volAvg=sma(volumes.slice(0,-1),CONFIG.volumePeriod),signalVolume=volumes.at(-1);if(!(volAvg>0)||!(signalVolume>=volAvg*CONFIG.volumeSpikeMult))return wait('GROK92_VOLUME_NOT_SPIKE',{side,rsi5,atr5,signalVolume,volumeAverage:volAvg,volumeRatio:volAvg>0?signalVolume/volAvg:null});
 const hc=closes(c1h),h1Ema200=ema(hc,200),ha=atrSeries(c1h,CONFIG.atrPeriod),hd=adxSeries(c1h,CONFIG.atrPeriod),h=c1h.length-1,h1CloseNow=finite(c1h[h].close),h1Atr=ha[h],h1Adx=hd[h];if(![h1CloseNow,h1Ema200,h1Atr,h1Adx].every(Number.isFinite)||!(h1Atr>0))return wait('GROK92_H1_INDICATORS_NOT_READY',{side,rsi5,atr5});if(h1Adx<CONFIG.adxMin)return wait('GROK92_H1_ADX_TOO_WEAK',{side,rsi5,atr5,h1Adx});
 const h1Bias=h1CloseNow>h1Ema200?'BUY':h1CloseNow<h1Ema200?'SELL':null;if(side!==h1Bias)return wait('GROK92_H1_BIAS_MISMATCH',{side,h1Bias,rsi5,atr5,h1Adx});const h1Distance=Math.abs(h1CloseNow-h1Ema200)/h1Atr;if(h1Distance<CONFIG.h1DistanceAtr)return wait('GROK92_H1_TOO_CLOSE_EMA200',{side,h1Bias,h1Adx,h1Distance});
 const signalBar=c5[i],signalKey=barKey(signalBar);if(signalKey&&STATE.lastSentSignalBar===signalKey)return wait('GROK92_SIGNAL_ALREADY_SENT',{side,signalKey});const entry=finite(livePrice)??finite(raw5?.at(-1)?.close)??finite(signalBar.close);if(!Number.isFinite(entry))return wait('GROK92_NO_LIVE_PRICE',{side});const risk=atr5*CONFIG.stopAtr,stopLoss=side==='BUY'?entry-risk:entry+risk,target=side==='BUY'?entry+risk*CONFIG.rewardR:entry-risk*CONFIG.rewardR;STATE.pendingSignalBar=signalKey||null;
 const score=Math.min(100,Math.round(72+Math.min(10,Math.max(0,(h1Adx-CONFIG.adxMin)*.8))+Math.min(8,emaGapAtr*40)+Math.min(10,Math.max(0,(signalVolume/volAvg-CONFIG.volumeSpikeMult)*12))));
 return{ready:true,status:'GROK92_READY',pair,direction:side,strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'EMA_CROSS_VOLUME_H1_REGIME',grade:'A',score,aiConfidence:0,entry,stopLoss,tp1:target,tp2:target,risk,rrTp1:CONFIG.rewardR,rrTp2:CONFIG.rewardR,atr5,rsi5,adx5:null,adx15:null,h1Adx,h1Bias,h1Ema200,h1Atr,h1Distance,ema9:e9[i],ema21:e21[i],emaGapAtr,signalVolume,volumeAverage:volAvg,volumeRatio:signalVolume/volAvg,signalBar:signalKey,reasons:['5M EMA9/21 fresh cross',`RSI ${side==='BUY'?'>':'<'} ${side==='BUY'?CONFIG.rsiBuyMin:CONFIG.rsiSellMax}`,`5M volume >= ${CONFIG.volumeSpikeMult}x average`,`EMA gap >= ${CONFIG.emaGapAtr} ATR`,`H1 ADX >= ${CONFIG.adxMin}`,'H1 price aligned with EMA200',`H1 distance >= ${CONFIG.h1DistanceAtr} ATR`,'All-day scan enabled','Unified Binance PAXG proxy candles',`SL ${CONFIG.stopAtr} ATR / TP ${CONFIG.rewardR}R`]};
}
function markSent(){STATE.lastSentAt=Date.now();if(STATE.pendingSignalBar){STATE.lastSentSignalBar=STATE.pendingSignalBar;STATE.pendingSignalBar=null}}
module.exports={CONFIG,scan:scanGrokGold92Strategy,markSent};
