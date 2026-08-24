const { getPrice } = require('../marketService');
const { getGoldCandlesResilient } = require('../goldCandleRecovery');

const CONFIG = {
  id: 'GOLD_RANGE_MR',
  label: '🌊 Gold Range MR',
  pair: 'XAUUSD',
  adxMax: 17,
  atrLo: 0.68,
  atrHi: 1.12,
  emaSlopeMax: 0.38,
  widthMin: 2.4,
  widthMax: 5.8,
  edgeAtr: 0.28,
  edgeWidth: 0.075,
  wickMin: 0.35,
  bodyMax: 0.58,
  rsiEdge: 42,
  slMinAtr: 0.90,
  slCapAtr: 1.45,
  stopPadAtr: 0.22,
  minRR: 0.90,
  maxRR: 1.35,
  maxBars: 18
};

const STATE = { lastSentSignalBar: null };
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function closed(rows){return Array.isArray(rows)&&rows.length>1?rows.slice(0,-1):[];}
function barKey(bar){return String(bar?.timestamp??bar?.datetime??bar?.time??bar?.date??'');}
function wait(status,extra={}){return{ready:false,status,pair:CONFIG.pair,strategyId:CONFIG.id,strategyLabel:CONFIG.label,...extra};}
function emaSeries(values,p){const o=Array(values.length).fill(null),k=2/(p+1);let e=values[0];for(let i=0;i<values.length;i++){if(i)e=values[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o;}
function rsiSeries(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o;}
function atrSeries(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=finite(c[j-1]?.close),h=finite(c[j]?.high),l=finite(c[j]?.low);if([pc,h,l].some(x=>x==null)){s=NaN;break}s+=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}if(Number.isFinite(s))o[i]=s/p}return o;}
function adxSeries(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const h=finite(c[i].high),l=finite(c[i].low),ph=finite(c[i-1].high),pl=finite(c[i-1].low),pc=finite(c[i-1].close);if([h,l,ph,pl,pc].some(x=>x==null))continue;const u=h-ph,d=pl-l;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))}let T=0,P=0,M=0;for(let i=1;i<=p&&i<c.length;i++){T+=tr[i];P+=pd[i];M+=md[i]}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i]}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p}return o;}

