const fs = require('fs');
const path = require('path');

// Money simulation lives OUTSIDE the generated backtest source.
// The backtest only calls this helper with the final ordered portfolio trades.
globalThis.__printMoney = function __printMoney(portfolio) {
  const START = 1000;
  const RISK = 0.01;

  let balance = START;
  let peak = START;
  let maxDDUsd = 0;
  let maxDDPct = 0;

  const trades = Array.isArray(portfolio)
    ? [...portfolio].sort((a, b) => Number(a.time) - Number(b.time))
    : [];

  for (const trade of trades) {
    const r = Number(trade.r);
    if (!Number.isFinite(r)) continue;

    const riskUsd = balance * RISK;
    balance += riskUsd * r;

    if (balance > peak) peak = balance;

    const ddUsd = peak - balance;
    const ddPct = peak > 0 ? (ddUsd / peak) * 100 : 0;

    if (ddUsd > maxDDUsd) maxDDUsd = ddUsd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  }

  const profit = balance - START;
  const returnPct = ((balance / START) - 1) * 100;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💵 BOT PORTFOLIO — $1000 / 1% RISK COMPOUNDING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Trades: ' + trades.length);
  console.log('Start: $' + START.toFixed(2));
  console.log('Final: $' + balance.toFixed(2));
  console.log('Profit: ' + (profit >= 0 ? '+' : '') + '$' + profit.toFixed(2));
  console.log('Return: ' + (returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%');
  console.log('Max DD: ' + maxDDPct.toFixed(2) + '% (~$' + maxDDUsd.toFixed(2) + ')');
};

const v4Path = path.join(__dirname, 'backtest-all-live-strategies-v4.js');
let wrapper = fs.readFileSync(v4Path, 'utf8');

const evalMarker = 'eval(source);';
if (!wrapper.includes(evalMarker)) {
  throw new Error('V4 eval marker not found');
}

// Add one tiny, quote-safe source patch before V4 executes its generated source.
const hookPatch = "source = source.replace(\"print(stats('🤖 BOT PORTFOLIO — ALL LIVE',portfolio));\", \"print(stats('🤖 BOT PORTFOLIO — ALL LIVE',portfolio));globalThis.__printMoney(portfolio);\");";

wrapper = wrapper.replace(evalMarker, hookPatch + '\n' + evalMarker);

eval(wrapper);
