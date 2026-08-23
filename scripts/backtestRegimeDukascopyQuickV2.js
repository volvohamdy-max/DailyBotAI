const fs = require('fs');
const path = require('path');

const FROM = process.argv[2] || '2024-08-23';
const TO = process.argv[3] || '2026-08-23';
const basePath = path.join(__dirname, 'backtestRegimeDukascopyQuick.js');
let source = fs.readFileSync(basePath, 'utf8');

source = source.replace('⚡ GOLD REGIME — DUKASCOPY QUICK (4 VARIANTS)', '⚡ GOLD REGIME — DUKASCOPY QUICK V2 (4 VARIANTS)');
source = source.replace(/const FROM = process\.argv\[2\] \|\| '[^']+';/, `const FROM = process.argv[2] || '${FROM}';`);
source = source.replace(/const TO = process\.argv\[3\] \|\| '[^']+';/, `const TO = process.argv[3] || '${TO}';`);
source = source.replace(
  /const quickConfigs=\[[\s\S]*?\];/,
  `const quickConfigs=[
    {adxMin:26,tpR:1.4},
    {adxMin:26,tpR:1.5},
    {adxMin:28,tpR:1.4},
    {adxMin:28,tpR:1.5}
  ];`
);

if(!source.includes('adxMin:28') || !source.includes('tpR:1.4')) {
  throw new Error('Failed to inject Quick V2 configs');
}

eval(source);
