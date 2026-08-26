#!/usr/bin/env node
'use strict';
// Reuses the proven exact 6-strategy runner without duplicating strategy rules.
// It temporarily intercepts dukascopy-node getHistoricalRates and supplies the
// downloaded Binance PAXGUSDT M5 dataset. Thus the ONLY changed dimension is data source.
const fs=require('fs'),path=require('path'),Module=require('module');
const FROM=process.argv[2]||'2025-08-24',TO=process.argv[3]||'2026-08-24';
const FILE=path.resolve(`data/paxg-m5-${FROM}-${TO}.json`);
if(!fs.existsSync(FILE)){console.error(`❌ Missing ${FILE}\nRun first: node scripts/download-binance-paxg-m5-history.js ${FROM} ${TO}`);process.exit(1)}
const rows=JSON.parse(fs.readFileSync(FILE,'utf8'));
if(!Array.isArray(rows)||rows.length<1000){console.error(`❌ Invalid/short PAXG dataset: ${rows?.length||0}`);process.exit(1)}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🪙 EXACT LIVE GOLD PORTFOLIO — BINANCE PAXG');
console.log(`📅 ${FROM} → ${TO} | M5=${rows.length}`);
console.log('📌 Same 6 strategy rules; data source changed only');
console.log('⚠️ PAXG native prices; no look-ahead historical spot calibration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const original=Module._load;
Module._load=function(request,parent,isMain){if(request==='dukascopy-node')return{getHistoricalRates:async()=>rows};return original.apply(this,arguments)};
process.argv=[process.argv[0],path.resolve('scripts/backtest-live-gold-portfolio-6-exact.js'),FROM,TO];
require(path.resolve('scripts/backtest-live-gold-portfolio-6-exact.js'));
