#!/usr/bin/env node
'use strict';

/**
 * ⚡ FAST ONE-MONTH TELEGRAM PORTFOLIO ANALYZER
 * Research only — DOES NOT modify live strategies.
 *
 * Goal:
 * - Evaluate all six live strategy ledgers together over one month.
 * - Win-rate / winning-days / signal-frequency first.
 * - Preserve exact strategy rules by reusing the exact six-strategy engine.
 *
 * Usage:
 *   node scripts/backtest-six-telegram-month-fast.js 2026-07-29 2026-08-29
 */

const {spawnSync}=require('child_process');
const path=require('path');

const FROM=process.argv[2]||'2026-07-29';
const TO=process.argv[3]||'2026-08-29';
const ENGINE=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');

console.log('⚡ TELEGRAM SIX — FAST ONE-MONTH BASELINE');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🎯 Priority: WR + winning signals + enough daily activity');
console.log('ℹ️ This first pass runs the exact live six-strategy portfolio on the short month window.');
console.log('   It is intentionally fast; use it as the baseline before the larger parameter optimizer.\n');

const r=spawnSync(process.execPath,[ENGINE,FROM,TO],{
  stdio:'inherit',
  env:{...process.env,TELEGRAM_FAST_MONTH:'1'}
});

if(r.error){
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status==null?1:r.status);
