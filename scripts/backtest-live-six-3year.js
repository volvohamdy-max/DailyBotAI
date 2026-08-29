#!/usr/bin/env node
'use strict';

/*
 * 3-year robustness test for the canonical exact six-live gold portfolio.
 * NO optimization and NO live strategy changes.
 * Uses the same exact engine, Dukascopy M5 cache, and MAX OPEN = 2.
 * Default: 2023-08-29 -> 2026-08-29.
 */
const {spawnSync}=require('child_process');
const path=require('path');
const FROM=process.argv[2]||'2023-08-29';
const TO=process.argv[3]||'2026-08-29';
const engine=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 THREE-YEAR ROBUSTNESS — SIX LIVE GOLD');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🧬 SAME EXACT CONDITIONS | NO OPTIMIZATION');
console.log('📦 Dukascopy M5 cache reused/fills missing history');
console.log('🛡️ Portfolio MAX OPEN = 2');
console.log('🔒 Live strategies/VIP routing untouched');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
const r=spawnSync(process.execPath,[engine,FROM,TO],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',env:process.env});
if(r.error){console.error('❌ 3Y BACKTEST FAILED:',r.error.message);process.exit(1)}
process.exit(r.status===null?1:r.status);