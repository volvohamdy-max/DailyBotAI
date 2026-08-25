'use strict';

const { getGoldCandlesResilient } = require('../goldCandleRecovery');
const { getPrice } = require('../marketService');

const CONFIG = {
  id: 'GOLD_SWEEP_5',
  label: '🌊 Gold Sweep 5',
  pair: 'XAUUSD',
  lookback: 6,
  sweepAtr: 0.04,
  upperWickMin: 0.60,
  priorMoveAtr: 0.50,
  sessionUTC: [9, 13],
  tpUsd: 5,
  slUsd: 5,
  maxBars: 4
};

const STATE = { lastSignalBar: null };
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
function closed(rows) { return Array.isArray(rows) && rows.length > 1 ? rows.slice(0, -1) : []; }
function wait(status, extra = {}) { return { ready:false, status, pair:CONFIG.pair, strategyId:CONFIG.id, strategyLabel:CONFIG.label, ...extra }; }
function atrSeries(c,p=14){const o=Array(c.length).fill(null),q=[];let s=0;for(let i=1;i<c.length;i++){const pc=+c[i-1].close,tr=Math.max(+c[i].high-+c[i].low,Math.abs(+c[i].high-pc),Math.abs(+c[i].low-pc));q.push(tr);s+=tr;if(q.length>p)s-=q.shift();if(q.length===p)o[i]=s/p;}return o;}

async function scan() {
  const [raw, liveRaw] = await Promise.all([
    getGoldCandlesResilient('5min', 150),
    getPrice('XAUUSD')
  ]);
  const c = closed(raw);
  if (c.length < 30) return wait('SWEEP5_NO_DATA', { bars:c.length });

  const i = c.length - 1;
  const bar = c[i];
  const hourUTC = new Date(bar.timestamp).getUTCHours();
  if (hourUTC < CONFIG.sessionUTC[0] || hourUTC >= CONFIG.sessionUTC[1]) return wait('SWEEP5_OUTSIDE_SESSION', { hourUTC });

  const A = atrSeries(c, 14), atr5 = A[i];
  if (!(atr5 > 0)) return wait('SWEEP5_ATR_NOT_READY');

  let priorHigh = -Infinity;
  for (let k=i-CONFIG.lookback;k<i;k++) priorHigh=Math.max(priorHigh,+c[k].high);
  const open=+bar.open, high=+bar.high, low=+bar.low, close=+bar.close, range=high-low;
  if (!(range > 0)) return wait('SWEEP5_BAD_RANGE');

  const upperWick = (high-Math.max(open,close))/range;
  const priorMove = Math.abs(+c[i-1].close - +c[i-3].close);
  if (high < priorHigh + atr5*CONFIG.sweepAtr) return wait('SWEEP5_NO_HIGH_SWEEP', { priorHigh, high, atr5 });
  if (!(close < priorHigh)) return wait('SWEEP5_NO_RECLAIM');
  if (!(close < open)) return wait('SWEEP5_NOT_BEARISH');
  if (upperWick < CONFIG.upperWickMin) return wait('SWEEP5_WICK_TOO_SMALL', { upperWick });
  if (priorMove < atr5*CONFIG.priorMoveAtr) return wait('SWEEP5_PRIOR_MOVE_WEAK', { priorMove, atr5 });

  const signalBar=String(bar.timestamp);
  if (STATE.lastSignalBar===signalBar) return wait('SWEEP5_SIGNAL_ALREADY_SENT');
  const entry=finite(liveRaw);
  if (entry===null) return wait('SWEEP5_NO_LIVE_PRICE');

  // Backtest enters next M5 open. Keep live execution close to the validated signal close.
  if (Math.abs(entry-close) > atr5*0.30) return wait('SWEEP5_ENTRY_GAP_TOO_LARGE', { entry, signalClose:close, atr5 });

  const stopLoss=entry+CONFIG.slUsd;
  const target=entry-CONFIG.tpUsd;
  return {
    ready:true,
    status:'SWEEP5_READY',
    pair:CONFIG.pair,
    direction:'SELL',
    strategyId:CONFIG.id,
    strategyLabel:CONFIG.label,
    entryMode:'M5_LB6_SWEEP_REJECTION',
    grade:'A',
    score:90,
    aiConfidence:0,
    entry,
    stopLoss,
    tp1:target,
    tp2:target,
    risk:CONFIG.slUsd,
    rrTp1:1,
    rrTp2:1,
    atr5,
    hourUTC,
    signalBar,
    priorHigh,
    upperWick,
    priorMove,
    maxBars:CONFIG.maxBars,
    reasons:['SELL only','LB6 high sweep >= 0.04 ATR','Bearish reclaim below prior high','Upper wick >= 60%','Prior move >= 0.5 ATR','UTC 09:00-13:00','Fixed $5 TP / $5 SL'] ,
    markSent:()=>{STATE.lastSignalBar=signalBar;}
  };
}

function markSent() {}
module.exports={CONFIG,scan,markSent};
