'use strict';

/**
 * Unified LIVE Gold strategy backtest manifest / runner.
 * Period default: 2025-08-24 -> 2026-08-24.
 *
 * IMPORTANT:
 * - The strategy source files below are the production LIVE sources of truth.
 * - This script deliberately does not duplicate/tune strategy constants.
 * - Existing validated strategy-specific backtests are discovered and executed
 *   so results stay tied to each strategy's exact research/execution model.
 * - It also prints the current LIVE CONFIG for audit before running anything.
 *
 * Usage:
 *   node scripts/backtest-all-live-gold-strategies.js
 *   node scripts/backtest-all-live-gold-strategies.js --list
 *   node scripts/backtest-all-live-gold-strategies.js --strategy exhaustion
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PERIOD = { from: '2025-08-24', to: '2026-08-24' };

const LIVE = [
  {
    key: 'exhaustion',
    label: '🔥 Gold Exhaustion V3',
    source: 'src/services/scalpStrategies/goldExhaustionV3Strategy.js',
    preferred: [
      'scripts/backtest-gold-exhaustion-v3-cost-dollar.js',
      'scripts/backtest-gold-exhaustion-v3-cost.js',
      'scripts/backtest-gold-exhaustion-v3-asymmetric.js'
    ],
    hints: ['exhaustion-v3']
  },
  {
    key: 'rapid',
    label: '🚀 Gold Rapid Scalp V5',
    source: 'src/services/scalpStrategies/goldRapidScalpStrategy.js',
    preferred: [],
    hints: ['rapid', 'scalp-v5']
  },
  {
    key: 'grok92',
    label: '⚡ Grok Gold 92',
    source: 'src/services/scalpStrategies/grokGold92Strategy.js',
    preferred: [],
    hints: ['grok', 'gold92']
  },
  {
    key: 'pro',
    label: '⭐ Pro Strategy',
    source: 'src/services/scalpStrategies/proStrategy.js',
    preferred: [],
    hints: ['pro-strategy', 'prostrategy']
  },
  {
    key: 'range',
    label: '🌊 Gold Range MR V3',
    source: 'src/services/scalpStrategies/goldRangeMrStrategy.js',
    preferred: [],
    hints: ['range-mr', 'rangemr']
  },
  {
    key: 'sweep5',
    label: '🌊 Gold Sweep 5',
    source: 'src/services/scalpStrategies/goldSweep5Strategy.js',
    preferred: [],
    hints: ['sweep5', 'sweep-5']
  }
];

function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function allBacktests() {
  return fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter(x => /^backtest.*\.js$/i.test(x))
    .map(x => `scripts/${x}`);
}
function discover(s) {
  for (const p of s.preferred) if (exists(p)) return p;
  const files = allBacktests();
  for (const hint of s.hints) {
    const hit = files.find(f => f.toLowerCase().includes(hint.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}
function loadConfig(s) {
  try {
    const mod = require(path.join(ROOT, s.source));
    return mod.CONFIG || null;
  } catch (e) {
    return { loadError: e.message };
  }
}
function printableConfig(cfg) {
  if (!cfg) return 'CONFIG unavailable';
  const clean = {};
  for (const [k,v] of Object.entries(cfg)) clean[k] = v instanceof Set ? [...v] : v;
  return JSON.stringify(clean, null, 2);
}
function runFile(rel) {
  const env = { ...process.env, BACKTEST_FROM: PERIOD.from, BACKTEST_TO: PERIOD.to };
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT, env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe']
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const arg = process.argv.find(x => x.startsWith('--strategy='));
const requested = arg ? arg.split('=')[1].toLowerCase() : null;
const selected = requested ? LIVE.filter(x => x.key === requested || x.label.toLowerCase().includes(requested)) : LIVE;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 ALL LIVE GOLD STRATEGIES — AUDIT + BACKTEST');
console.log(`📅 Requested period: ${PERIOD.from} → ${PERIOD.to}`);
console.log('📌 Source of truth: production scalpStrategies files');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const rows = [];
for (const s of selected) {
  const runner = discover(s);
  const cfg = loadConfig(s);
  console.log(`\n${s.label}`);
  console.log(`LIVE SOURCE: ${s.source}`);
  console.log('LIVE CONFIG:');
  console.log(printableConfig(cfg));
  console.log(`BACKTEST: ${runner || 'NOT FOUND'}`);
  rows.push({ ...s, runner, cfg });
}

if (process.argv.includes('--list')) {
  console.log('\nℹ️ Audit only (--list). No backtests executed.');
  process.exit(0);
}

console.log('\n━━━━━━━━━━━━━━ BACKTEST EXECUTION ━━━━━━━━━━━━━━');
let missing = 0;
for (const row of rows) {
  console.log(`\n\n${row.label}`);
  console.log('─'.repeat(54));
  if (!row.runner) {
    missing++;
    console.log('⚠️ No strategy-specific backtest script discovered.');
    console.log(`   LIVE source remains: ${row.source}`);
    continue;
  }
  console.log(`▶ ${row.runner}`);
  const r = runFile(row.runner);
  if (r.stdout.trim()) console.log(r.stdout.trim());
  if (r.stderr.trim()) console.error(r.stderr.trim());
  console.log(r.code === 0 ? '✅ Completed' : `❌ Exit code ${r.code}`);
}

console.log('\n━━━━━━━━━━━━━━━━━━ SUMMARY ━━━━━━━━━━━━━━━━━━');
console.log(`Live strategies audited: ${rows.length}`);
console.log(`Backtest runners found: ${rows.length - missing}/${rows.length}`);
if (missing) {
  console.log('⚠️ Some strategies have no discoverable dedicated runner yet.');
  console.log('   Do NOT substitute old/other strategy logic; add an exact LIVE-equivalent runner for those strategies.');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
