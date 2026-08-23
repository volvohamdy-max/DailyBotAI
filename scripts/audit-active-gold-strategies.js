const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const config = require('../src/config');
const rel = p => path.join(root, p);

const activeFiles = [
  'src/services/scalpStrategies/grokGold92Strategy.js',
  'src/services/scalpStrategies/proStrategy.js',
  'src/services/goldH4MeanReversion.js',
  'src/services/goldScalper.js',
  'src/services/autoSignals.js',
  'src/services/tradeMonitor.js',
  'src/services/scheduler.js'
];

const retiredFiles = [
  'src/services/scalpStrategies/newYorkStrategy.js',
  'src/services/scalpStrategies/aggressiveBreakoutA.js',
  'src/services/goldRegimeStrategy.js',
  'src/services/goldRegimeSignals.js',
  'src/services/regimeDiagnosticsCache.js'
];

function text(file) {
  return fs.readFileSync(rel(file), 'utf8');
}

let ok = true;
function pass(msg) { console.log(`✅ ${msg}`); }
function fail(msg) { ok = false; console.log(`❌ ${msg}`); }

async function main() {
  console.log('\n🔎 ACTIVE GOLD STRATEGIES — PRE-MARKET AUDIT\n');

  for (const f of activeFiles) {
    fs.existsSync(rel(f)) ? pass(`exists: ${f}`) : fail(`missing: ${f}`);
  }

  for (const f of retiredFiles) {
    !fs.existsSync(rel(f)) ? pass(`retired removed: ${f}`) : fail(`retired file still exists: ${f}`);
  }

  for (const f of activeFiles) {
    if (!fs.existsSync(rel(f))) continue;
    const r = spawnSync(process.execPath, ['--check', rel(f)], { encoding: 'utf8' });
    r.status === 0 ? pass(`syntax: ${f}`) : fail(`syntax error: ${f}\n${r.stderr || r.stdout}`);
  }

  if (fs.existsSync(rel('src/services/goldScalper.js'))) {
    const s = text('src/services/goldScalper.js');
    s.includes('grokGold92Strategy') && s.includes('proStrategy')
      ? pass('Gold Scalper loads Grok Gold 92 + Pro Strategy')
      : fail('Gold Scalper active strategy list is incomplete');
    !/newYorkStrategy|goldRegime/i.test(s)
      ? pass('Gold Scalper has no New York/Regime runtime reference')
      : fail('Gold Scalper still references retired strategy');
  }

  if (fs.existsSync(rel('src/services/autoSignals.js'))) {
    const s = text('src/services/autoSignals.js');
    s.includes('scanGoldH4MeanReversion')
      ? pass('H4 Mean Reversion is wired directly into auto scan')
      : fail('H4 Mean Reversion is not wired into auto scan');
    /bot\.telegram\.sendMessage\(\s*config\.vipChannelId\s*,\s*message\s*\)/s.test(s)
      ? pass('Grok/Pro ready signals route to VIP channel')
      : fail('VIP send route missing from auto signals');
    !/scanGoldRegimeSignals|goldRegimeSignals/.test(s)
      ? pass('Auto Signals has no Gold Regime runtime reference')
      : fail('Auto Signals still references Gold Regime');
  }

  if (fs.existsSync(rel('src/services/goldH4MeanReversion.js'))) {
    const s = text('src/services/goldH4MeanReversion.js');
    /bot\.telegram\.sendMessage\(\s*config\.vipChannelId\s*,\s*message\s*\)/s.test(s)
      ? pass('H4 Mean Reversion ready signals route to VIP channel')
      : fail('H4 VIP send route missing');
    s.includes("const SOURCE = 'VIP_H4_MR'")
      ? pass('H4 trades have dedicated source ID')
      : fail('H4 dedicated source ID missing');
  }

  if (fs.existsSync(rel('src/services/tradeMonitor.js'))) {
    const s = text('src/services/tradeMonitor.js');
    s.includes('VIP_SCALP_PRO_STRATEGY')
      ? pass('Trade Monitor has dedicated Pro Strategy management')
      : fail('Pro Strategy monitor path missing');
    s.includes('VIP_SCALP_GROK_GOLD_92')
      ? pass('Trade Monitor recognizes Grok Gold 92 and keeps NO-BE behavior')
      : fail('Grok Gold 92 monitor path missing');
    /bot\.telegram\.sendMessage\(\s*config\.vipChannelId\s*,\s*message\s*\)/s.test(s)
      ? pass('Trade results route to VIP channel')
      : fail('Trade Monitor VIP result send route missing');
  }

  if (fs.existsSync(rel('src/services/scheduler.js'))) {
    const s = text('src/services/scheduler.js');
    s.includes("cron.schedule('* * * * *'") && s.includes('await scanMarket(bot)')
      ? pass('Auto gold scan runs every minute while market is open')
      : fail('Minute auto-scan scheduler wiring missing');
  }

  console.log('\n⚙️ Runtime configuration');
  config.vipChannelId ? pass('VIP_CHANNEL_ID loaded from .env/config') : fail('VIP_CHANNEL_ID missing');
  process.env.SIFTING_API_KEY ? pass('SIFTING_API_KEY loaded for H4 data') : fail('SIFTING_API_KEY missing — H4 cannot load its H1 history');

  try {
    const db = require('../src/database/db');
    await db.ready;
    const { getBoolSetting } = require('../src/database/adminControl');
    getBoolSetting('auto_signals_enabled', true)
      ? pass('auto_signals_enabled = ON')
      : fail('auto_signals_enabled = OFF in Admin Control Center');
  } catch (error) {
    fail(`could not verify admin auto-signal switch: ${error.message}`);
  }

  console.log(ok ? '\n✅ PRE-MARKET AUDIT PASSED\n' : '\n❌ PRE-MARKET AUDIT FAILED\n');
  process.exitCode = ok ? 0 : 1;
}

main().catch(error => {
  console.error('❌ Audit crashed:', error);
  process.exitCode = 1;
});
