#!/usr/bin/env node
'use strict';

/*
 * Fresh 1-year backtest entry point for the SIX strategies that are live in
 * src/services/goldScalper.js.
 *
 * IMPORTANT:
 * - Uses the exact six-strategy backtest engine whose conditions mirror live.
 * - Uses Dukascopy cache through the underlying engine.
 * - Does NOT touch live strategy files, VIP routing, or trade execution.
 * - Default window: 2025-08-29 -> 2026-08-29.
 *
 * Live six:
 * 1) GOLD_EXHAUSTION_V3
 * 2) GOLD_RAPID_SCALP
 * 3) GROK_GOLD_92
 * 4) PRO_STRATEGY
 * 5) GOLD_RANGE_MR
 * 6) GOLD_SWEEP_5
 *
 * Run:
 *   node scripts/backtest-live-six-1year-fresh.js
 *
 * Optional custom dates:
 *   node scripts/backtest-live-six-1year-fresh.js 2025-08-29 2026-08-29
 */

const { spawnSync } = require('child_process');
const path = require('path');

const from = process.argv[2] || '2025-08-29';
const to = process.argv[3] || '2026-08-29';
const exactEngine = path.join(__dirname, 'backtest-live-gold-portfolio-6-exact.js');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔥 FRESH BACKTEST — ALL 6 LIVE GOLD STRATEGIES');
console.log(`📅 PERIOD: ${from} → ${to}`);
console.log('📦 DATA: Dukascopy cached dataset (cache reused when available)');
console.log('🧬 LOGIC: exact live six-strategy backtest engine');
console.log('🛡️ PORTFOLIO: MAX 2 simultaneous open gold trades');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const result = spawnSync(process.execPath, [exactEngine, from, to], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error('❌ BACKTEST FAILED:', result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
