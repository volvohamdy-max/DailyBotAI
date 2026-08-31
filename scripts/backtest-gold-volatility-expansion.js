#!/usr/bin/env node
'use strict';

/*
 * GOLD VOLATILITY COMPRESSION -> EXPANSION
 * Research-only backtest. Does NOT touch live strategies.
 *
 * Idea:
 * 1) M5 volatility compresses relative to its recent baseline.
 * 2) A strong expansion candle closes outside the compression range.
 * 3) Enter with breakout direction using ATR-based SL and configurable RR.
 *
 * Usage:
 *   node scripts/backtest-gold-volatility-expansion.js
 * Optional env:
 *   FROM=2025-08-31 TO=2026-08-31 node scripts/backtest-gold-volatility-expansion.js
 */

const { getCandles } = require('../src/services/marketService');

const FROM = process.env.FROM || '2025-08-31';
const TO = process.env.TO || '2026-08-31';
const PAIR = 'XAUUSD';

const P = {
  atrPeriod: 14,
  baselineBars: 48,
  compressionBars: 8,
  compressionRatio: 0.72,
  rangeAtrMax: 2.20,
  expansionAtr: 1.10,
  bodyMin: 0.62,
  closePos: 0.78,
  breakoutAtr: 0.05,
  slAtr: 0.90,
  rr: 1.35,
  maxBars: 12,
  hoursUTC: new Set([6,7,8,9,10,11,12,13,14,15,16,17,18,19])
};

const n = v => Number(v);
const ts = c => new Date(c.datetime || c.time || c.timestamp || c.date).getTime();
const tr = (c,p) => Math.max(n(c.high)-n(c.low), Math.abs(n(c.high)-n(p.close)), Math.abs(n(c.low)-n(p.close)));
function atr(c,i,period=P.atrPeriod){if(i<period)return NaN;let s=0;for(let k=i-period+1;k<=i;k++)s+=tr(c[k],c[k-1]);return s/period;}
function avgAtr(c,i,bars){if(i<bars+P.atrPeriod)return NaN;let s=0,count=0;for(let k=i-bars+1;k<=i;k++){const a=atr(c,k);if(Number.isFinite(a)){s+=a;count++;}}return count?s/count:NaN;}
function stats(trades){let wins=0,losses=0,net=0,gp=0,gl=0,peak=0,dd=0,ls=0,maxLs=0;for(const t of trades){net+=t.r; if(t.r>0){wins++;gp+=t.r;ls=0}else{losses++;gl+=Math.abs(t.r);ls++;maxLs=Math.max(maxLs,ls)}peak=Math.max(peak,net);dd=Math.max(dd,peak-net)}return{trades:trades.length,wins,losses,wr:trades.length?wins/trades.length*100:0,pf:gl?gp/gl:gp?Infinity:0,net,dd,maxLs};}
function print(label,x){console.log(`${label.padEnd(12)} T ${String(x.trades).padStart(4)} | W ${String(x.wins).padStart(4)} | L ${String(x.losses).padStart(4)} | WR ${x.wr.toFixed(1)}% | PF ${Number.isFinite(x.pf)?x.pf.toFixed(2):'INF'} | Net ${x.net>=0?'+':''}${x.net.toFixed(2)}R | DD ${x.dd.toFixed(2)}R | LS ${x.maxLs}`);}

function generate(c){const out=[];let busyUntil=-1;for(let i=Math.max(80,P.baselineBars+P.compressionBars+P.atrPeriod);i<c.length-2;i++){
  if(i<=busyUntil)continue;
  const cur=c[i], hour=new Date(ts(cur)).getUTCHours(); if(!P.hoursUTC.has(hour))continue;
  const a=atr(c,i-1), base=avgAtr(c,i-1,P.baselineBars); if(!Number.isFinite(a)||!Number.isFinite(base)||a<=0)continue;
  const start=i-P.compressionBars, comp=c.slice(start,i);
  const hi=Math.max(...comp.map(x=>n(x.high))), lo=Math.min(...comp.map(x=>n(x.low))), width=hi-lo;
  let compAtr=0; for(let k=start;k<i;k++)compAtr+=atr(c,k); compAtr/=P.compressionBars;
  if(!(compAtr/base<=P.compressionRatio))continue;
  if(width/a>P.rangeAtrMax)continue;
  const range=n(cur.high)-n(cur.low), body=Math.abs(n(cur.close)-n(cur.open)); if(range<=0)continue;
  if(range/a<P.expansionAtr||body/range<P.bodyMin)continue;
  const pos=(n(cur.close)-n(cur.low))/range;
  let side=null;
  if(n(cur.close)>hi+P.breakoutAtr*a && pos>=P.closePos)side='BUY';
  else if(n(cur.close)<lo-P.breakoutAtr*a && pos<=1-P.closePos)side='SELL';
  if(!side)continue;
  const entry=n(cur.close), risk=P.slAtr*a, sl=side==='BUY'?entry-risk:entry+risk, tp=side==='BUY'?entry+risk*P.rr:entry-risk*P.rr;
  let r=0,exit=i+P.maxBars;
  for(let j=i+1;j<=Math.min(c.length-1,i+P.maxBars);j++){
    const h=n(c[j].high),l=n(c[j].low); const hitSL=side==='BUY'?l<=sl:h>=sl, hitTP=side==='BUY'?h>=tp:l<=tp;
    if(hitSL&&hitTP){r=-1;exit=j;break} // conservative same-bar tie
    if(hitSL){r=-1;exit=j;break}
    if(hitTP){r=P.rr;exit=j;break}
    if(j===Math.min(c.length-1,i+P.maxBars)){const px=n(c[j].close);r=Math.max(-1,Math.min(P.rr,(side==='BUY'?px-entry:entry-px)/risk));exit=j;}
  }
  out.push({time:ts(cur),side,r}); busyUntil=exit;
 }return out;}

(async()=>{
 console.log('🌋 GOLD VOLATILITY COMPRESSION → EXPANSION — RESEARCH ONLY');
 console.log(`Period: ${FROM} → ${TO}`);
 console.log('Loading XAUUSD M5 candles...');
 let candles=await getCandles(PAIR,'5min',500000);
 candles=(candles||[]).filter(c=>{const t=ts(c);return Number.isFinite(t)&&t>=Date.parse(`${FROM}T00:00:00Z`)&&t<=Date.parse(`${TO}T23:59:59Z`);}).sort((a,b)=>ts(a)-ts(b));
 if(candles.length<500)throw new Error(`Not enough M5 candles: ${candles.length}`);
 console.log(`Candles: ${candles.length}`);
 const trades=generate(candles);
 print('FULL',stats(trades)); print('BUY',stats(trades.filter(x=>x.side==='BUY'))); print('SELL',stats(trades.filter(x=>x.side==='SELL')));
 const split=Date.parse(`${TO}T00:00:00Z`)-90*86400000; print('PRE-3M',stats(trades.filter(x=>x.time<split))); print('LAST-3M',stats(trades.filter(x=>x.time>=split)));
 const years=[...new Set(trades.map(x=>new Date(x.time).getUTCFullYear()))]; for(const y of years)print(String(y),stats(trades.filter(x=>new Date(x.time).getUTCFullYear()===y)));
 console.log('\nPARAMS',JSON.stringify({...P,hoursUTC:[...P.hoursUTC]}));
 console.log('\nResearch gate: do NOT promote from this result alone. Validate/optimize fast, then test portfolio correlation.');
})().catch(e=>{console.error('❌',e.stack||e.message);process.exit(1);});