async function scan(){
 const [raw5,livePrice]=await Promise.all([getGoldCandlesResilient('5min'),getPrice(CONFIG.pair)]);
 const c5=closed(raw5);
 // Live providers commonly expose 100 bars (99 closed). 80 is sufficient for every V2 lookback.
 if(c5.length<80)return wait('RANGE_MR_NO_DATA',{m5Count:c5.length});
 const closes=c5.map(x=>finite(x.close));if(!closes.every(Number.isFinite))return wait('RANGE_MR_BAD_DATA');
 const E20=emaSeries(closes,20),R=rsiSeries(closes,14),A=atrSeries(c5,14),D=adxSeries(c5,14),i=c5.length-1;
 if(![E20[i],E20[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0))return wait('RANGE_MR_INDICATORS_NOT_READY');
 if(D[i]>CONFIG.adxMax)return wait('RANGE_MR_ADX_TOO_HIGH',{adx5:D[i],atr5:A[i],rsi5:R[i],ema20:E20[i]});
 const sample=A.slice(i-50,i).filter(Number.isFinite);if(sample.length<45)return wait('RANGE_MR_ATR_HISTORY_NOT_READY');
 const avg=sample.reduce((a,b)=>a+b,0)/sample.length,ratio=A[i]/avg;if(ratio<CONFIG.atrLo||ratio>CONFIG.atrHi)return wait('RANGE_MR_ATR_REGIME',{atr5:A[i],atrRatio:ratio,adx5:D[i],rsi5:R[i],ema20:E20[i]});
 const slope=Math.abs(E20[i]-E20[i-6])/A[i];if(slope>CONFIG.emaSlopeMax)return wait('RANGE_MR_EMA_SLOPE',{emaSlopeAtr:slope,atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 const look=c5.slice(i-30,i),hi=Math.max(...look.map(x=>Number(x.high))),lo=Math.min(...look.map(x=>Number(x.low))),width=hi-lo;if(width<A[i]*CONFIG.widthMin||width>A[i]*CONFIG.widthMax)return wait('RANGE_MR_WIDTH',{rangeWidth:width,atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 const edge=Math.max(A[i]*CONFIG.edgeAtr,width*CONFIG.edgeWidth);let lt=0,ht=0;for(const b of look){if(Number(b.low)<=lo+edge)lt++;if(Number(b.high)>=hi-edge)ht++;}if(lt<2||ht<2)return wait('RANGE_MR_TOUCHES',{lowTouches:lt,highTouches:ht,atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 if(look.slice(-6).some(b=>Number(b.close)<lo-A[i]*.10||Number(b.close)>hi+A[i]*.10))return wait('RANGE_MR_BREAKOUT_RISK',{atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 const c=c5[i],br=Math.max(1e-9,Number(c.high)-Number(c.low)),body=Math.abs(Number(c.close)-Number(c.open))/br,lw=(Math.min(Number(c.open),Number(c.close))-Number(c.low))/br,uw=(Number(c.high)-Math.max(Number(c.open),Number(c.close)))/br,mid=(hi+lo)/2;let side=null;
 if(Number(c.low)<=lo+edge&&Number(c.close)>=lo+edge*.75&&lw>=CONFIG.wickMin&&body<=CONFIG.bodyMax&&R[i]<=CONFIG.rsiEdge)side='BUY';
 if(Number(c.high)>=hi-edge&&Number(c.close)<=hi-edge*.75&&uw>=CONFIG.wickMin&&body<=CONFIG.bodyMax&&R[i]>=100-CONFIG.rsiEdge)side='SELL';
 if(!side)return wait('RANGE_MR_NO_REJECTION',{atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 if(side==='BUY'&&(Number(c.close)<=lo||Number(c.close)>=mid))return wait('RANGE_MR_CLOSE_POSITION');if(side==='SELL'&&(Number(c.close)>=hi||Number(c.close)<=mid))return wait('RANGE_MR_CLOSE_POSITION');
 const signalKey=barKey(c);if(signalKey&&STATE.lastSentSignalBar===signalKey)return wait('RANGE_MR_SIGNAL_ALREADY_SENT',{signalKey});
 const entry=finite(livePrice)??finite(raw5?.at(-1)?.close)??finite(c.close);if(!Number.isFinite(entry))return wait('RANGE_MR_NO_LIVE_PRICE');
 const structuralStop=side==='BUY'?Math.max(A[i]*CONFIG.slMinAtr,entry-(lo-A[i]*CONFIG.stopPadAtr)):Math.max(A[i]*CONFIG.slMinAtr,(hi+A[i]*CONFIG.stopPadAtr)-entry),slDist=Math.min(structuralStop,A[i]*CONFIG.slCapAtr);if(!(slDist>0))return wait('RANGE_MR_STOP_INVALID');
 const midDistance=side==='BUY'?mid-entry:entry-mid,targetDist=Math.min(midDistance,slDist*CONFIG.maxRR),rr=targetDist/slDist;if(!(rr>=CONFIG.minRR&&rr<=CONFIG.maxRR))return wait('RANGE_MR_RR_FILTER',{rr,atr5:A[i],adx5:D[i],rsi5:R[i],ema20:E20[i]});
 const stopLoss=side==='BUY'?entry-slDist:entry+slDist,target=side==='BUY'?entry+targetDist:entry-targetDist;
 return{ready:true,status:'RANGE_MR_READY',pair:CONFIG.pair,direction:side,strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'RANGE_MEAN_REVERSION',grade:'A',score:76,aiConfidence:0,entry,stopLoss,tp1:target,tp2:target,risk:slDist,rrTp1:rr,rrTp2:rr,atr5:A[i],rsi5:R[i],adx5:D[i],ema20:E20[i],rangeHigh:hi,rangeLow:lo,rangeMid:mid,rangeWidth:width,atrRatio:ratio,emaSlopeAtr:slope,signalBar:signalKey,markSent:()=>{STATE.lastSentSignalBar=signalKey||STATE.lastSentSignalBar;},reasons:['Validated M5 range regime','Established range with repeated edge touches','Rejection candle at range edge','Low ADX / controlled ATR / flat EMA20',`SL capped at ${CONFIG.slCapAtr} ATR`,`Target ${rr.toFixed(2)}R`,`Time exit after ${CONFIG.maxBars*5} minutes`]};
}
module.exports={CONFIG,scan,emaSeries,rsiSeries,atrSeries,adxSeries};
