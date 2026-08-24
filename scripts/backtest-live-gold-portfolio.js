#!/usr/bin/env node
'use strict';

// Unified runner for the CURRENT live gold strategy set.
// Important: this file does not contain strategy parameters. Each component
// backtest is responsible for mirroring its corresponding live strategy.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FROM = process.argv[2] || '2025-08-24';
const TO = process.argv[3] || '2026-08-24';

const LIVE_FILES = [
  'src/services/scalpStrategies/goldRapidScalpStrategy.js',
  'src/services/scalpStrategies/grokGold92Strategy.js',
  'src/services/scalpStrategies/proStrategy.js',
  'src/services/scalpStrategies/goldRangeMrStrategy.js',
  'src/services/goldH4MeanReversion.js'
];

const TESTS = [
  ['🚀 GOLD RAPID SCALP V5', 'scripts/backtest-gold-rapid-scalp-v5.js'],
  ['⚡ GROK GOLD 92', 'scripts/backtest-grok92-all-day.js'],
  ['⭐ PRO STRATEGY', 'scripts/backtest-gold-pro-standalone.js'],
  ['🌊 GOLD RANGE MR V2', 'scripts/backtest-gold-range-loose-regime-final.js'],
  ['🟣 GOLD H4 MEAN REVERSION', 'scripts/backtest-gold-h4-mean-reversion.js']
];

function die(msg) { console.error(`❌ ${msg}`); process.exit(1); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

console.log('🔥 CURRENT LIVE GOLD PORTFOLIO — UNIFIED BACKTEST');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🔒 Source of truth: CURRENT live strategy files');
console.log('⚠️ No legacy New York / Gold Regime strategies included.\n');

for (const f of LIVE_FILES) if (!exists(f)) die(`Missing live strategy: ${f}`);
for (const [, f] of TESTS) if (!exists(f)) die(`Missing component backtest: ${f}`);

console.log('✅ Live set verified:');
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
console.log('🏁 LIVE GOLD PORTFOLIO RUN COMPLETE');
console.log('Strategies checked independently, matching the live scanner architecture.');
console.log('NOTE: Do not arithmetically add DD/PF across strategies; portfolio DD requires');
console.log('a shared timestamped trade ledger. This runner deliberately avoids fake aggregation.');
console.log('━'.repeat(72));

if (failed) process.exitCode = 1;
