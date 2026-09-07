#!/usr/bin/env node
'use strict';

// READ-ONLY research runner for AUTO TRADE CHECK.
// Replays the deterministic technical side of the live rule on Dukascopy XAUUSD M5.
// AI calls are deliberately NOT replayed: historical OpenAI responses are unavailable/non-deterministic.
// Direction therefore uses the exact technical 3-of-4 gate from analysisService; score uses the exact
// weights/ranges from hourlyMarketBiasTrade.js. Entries are next-bar open, one trade at a time, $7/$7.

const fs = require('fs');
const path = require('path');
const analyzeIndicators = require('../src/indicators/analyzer');

const FILE = path.join(__dirname, '../data/xauusd-m5-dukascopy.json');
const LIMIT = Math.max(1000, Number(process.env.BACKTEST_CANDLES || 50000));
const HOLD_BARS = Math.max(1, Number(process.env.BACKTEST_HOLD_BARS || 288)); // max 24h safety exit
const SCORES = [70, 80, 90];
const DIST = 7;

function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function load(){
  if(!fs.existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  let raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
  if(!Array.isArray(raw)) raw=raw.candles||raw.data||raw.values||[];
  let c=raw.map(x=>({
    timestamp:num(x.timestamp??x.time??x.datetime??x.date),
    open:num(x.open??x.o), high:num(x.high??x.h), low:num(x.low??x.l), close:num(x.close??x.c)
  })).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  if(c.length && c[0].timestamp<1e12) c.forEach(x=>x.timestamp*=1000);
  return c.slice(-LIMIT);
}
function technicalDirection(ind){
  let buy=0,sell=0;
  if(ind.ema20>ind.ema50) buy++; else if(ind.ema20<ind.ema50) sell++;
  if(ind.rsi>50) buy++; else if(ind.rsi<50) sell++;
  if(ind.macd?.macd>ind.macd?.signal) buy++; else if(ind.macd?.macd<ind.macd?.signal) sell++;
  if(Number(ind.adx)>=20){ if(buy>sell) buy++; else if(sell>buy) sell++; }
  if(buy>=3&&buy>sell) return 'BUY';
  if(sell>=3&&sell>buy) return 'SELL';
  return null;
}
function marketScore(ind,dir){
  let score=35; // direction agrees with deterministic technical market direction
  if(dir==='BUY'&&ind.ema20>ind.ema50) score+=20;
  if(dir==='SELL'&&ind.ema20<ind.ema50) score+=20;
  if(dir==='BUY'&&ind.rsi>=50&&ind.rsi<=70) score+=15;
  if(dir==='SELL'&&ind.rsi<=50&&ind.rsi>=30) score+=15;
  if(dir==='BUY'&&ind.macd?.macd>ind.macd?.signal) score+=15;
  if(dir==='SELL'&&ind.macd?.macd<ind.macd?.signal) score+=15;
  if(Number(ind.adx)>=25) score+=15;
  return Math.min(100,score);
}
function resolve(c,from,dir,entry){
  const sl=dir==='BUY'?entry-DIST:entry+DIST, tp=dir==='BUY'?entry+DIST:entry-DIST;
  const end=Math.min(c.length-1,from+HOLD_BARS-1);
  for(let j=from;j<=end;j++){
    const loss=dir==='BUY'?c[j].low<=sl:c[j].high>=sl;
    const win=dir==='BUY'?c[j].high>=tp:c[j].low<=tp;
    // Conservative ambiguity rule: if both touched inside one M5 candle, count SL first.
    if(loss||win) return {r:loss?-1:1,exit:j,ambiguous:loss&&win};
  }
  const move=dir==='BUY'?c[end].close-entry:entry-c[end].close;
  return {r:Math.max(-1,Math.min(1,move/DIST)),exit:end,ambiguous:false};
}
function stats(t){
  let wins=0,losses=0,net=0,peak=0,dd=0,ls=0,maxLs=0,grossWin=0,grossLoss=0,amb=0;
  for(const x of t){
    net+=x.r; peak=Math.max(peak,net); dd=Math.max(dd,peak-net); if(x.ambiguous)amb++;
    if(x.r>0){wins++;grossWin+=x.r;ls=0}else if(x.r<0){losses++;grossLoss-=x.r;ls++;maxLs=Math.max(maxLs,ls)}
  }
  return {n:t.length,wins,losses,wr:t.length?100*wins/t.length:0,pf:grossLoss?grossWin/grossLoss:999,net,dd,maxLs,amb};
}
function run(c,minScore){
  const trades=[]; let i=60;
  while(i<c.length-2){
    const window=c.slice(Math.max(0,i-249),i+1);
    let ind; try{ind=analyzeIndicators(window)}catch{ i++; continue; }
    const dir=technicalDirection(ind); if(!dir){i++;continue;}
    const score=marketScore(ind,dir); if(score<minScore){i++;continue;}
    const entry=c[i+1].open; const out=resolve(c,i+1,dir,entry);
    trades.push({r:out.r,side:dir,score,ambiguous:out.ambiguous});
    i=out.exit+1; // exact portfolio behavior: only one AUTO TRADE CHECK trade open
  }
  return trades;
}
function fmt(s){return `T${s.n} W${s.wins}/L${s.losses} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(1)}R DD${s.dd.toFixed(1)}R LS${s.maxLs} Amb${s.amb}`;}

const C=load();
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🥇 AUTO TRADE CHECK — READ-ONLY DUKASCOPY BACKTEST');
console.log(`Candles: ${C.length} XAUUSD M5 | SL $7 | TP $7 | one trade at a time`);
console.log('⚠️ Historical AI responses are NOT replayed; this tests the deterministic technical gate + exact score weights.');
console.log('⚠️ Entry = next M5 open; same-candle SL+TP ambiguity is counted as SL (conservative).');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for(const min of SCORES){
  const t=run(C,min), all=stats(t), buy=stats(t.filter(x=>x.side==='BUY')), sell=stats(t.filter(x=>x.side==='SELL'));
  console.log(`\n⭐ SCORE >= ${min}`);
  console.log(`ALL  | ${fmt(all)}`);
  console.log(`BUY  | ${fmt(buy)}`);
  console.log(`SELL | ${fmt(sell)}`);
}
console.log('\n🛡️ LIVE UNCHANGED — research script only.');
