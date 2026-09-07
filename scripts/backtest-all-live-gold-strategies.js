'use strict';

/**
 * Unified READ-ONLY backtest runner for the CURRENT live Gold portfolio.
 *
 * IMPORTANT:
 * - Strategy membership mirrors src/services/goldScalper.js.
 * - Production strategy files are loaded only to print/audit their current CONFIG.
 * - This script NEVER mutates live CONFIG or trading files.
 * - Dedicated historical runners are used only when they exist for that strategy.
 *
 * Usage:
 *   node scripts/backtest-all-live-gold-strategies.js
 *   node scripts/backtest-all-live-gold-strategies.js --list
 *   node scripts/backtest-all-live-gold-strategies.js --strategy=grok92
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PERIOD = {
  from: process.env.BACKTEST_FROM || '2025-08-24',
  to: process.env.BACKTEST_TO || '2026-08-24'
};

// MUST mirror the exact seven modules currently registered in goldScalper.js.
const LIVE = [
  {
    key: 'exhaustion', label: '🔥 Gold Exhaustion V3',
    source: 'src/services/scalpStrategies/goldExhaustionV3Strategy.js',
    preferred: ['scripts/backtest-gold-exhaustion-v3-dollar-floor.js','scripts/backtest-gold-exhaustion-v3-cost-dollar.js','scripts/backtest-gold-exhaustion-v3-exits.js'],
    hints: ['gold-exhaustion-v3']
  },
  {
    key: 'rapid', label: '🚀 Gold Rapid Scalp V5',
    source: 'src/services/scalpStrategies/goldRapidScalpStrategy.js',
    preferred: ['scripts/backtest-gold-rapid-scalp-diagnostics.js'],
    hints: ['gold-rapid-scalp','rapid-scalp']
  },
  {
    key: 'grok92', label: '⚡ Grok Gold 92',
    source: 'src/services/scalpStrategies/grokGold92Strategy.js',
    preferred: ['scripts/backtest-grok-gold92-diagnostics.js'],
    hints: ['grok-gold92','grok-gold-92']
  },
  {
    key: 'pro', label: '⭐ Pro Strategy Mega P1',
    source: 'src/services/scalpStrategies/proStrategyMegaP1.js',
    preferred: ['scripts/backtest-pro-strategy-live.js','scripts/backtest-pro-strategy.js'],
    hints: ['pro-strategy']
  },
  {
    key: 'range', label: '🌊 Gold Range MR Mega N4',
    source: 'src/services/scalpStrategies/goldRangeMrMegaN4.js',
    preferred: ['scripts/backtest-gold-range-mr-diagnostics.js'],
    hints: ['gold-range-mr','range-mr']
  },
  {
    key: 'sweep5', label: '🌊 Gold Sweep 5',
    source: 'src/services/scalpStrategies/goldSweep5Strategy.js',
    preferred: ['scripts/backtest-gold-sweep5-diagnostics.js'],
    hints: ['gold-sweep5','sweep5']
  },
  {
    key: 'micro', label: '⚡ Gold Micro Pullback',
    source: 'src/services/scalpStrategies/goldMicroPullbackStrategy.js',
    preferred: ['scripts/backtest-gold-micro-pullback.js','scripts/backtest-gold-micro-pullback-diagnostics.js'],
    hints: ['gold-micro-pullback','micro-pullback']
  }
];

function exists(rel){return fs.existsSync(path.join(ROOT,rel));}
function allBacktests(){return fs.readdirSync(path.join(ROOT,'scripts')).filter(x=>/^backtest.*\.js$/i.test(x)&&x!=='backtest-all-live-gold-strategies.js').map(x=>`scripts/${x}`);}
function discover(s){for(const p of s.preferred)if(exists(p))return p;const files=allBacktests();for(const hint of s.hints){const hit=files.find(f=>f.toLowerCase().includes(hint.toLowerCase()));if(hit)return hit;}return null;}
function loadConfig(s){try{delete require.cache[require.resolve(path.join(ROOT,s.source))];const mod=require(path.join(ROOT,s.source));return mod.CONFIG||null;}catch(e){return{loadError:e.message};}}
function printableConfig(cfg){if(!cfg)return 'CONFIG unavailable';const clean={};for(const[k,v]of Object.entries(cfg))clean[k]=v instanceof Set?[...v]:v;return JSON.stringify(clean,null,2);}
function runFile(rel){const env={...process.env,BACKTEST_FROM:PERIOD.from,BACKTEST_TO:PERIOD.to,READ_ONLY_BACKTEST:'1'};const r=spawnSync(process.execPath,[path.join(ROOT,rel)],{cwd:ROOT,env,encoding:'utf8',stdio:['inherit','pipe','pipe'],maxBuffer:20*1024*1024});return{code:r.status,stdout:r.stdout||'',stderr:r.stderr||''};}

const arg=process.argv.find(x=>x.startsWith('--strategy='));
const requested=arg?arg.split('=')[1].toLowerCase():null;
const selected=requested?LIVE.filter(x=>x.key===requested||x.label.toLowerCase().includes(requested)):LIVE;
if(!selected.length){console.error(`Unknown strategy: ${requested}`);process.exit(2);}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 CURRENT LIVE GOLD PORTFOLIO — READ-ONLY BACKTEST');
console.log(`📅 Requested period: ${PERIOD.from} → ${PERIOD.to}`);
console.log(`🧩 Live strategies: ${LIVE.length}`);
console.log('🛡️ LIVE trading files/config will NOT be modified');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const rows=[];
for(const s of selected){const runner=discover(s),cfg=loadConfig(s);console.log(`\n${s.label}`);console.log(`LIVE SOURCE: ${s.source}`);console.log('LIVE CONFIG:');console.log(printableConfig(cfg));console.log(`BACKTEST: ${runner||'NOT FOUND'}`);rows.push({...s,runner,cfg});}

if(process.argv.includes('--list')){console.log('\nℹ️ Audit only (--list). No backtests executed.');process.exit(0);}

console.log('\n━━━━━━━━━━━━━━ BACKTEST EXECUTION ━━━━━━━━━━━━━━');
let missing=0,completed=0,failed=0;
for(const row of rows){console.log(`\n\n${row.label}`);console.log('─'.repeat(58));if(!row.runner){missing++;console.log('⚠️ Exact dedicated historical runner not found.');console.log('   No substitute strategy logic was used.');continue;}console.log(`▶ ${row.runner}`);const r=runFile(row.runner);if(r.stdout.trim())console.log(r.stdout.trim());if(r.stderr.trim())console.error(r.stderr.trim());if(r.code===0){completed++;console.log('✅ Completed');}else{failed++;console.log(`❌ Exit code ${r.code}`);}}

console.log('\n━━━━━━━━━━━━━━━━━━ SUMMARY ━━━━━━━━━━━━━━━━━━');
console.log(`Current LIVE strategies audited: ${rows.length}/${LIVE.length}`);
console.log(`Backtests completed: ${completed}`);
console.log(`Missing exact runners: ${missing}`);
console.log(`Failed runners: ${failed}`);
console.log('🛡️ READ ONLY — no live strategy settings changed');
if(missing)console.log('⚠️ Missing strategies require an exact live-equivalent runner before comparing portfolio performance.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
