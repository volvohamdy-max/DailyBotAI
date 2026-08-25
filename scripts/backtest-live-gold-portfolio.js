#!/usr/bin/env node
'use strict';

// Unified runner for the CURRENT live gold strategy set.
// Component backtests mirror their corresponding live strategy logic.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FROM = process.argv[2] || '2025-08-25';
const TO = process.argv[3] || '2026-08-25';

const LIVE_FILES = [
  'src/services/scalpStrategies/goldRapidScalpStrategy.js',
  'src/services/scalpStrategies/grokGold92Strategy.js',
  'src/services/scalpStrategies/proStrategy.js',
  'src/services/scalpStrategies/goldRangeMrStrategy.js',
  'src/services/scalpStrategies/goldSweep5Strategy.js'
];

const TESTS = [
  ['🚀 GOLD RAPID SCALP V5', 'scripts/backtest-gold-rapid-scalp-v5.js'],
  ['⚡ GROK GOLD 92', 'scripts/backtest-grok92-all-day.js'],
  ['⭐ PRO STRATEGY', 'scripts/backtest-gold-pro-standalone.js'],
  ['🌊 GOLD RANGE MR V3', 'scripts/backtest-gold-range-live-exact.js'],
  ['🌊 GOLD SWEEP 5', 'scripts/backtest-gold-sweep5-live-exact.js']
];

function die(msg) { console.error(`❌ ${msg}`); process.exit(1); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

console.log('🔥 CURRENT LIVE GOLD PORTFOLIO — UNIFIED 1Y BACKTEST');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🔒 Source of truth: the five strategies currently registered in goldScalper.js');
console.log('📊 Rapid V5 + Grok 92 + Pro + Range MR V3 + Sweep 5\n');

for (const f of LIVE_FILES) if (!exists(f)) die(`Missing live strategy: ${f}`);
for (const [, f] of TESTS) if (!exists(f)) die(`Missing component backtest: ${f}`);

console.log('✅ Current live set verified:');
for (const f of LIVE_FILES) console.log(`   ${f}`);

let failed = false;
for (const [label, rel] of TESTS) {
  console.log('\n' + '━'.repeat(72));
  console.log(`📊 ${label}`);
  console.log(`▶️ node ${rel} ${FROM} ${TO}`);
  console.log('━'.repeat(72));
  const r = spawnSync(process.execPath, [path.join(ROOT, rel), FROM, TO], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit'
  });
  if (r.error || r.status !== 0) {
    failed = true;
    console.error(`❌ ${label} failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
  } else console.log(`✅ ${label} completed`);
}

console.log('\n' + '━'.repeat(72));
console.log('🏁 FIVE LIVE GOLD STRATEGIES BACKTEST COMPLETE');
console.log('Each strategy is tested independently, matching the live scanner architecture.');
console.log('NOTE: PF/DD must not be added arithmetically across independent strategies.');
console.log('A true combined portfolio result requires timestamped trade ledgers from all five.');
console.log('━'.repeat(72));

if (failed) process.exitCode = 1;
