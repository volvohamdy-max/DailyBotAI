const fs = require('fs');
const path = require('path');

const v4Path = path.join(__dirname, 'backtest-all-live-strategies-v4.js');
let v4 = fs.readFileSync(v4Path, 'utf8');

const oldEval = 'eval(source);';
if (!v4.includes(oldEval)) throw new Error('V4 eval marker not found');

const patch = String.raw`
const moneyFn = String.raw\`
function moneyStats(trades,startBalance=1000,riskPct=0.01){
  let balance=startBalance,peak=startBalance,maxDdPct=0,maxDdUsd=0;
  for(const t of [...trades].sort((a,b)=>a.time-b.time)){
    const risk=balance*riskPct;
    balance += risk*Number(t.r||0);
    if(balance>peak) peak=balance;
    const ddUsd=peak-balance;
    const ddPct=peak>0?ddUsd/peak*100:0;
    if(ddPct>maxDdPct){maxDdPct=ddPct;maxDdUsd=ddUsd;}
  }
  return {startBalance,balance,profit:balance-startBalance,returnPct:(balance/startBalance-1)*100,maxDdPct,maxDdUsd,riskPct:riskPct*100};
}
function printMoney(name,trades){
  const m=moneyStats(trades,1000,0.01);
  console.log('\\n💵 ' + name + ' — $1000 / 1% RISK COMPOUNDING');
  console.log('Start: $' + m.startBalance.toFixed(2));
  console.log('Final: $' + m.balance.toFixed(2));
  console.log('Profit: ' + (m.profit>=0?'+':'') + '$' + m.profit.toFixed(2));
  console.log('Return: ' + (m.returnPct>=0?'+':'') + m.returnPct.toFixed(1) + '%');
  console.log('Max DD: ' + m.maxDdPct.toFixed(2) + '% (~$' + m.maxDdUsd.toFixed(2) + ')');
}
\`;
source = source.replace('(async()=>{', moneyFn + '\\n(async()=>{');
const portfolioPrint = "print(stats('🤖 BOT PORTFOLIO — ALL LIVE',portfolio));";
if(!source.includes(portfolioPrint)) throw new Error('Portfolio print marker not found');
source = source.replace(portfolioPrint, portfolioPrint + "\\n  printMoney('BOT PORTFOLIO',portfolio);");

eval(source);
`;

v4 = v4.replace(oldEval, patch);
eval(v4);
