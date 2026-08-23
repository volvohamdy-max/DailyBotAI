const { spawnSync } = require('child_process');
const path = require('path');

const FROM = process.argv[2] || '2025-08-23';
const TO = process.argv[3] || '2026-08-23';
const base = path.join(__dirname, 'backtest-all-live-strategies-v4.js');

console.log('⭐ PRO STRATEGY — CURRENT BACKTEST RULES');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Market: XAUUSD');
console.log('Signal TF: M5');
console.log('Daily bias: Daily Close vs EMA50');
console.log('BUY: Daily bias BUY + RSI14 crosses down through 37');
console.log('SELL: Daily bias SELL + RSI14 crosses up through 63');
console.log('ADX M5: >= 15');
console.log('ATR regime: current ATR / avg previous 50 ATR <= 1.15');
console.log('Candle body share: >= 0.50 of candle range');
console.log('Blocked UTC hours: 01-05, 15-16, 21-23');
console.log('Wednesday block: 17:00-20:30 UTC');
console.log('Stop Loss: fixed 10 price units');
console.log('BUY exit: RSI14 >= 63');
console.log('SELL exit: RSI14 <= 37');
console.log('Friday forced exit: 21:45 UTC');
console.log('Daily protection: max 2 losses/day');
console.log('Cooldown after loss: 180 minutes');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Period: ${FROM} -> ${TO}`);

const run = spawnSync(process.execPath, [base, FROM, TO], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024
});

if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
if (run.status !== 0) {
  process.stderr.write(run.stderr || 'Backtest failed\n');
  process.exit(run.status || 1);
}

const text = run.stdout || '';
const start = text.indexOf('📊 ⭐ PRO STRATEGY — LIVE');
if (start === -1) {
  console.error('PRO result block not found in unified backtest output');
  process.exit(1);
}

const rest = text.slice(start);
const next = rest.indexOf('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 ', 5);
const block = next === -1 ? rest : rest.slice(0, next);

console.log('\n' + block.trim());
