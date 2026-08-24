#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function allScripts() {
  return fs.readdirSync(__dirname).filter(x => /^backtest.*\.js$/i.test(x) && x !== path.basename(__filename));
}
function findScript(patterns) {
  const files = allScripts();
  for (const p of patterns) {
    const hit = files.find(f => p.test(f));
    if (hit) return hit;
  }
  return null;
}
function run(label, patterns) {
  const file = findScript(patterns);
  console.log('\n' + '━'.repeat(60));
  console.log(`📊 ${label}`);
  console.log('━'.repeat(60));
  if (!file) {
    console.log('❌ No matching standalone backtest script found in scripts/.');
    return { label, ok:false, file:null };
  }
  console.log(`▶️ node scripts/${file}`);
  const r = spawnSync(process.execPath, [path.join(__dirname,file)], { cwd:root, stdio:'inherit', env:process.env });
  if (r.error) console.error(r.error);
  return { label, ok:r.status===0, file, status:r.status };
}

console.log('🔥 FOUR LIVE STRATEGIES — BACKTEST RUNNER');
console.log('Live set: GROK GOLD 92 → PRO → GOLD RANGE MR V2 + GOLD H4 MR independent');
console.log('This runner intentionally executes the repository standalone validators; it does not invent/approximate missing strategy logic.');

const results = [];
results.push(run('⚡ GROK GOLD 92', [/grok.*92/i,/92.*grok/i]));
results.push(run('⭐ PRO STRATEGY', [/pro.*strategy/i,/strategy.*pro/i,/pro.*gold/i]));
results.push(run('🌊 GOLD RANGE MR V2', [/gold.*range.*scalper.*v2/i,/range.*mr.*v2/i]));
results.push(run('🟣 GOLD H4 MEAN REVERSION', [/gold.*h4.*mean/i,/h4.*mr/i,/h4.*mean/i]));

console.log('\n' + '━'.repeat(60));
console.log('✅ RUN SUMMARY');
for (const x of results) console.log(`${x.ok?'✅':'❌'} ${x.label} | ${x.file || 'MISSING'}`);
console.log('━'.repeat(60));
if (results.some(x=>!x.ok)) process.exitCode=1;
