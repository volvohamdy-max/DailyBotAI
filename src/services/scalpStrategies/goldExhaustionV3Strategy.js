'use strict';

const { getGoldCandlesResilient } = require('../goldCandleRecovery');
const { getPrice } = require('../marketService');

const CONFIG = {
  id: 'GOLD_EXHAUSTION_V3',
  label: '🔥 Gold Exhaustion V3',
  pair: 'XAUUSD',
  hoursUTC: [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
  buy: { burstBars:3, burstATR:2.2, wick:0.30, retrace:0.20, tpATR:1.0, slATR:1.0, maxBars:3 },
  sell:{ burstBars:3, burstATR:2.6, wick:0.40, retrace:0.15, tpATR:1.0, slATR:0.75, maxBars:3 }
};

const STATE = { lastSignalBar:null };
const finite = v => { const n=Number(v); return Number.isFinite(n)?n:null; };
function closed(rows){ return Array.isArray(rows)&&rows.length>1 ? rows.slice(0,-1) : []; }
function wait(status,extra={}){ return {ready:false,status,pair:CONFIG.pair,strategyId:CONFIG.id,strategyLabel:CONFIG.label,...extra}; }
function atrSeries(c,p=14){
  const o=Array(c.length).fill(null);
  for(let i=p;i<c.length;i++){
    let s=0;
    for(let j=i-p+1;j<=i;j++){
      const pc=Number(c[j-1].close);
      s+=Math.max(Number(c[j].high)-Number(c[j].low),Math.abs(Number(c[j].high)-pc),Math.abs(Number(c[j].low)-pc));
    }
    o[i]=s/p;
  }
  return o;
}

async function scan(){
  const [raw,liveRaw]=await Promise.all([getGoldCandlesResilient('5min',150),getPrice('XAUUSD')]);
  const c=closed(raw);
  if(c.length<45) return wait('EXHAUSTION_NO_DATA',{m5:c.length});
  const A=atrSeries(c,14);
  // Backtest signal structure: burst = i-3..i-1, exhaustion=i, confirmation=i+1, entry=i+2 open.
  // In live scanning the newest closed candle is confirmation, so exhaustion is the candle immediately before it.
  const confirmIndex=c.length-1;
  const i=confirmIndex-1;
  if(i<40 || !Number.isFinite(A[i]) || !(A[i]>0)) return wait('EXHAUSTION_ATR_NOT_READY');
  const hour=new Date(c[i].timestamp).getUTCHours();
  if(!CONFIG.hoursUTC.includes(hour)) return wait('EXHAUSTION_OUTSIDE_SESSION',{hourUTC:hour});

  const start=Number(c[i-3].close), end=Number(c[i-1].close), disp=end-start;
  if(!Number.isFinite(disp) || disp===0) return wait('EXHAUSTION_NO_BURST');
  const burstSide=disp>0?'UP':'DOWN';
  const side=burstSide==='DOWN'?'BUY':'SELL';
  const q=side==='BUY'?CONFIG.buy:CONFIG.sell;
  if(Math.abs(disp)<A[i]*q.burstATR) return wait('EXHAUSTION_BURST_TOO_SMALL',{side,burstATR:Math.abs(disp)/A[i]});

  let agreeing=0;
  for(let k=i-3;k<i;k++){
    if(burstSide==='UP' && Number(c[k].close)>Number(c[k].open)) agreeing++;
    if(burstSide==='DOWN' && Number(c[k].close)<Number(c[k].open)) agreeing++;
  }
  if(agreeing<2) return wait('EXHAUSTION_BURST_NOT_DIRECTIONAL',{side,agreeing});

  const ex=c[i], range=Number(ex.high)-Number(ex.low);
  if(!(range>0)) return wait('EXHAUSTION_BAD_RANGE');
  const upper=(Number(ex.high)-Math.max(Number(ex.open),Number(ex.close)))/range;
  const lower=(Math.min(Number(ex.open),Number(ex.close))-Number(ex.low))/range;
  if(side==='BUY' && lower<q.wick) return wait('EXHAUSTION_LOWER_WICK_WEAK',{side,wick:lower});
  if(side==='SELL' && upper<q.wick) return wait('EXHAUSTION_UPPER_WICK_WEAK',{side,wick:upper});

  const confirm=c[confirmIndex];
  if(side==='BUY'){
    const trigger=Number(ex.low)+range*q.retrace;
    if(Number(confirm.close)<=trigger) return wait('EXHAUSTION_BUY_NO_RETRACE_CONFIRM',{side});
    if(Number(confirm.low)<Number(ex.low)-A[i]*0.25) return wait('EXHAUSTION_BUY_CONFIRM_INVALIDATED',{side});
  } else {
    const trigger=Number(ex.high)-range*q.retrace;
    if(Number(confirm.close)>=trigger) return wait('EXHAUSTION_SELL_NO_RETRACE_CONFIRM',{side});
    if(Number(confirm.high)>Number(ex.high)+A[i]*0.25) return wait('EXHAUSTION_SELL_CONFIRM_INVALIDATED',{side});
  }

  const signalBar=String(confirm.timestamp);
  if(STATE.lastSignalBar===signalBar) return wait('EXHAUSTION_SIGNAL_ALREADY_SENT',{side});
  const entry=finite(liveRaw);
  if(entry===null) return wait('EXHAUSTION_NO_LIVE_PRICE',{side});
  // Backtest enters at next M5 open. Reject a delayed/chased live scan rather than altering the validated setup.
  if(Math.abs(entry-Number(confirm.close))>A[i]*0.30) return wait('EXHAUSTION_ENTRY_GAP_TOO_LARGE',{side,entryGap:Math.abs(entry-Number(confirm.close)),atr5:A[i]});

  const risk=A[i]*q.slATR, reward=A[i]*q.tpATR;
  const stopLoss=side==='BUY'?entry-risk:entry+risk;
  const target=side==='BUY'?entry+reward:entry-reward;
  STATE.lastSignalBar=signalBar;
  return {
    ready:true,status:'EXHAUSTION_V3_READY',pair:CONFIG.pair,direction:side,
    strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'M5_BURST_EXHAUSTION_REVERSAL',grade:'A',score:92,aiConfidence:0,
    entry,stopLoss,tp1:target,tp2:target,risk,rrTp1:reward/risk,rrTp2:reward/risk,
    atr5:A[i],hourUTC:hour,signalBar,maxBars:q.maxBars,
    reasons:[`Validated V3 ${side}`,'3-bar directional burst','Exhaustion wick','Retrace confirmation','Backtest baseline: 217 trades | WR 59.9% | PF 1.57']
  };
}

function markSent(){}
module.exports={CONFIG,scan,markSent};
