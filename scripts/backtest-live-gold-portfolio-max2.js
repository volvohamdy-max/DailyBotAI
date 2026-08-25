#!/usr/bin/env node
'use strict';

/**
 * CURRENT LIVE GOLD PORTFOLIO — MAX 2 runner
 *
 * This entry point intentionally reuses the validated live-gold portfolio runner.
 * It exists as a stable command while timestamp-ledger/max-concurrency aggregation
 * is added to the component backtests. It MUST NOT invent portfolio PF/DD by
 * arithmetically combining independent strategy summaries.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const FROM = process.argv[2] || '2025-08-24';
const TO = process.argv[3] || '2026-08-24';
const runner = path.join(__dirname, 'backtest-live-gold-portfolio.js');

console.log('🔥 LIVE GOLD PORTFOLIO — MAX OPEN 2');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🔒 Running validated component backtests from the current live set.');
console.log('⚠️ Portfolio-level MAX OPEN=2 filtering requires timestamped entry/exit ledgers.');
console.log('⚠️ Until those ledgers are emitted by every component, no fake combined PF/DD/NetR will be printed.\n');

const r = spawnSync(process.execPath, [runner, FROM, TO], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit'
});

if (r.error) {
  console.error(`❌ Failed to start portfolio runner: ${r.error.message}`);
  process.exit(1);
}

if (r.status !== 0) process.exit(r.status || 1);

console.log('\n✅ Component portfolio run completed.');
console.log('🧮 MAX OPEN=2 combined metrics are deliberately withheld until timestamp ledgers are available.');
