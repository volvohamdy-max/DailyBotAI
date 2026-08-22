const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function fail(msg) {
  console.error('❌ ' + msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('✅ ' + msg);
}

function checkSyntax(files) {
  let bad = 0;
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      bad++;
      console.error(`❌ Syntax: ${rel(file)}`);
      console.error((r.stderr || r.stdout || '').trim());
    }
  }
  if (!bad) ok(`Syntax OK for ${files.length} src JS files`);
  else fail(`${bad} syntax error(s)`);
}

function resolveRelative(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, base + '.js', path.join(base, 'index.js')];
  return candidates.find(fs.existsSync) || null;
}

function checkRelativeRequires(files) {
  let bad = 0;
  const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      if (!resolveRelative(file, m[1])) {
        bad++;
        console.error(`❌ Missing require: ${rel(file)} -> ${m[1]}`);
      }
    }
  }
  if (!bad) ok('All relative require() targets exist');
  else fail(`${bad} missing require target(s)`);
}

function collectRegisteredCommands(files) {
  const set = new Set();
  const re = /bot\.command\(\s*['"]([a-z0-9_]+)['"]/gi;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) set.add(m[1].toLowerCase());
  }
  return set;
}

function checkAdvertisedCommands(files) {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const advertised = [...app.matchAll(/command:\s*['"]([a-z0-9_]+)['"]/gi)]
    .map(m => m[1].toLowerCase());
  const registered = collectRegisteredCommands(files);
  const missing = advertised.filter(c => !registered.has(c));
  if (missing.length) fail(`Advertised commands without bot.command handler: ${missing.join(', ')}`);
  else ok(`All ${advertised.length} advertised Telegram commands have handlers`);
}

function checkCriticalChain() {
  const checks = [
    ['app.js', "require('./src/services/installFinalMarketPriority')"],
    ['src/app.js', "const startScheduler = require('./services/scheduler')"],
    ['src/app.js', 'registerStart(bot)'],
    ['src/app.js', 'registerSlashCommands(bot)'],
    ['src/app.js', 'startScheduler(bot)'],
    ['src/services/scheduler.js', "const { scanMarket } = require('./autoSignals')"],
    ['src/services/scheduler.js', "const { monitorTrades } = require('./tradeMonitor')"],
    ['src/services/autoSignals.js', 'await scanGoldRegimeSignals(bot)'],
    ['src/services/goldRegimeSignals.js', 'await scanGoldH4MeanReversion(bot)'],
    ['src/services/goldH4MeanReversion.js', "const SOURCE = 'VIP_H4_MR'"],
    ['src/services/goldH4MeanReversion.js', 'target1: null'],
    ['src/services/goldH4MeanReversion.js', 'target2: target'],
    ['src/services/tradeMonitor.js', "const isProTrade = tradeSource === 'VIP_SCALP_PRO_STRATEGY'"],
    ['src/services/tradeMonitor.js', 'trade.target1 != null'],
    ['src/services/tradeMonitor.js', 'trade.target2 != null']
  ];

  let bad = 0;
  for (const [file, needle] of checks) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p) || !fs.readFileSync(p, 'utf8').includes(needle)) {
      bad++;
      console.error(`❌ Critical chain mismatch: ${file} :: ${needle}`);
    }
  }
  if (!bad) ok('Critical start → scheduler → signals → monitor chain intact');
  else fail(`${bad} critical-chain mismatch(es)`);
}

function checkPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.main !== 'app.js') fail(`package.json main is ${pkg.main}, expected app.js`);
  else ok('package.json main = app.js');
  if (pkg.scripts?.start !== 'node app.js') fail(`npm start is ${pkg.scripts?.start}, expected node app.js`);
  else ok('npm start → node app.js');
}

function main() {
  console.log('🔎 FOREX AI — FULL INTEGRITY AUDIT');
  console.log('Root:', ROOT);

  if (!fs.existsSync(SRC)) return fail('src directory missing');
  const files = walk(SRC);

  checkPackage();
  checkSyntax(files);
  checkRelativeRequires(files);
  checkAdvertisedCommands(files);
  checkCriticalChain();

  console.log('');
  if (process.exitCode) {
    console.log('❌ AUDIT FAILED');
  } else {
    console.log('✅ AUDIT PASSED');
    console.log('Runtime/network/API health still requires npm run doctor + a live boot smoke test.');
  }
}

main();
