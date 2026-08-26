#!/usr/bin/env node
'use strict';

/*
 * LIVE EXECUTION FUNNEL AUDIT
 *
 * Purpose: take the fresh live-source-of-truth backtest trade stream and apply
 * execution constraints that exist after a strategy becomes READY in live.
 * This file deliberately does NOT import old backtest results.
 *
 * Input: JSON emitted by the fresh live-source backtest. Pass a path as argv[2]
 * or set LIVE_BACKTEST_JSON. Supported shapes: array, {trades:[]},
 * {rawTrades:[]}, {allTrades:[]}.
 *
 * Required trade fields (aliases supported): strategy id, entry/open time,
 * exit/close time, result R. Optional fields used for entry-gap audit:
 * livePrice/goldPrice and signalClose/proxyClose plus ATR and maxEntryGapAtr.
 */

const fs = require('fs');
const path = require('path');

const input = process.argv[2] || process.env.LIVE_BACKTEST_JSON;
if (!input) {
  console.error('Usage: node scripts/audit-live-execution-funnel.js <fresh-live-backtest.json>');
  process.exit(1);
}

const full = path.resolve(input);
if (!fs.existsSync(full)) {
  console.error(`❌ Input not found: ${full}`);
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : parsed.trades || parsed.rawTrades || parsed.allTrades || [];
if (!Array.isArray(rows) || !rows.length) {
  console.error('❌ No trade array found. Expected [], trades, rawTrades or allTrades.');
  process.exit(1);
}

const pick = (o, keys) => { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return null; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const ms = v => { if (v === null || v === undefined) return null; if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; const n=Date.parse(v); return Number.isFinite(n)?n:null; };

function normalize(t, i) {
  const strategy = String(pick(t,['strategyId','strategy','id','strategy_id']) || 'UNKNOWN').toUpperCase();
  const open = ms(pick(t,['entryTime','openTime','time','timestamp','entry_time','openedAt']));
  const close = ms(pick(t,['exitTime','closeTime','exit_time','closedAt'])) ?? open;
  const r = num(pick(t,['r','netR','resultR','pnlR','R'])) ?? 0;
  const livePrice = num(pick(t,['livePrice','goldPrice','entryLivePrice']));
  const signalClose = num(pick(t,['signalClose','proxyClose','candleClose','setupClose']));
  const atr = num(pick(t,['atr','atr5']));
  const maxGapAtr = num(pick(t,['maxEntryGapAtr','entryGapAtrMax']));
  return { raw:t, i, strategy, open, close: Math.max(close ?? open ?? 0, open ?? 0), r, livePrice, signalClose, atr, maxGapAtr };
}

const trades = rows.map(normalize).filter(t=>t.open!==null).sort((a,b)=>a.open-b.open || a.i-b.i);
let rejectedGap=0, gapNotAuditable=0, rejectedSameStrategy=0, rejectedMax2=0;
const accepted=[];
const open=[];
const byStrategy={};

for (const t of trades) {
  while (open.length && open[0].close <= t.open) open.shift();

  // Entry-gap is only rejected when the fresh replay exported enough live-like
  // price information and the strategy exported its threshold. Never invent it.
  if (t.livePrice!==null && t.signalClose!==null && t.atr>0 && t.maxGapAtr!==null) {
    const gapAtr=Math.abs(t.livePrice-t.signalClose)/t.atr;
    if (gapAtr > t.maxGapAtr) { rejectedGap++; continue; }
  } else gapNotAuditable++;

  if (open.some(x=>x.strategy===t.strategy)) { rejectedSameStrategy++; continue; }
  if (open.length >= 2) { rejectedMax2++; continue; }

  accepted.push(t);
  open.push(t); open.sort((a,b)=>a.close-b.close);
  byStrategy[t.strategy] ||= {accepted:0, netR:0};
  byStrategy[t.strategy].accepted++; byStrategy[t.strategy].netR += t.r;
}

const wins=accepted.filter(t=>t.r>0).length;
const losses=accepted.filter(t=>t.r<0).length;
const netR=accepted.reduce((s,t)=>s+t.r,0);
const grossWin=accepted.reduce((s,t)=>s+Math.max(0,t.r),0);
const grossLoss=Math.abs(accepted.reduce((s,t)=>s+Math.min(0,t.r),0));
let equity=0, peak=0, dd=0;
for(const t of accepted){equity+=t.r;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}

console.log('\n━━━━━━━━ LIVE EXECUTION FUNNEL ━━━━━━━━');
console.log(`RAW READY SETUPS        ${trades.length}`);
console.log(`ENTRY-GAP REJECTED      ${rejectedGap}`);
console.log(`ENTRY-GAP NOT AUDITABLE ${gapNotAuditable}`);
console.log(`SAME STRATEGY OPEN      ${rejectedSameStrategy}`);
console.log(`MAX OPEN 2              ${rejectedMax2}`);
console.log(`FINAL ACCEPTED          ${accepted.length}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`WR ${accepted.length?(wins/accepted.length*100).toFixed(1):'0.0'}% | Net ${netR>=0?'+':''}${netR.toFixed(2)}R | PF ${grossLoss?(grossWin/grossLoss).toFixed(2):'∞'} | DD ${dd.toFixed(2)}R | W ${wins} L ${losses}`);
console.log('\n📦 ACCEPTED BY STRATEGY');
for(const [id,s] of Object.entries(byStrategy).sort()) console.log(`${id.padEnd(24)} ${String(s.accepted).padStart(5)} | Net ${s.netR>=0?'+':''}${s.netR.toFixed(2)}R`);

if (gapNotAuditable) {
  console.log('\n⚠️ ENTRY-GAP NOTE');
  console.log('Some/all rows lack historical GoldAPI-vs-proxy price + ATR + live threshold.');
  console.log('Those rows were NOT rejected. Export those fields from a fresh live-source replay to measure entry-gap exactly.');
}
