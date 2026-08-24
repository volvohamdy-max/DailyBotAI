'use strict';
require('dotenv').config();

const { getGoldHistoricalCandles } = require('./backtestHistoryV21');
const strategy = require('../src/services/scalpStrategies/goldPullbackContinuationStrategy');

const HISTORY = Math.max(10000, Math.min(60000, Number(process.env.BACKTEST_HISTORY || 60000)));
const SPREAD = Math.max(0, Number(process.env.BACKTEST_SPREAD_USD || 0.35));
const SLIP = Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_USD || 0.05));
const TP_RS = [1.0, 1.3, 1.6, 2.0];
const PARAMS = [
  { impulseAtr: 1.5, reclaimBodyAtr: 0.25, pullbackTolAtr: 0.20 },
  { impulseAtr: 1.8, reclaimBodyAtr: 0.35, pullbackTolAtr: 0.25 },
  { impulseAtr: 2.1, reclaimBodyAtr: 0.40, pullbackTolAtr: 0.30 }
];

function trade(c, i, s, tpR) {
  if (i + 1 >= c.length || !(s.atr > 0)) return null;
  const entry = s.side === 'BUY' ? c[i + 1].open + SLIP : c[i + 1].open - SLIP;
  const swing = s.side === 'BUY'
    ? Math.min(...c.slice(Math.max(0, i - 5), i + 1).map(x => x.low))
    : Math.max(...c.slice(Math.max(0, i - 5), i + 1).map(x => x.high));
  const structural = s.side === 'BUY' ? entry - swing : swing - entry;
  const risk = Math.max(structural + s.atr * 0.10, s.atr * 0.65);
  const sl = s.side === 'BUY' ? entry - risk : entry + risk;
  const tp = s.side === 'BUY' ? entry + risk * tpR : entry - risk * tpR;
  return { side: s.side, entryIndex: i + 1, entry, sl, tp, risk, tpR, costR: (SPREAD + 2 * SLIP) / risk };
}

function resolve(c, t, maxBars = 36) {
  const end = Math.min(c.length - 1, t.entryIndex + maxBars);
  for (let k = t.entryIndex; k <= end; k++) {
    const x = c[k];
    const sl = t.side === 'BUY' ? x.low <= t.sl : x.high >= t.sl;
    const tp = t.side === 'BUY' ? x.high >= t.tp : x.low <= t.tp;
    if (sl && tp) return { ...t, exitIndex: k, r: -1 - t.costR };
    if (sl) return { ...t, exitIndex: k, r: -1 - t.costR };
    if (tp) return { ...t, exitIndex: k, r: t.tpR - t.costR };
  }
  const px = c[end].close;
  const gross = t.side === 'BUY' ? (px - t.entry) / t.risk : (t.entry - px) / t.risk;
  return { ...t, exitIndex: end, r: gross - t.costR };
}

function stats(ts) {
  let wins=0, gw=0, gl=0, eq=0, peak=0, dd=0, ls=0, maxLS=0;
  for (const t of ts) {
    eq += t.r;
    if (t.r > 0) { wins++; gw += t.r; ls=0; } else { gl += Math.abs(t.r); ls++; maxLS=Math.max(maxLS,ls); }
    peak=Math.max(peak,eq); dd=Math.max(dd,peak-eq);
  }
  return { trades:ts.length, wr:ts.length?wins/ts.length*100:0, net:eq, pf:gl?gw/gl:gw?999:0, dd, maxLS };
}

function run(c, p, tpR, from, to) {
  const out=[]; let free=from;
  for (let i=Math.max(from,60); i<Math.min(to,c.length-2); i++) {
    if (i<free) continue;
    const s=strategy.detectAt(c,i,p); if(!s) continue;
    const t=trade(c,i,s,tpR); if(!t) continue;
    const d=resolve(c,t); out.push(d); free=d.exitIndex+1;
  }
  return out;
}

function fmt(s){return `${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.maxLS}`;}

(async()=>{
  const raw=await getGoldHistoricalCandles('5min',HISTORY);
  const c=strategy.normalize(raw);
  const split=Math.floor(c.length*0.70);
  const rows=[];
  for(const p of PARAMS) for(const tpR of TP_RS){
    const dev=stats(run(c,p,tpR,0,split));
    const oos=stats(run(c,p,tpR,split,c.length));
    const score=(Math.min(dev.pf,oos.pf)*2)+(Math.min(dev.wr,oos.wr)/100)+Math.min(dev.net,oos.net)*0.02-(dev.dd+oos.dd)*0.03;
    rows.push({p,tpR,dev,oos,score});
  }
  rows.sort((a,b)=>b.score-a.score);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('GOLD PULLBACK CONTINUATION — RESEARCH');
  console.log(`XAUUSD M5 | candles=${c.length} | DEV 70% / OOS 30% | spread=$${SPREAD} slip=$${SLIP}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for(const x of rows.slice(0,8)){
    console.log(`\nparams=${JSON.stringify(x.p)} TP=${x.tpR}R`);
    console.log(`DEV ${fmt(x.dev)}`);
    console.log(`OOS ${fmt(x.oos)}`);
  }
})().catch(e=>{console.error(e);process.exit(1);});
