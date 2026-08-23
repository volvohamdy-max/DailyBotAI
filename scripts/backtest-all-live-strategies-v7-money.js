const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'backtest-all-live-strategies-v4.js');
let wrapper = fs.readFileSync(basePath, 'utf8');

const oldEval = 'eval(source);';
if (!wrapper.includes(oldEval)) throw new Error('V4 eval marker not found');

const injected = [
  "source = source.replace(\"print(stats('🤖 BOT PORTFOLIO — ALL LIVE',portfolio));\", \"print(stats('🤖 BOT PORTFOLIO — ALL LIVE',portfolio));const MONEY_START=1000;const MONEY_RISK=0.01;let moneyBalance=MONEY_START,moneyPeak=MONEY_START,moneyMaxDD=0,moneyMaxDDPct=0;for(const t of portfolio){const riskUsd=moneyBalance*MONEY_RISK;moneyBalance+=riskUsd*t.r;if(moneyBalance>moneyPeak)moneyPeak=moneyBalance;const ddUsd=moneyPeak-moneyBalance;const ddPct=moneyPeak>0?(ddUsd/moneyPeak)*100:0;if(ddUsd>moneyMaxDD)moneyMaxDD=ddUsd;if(ddPct>moneyMaxDDPct)moneyMaxDDPct=ddPct;}const moneyProfit=moneyBalance-MONEY_START;const moneyReturn=(moneyBalance/MONEY_START-1)*100;console.log('');console.log('💵 BOT PORTFOLIO — $1000 / 1% RISK COMPOUNDING');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('Start: $'+MONEY_START.toFixed(2));console.log('Final: $'+moneyBalance.toFixed(2));console.log('Profit: '+(moneyProfit>=0?'+':'')+'$'+moneyProfit.toFixed(2));console.log('Return: '+(moneyReturn>=0?'+':'')+moneyReturn.toFixed(2)+'%');console.log('Max DD: '+moneyMaxDDPct.toFixed(2)+'% (~$'+moneyMaxDD.toFixed(2)+')');\");"
].join('\n');

wrapper = wrapper.replace(oldEval, injected + '\n' + oldEval);
eval(wrapper);
