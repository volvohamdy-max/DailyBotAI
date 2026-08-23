const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'backtestRegimeDukascopyOptimize.js');
let source = fs.readFileSync(basePath, 'utf8');

source = source.replace(
  '🧭 GOLD REGIME — DUKASCOPY OPTIMIZER',
  '⚡ GOLD REGIME — DUKASCOPY QUICK V2 (4 VARIANTS)'
);

const start = source.indexOf('  const configs=[];');
const endMarker = "    configs.push({adxMin,anchorMax,momentumMin,bodyShareMin,tpR,scoreMin,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2});";
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error('Could not locate optimizer config block');
}

const common = 'anchorMax:0.55,momentumMin:2,bodyShareMin:0.40,scoreMin:78,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2';
const replacement = `  const configs=[\n    {adxMin:26,tpR:1.4,${common}},\n    {adxMin:26,tpR:1.5,${common}},\n    {adxMin:28,tpR:1.4,${common}},\n    {adxMin:28,tpR:1.5,${common}}\n  ];`;

source = source.slice(0, start) + replacement + source.slice(end + endMarker.length);
source = source.replace('🔬 Variants=${configs.length}', '🔬 QUICK V2 Variants=${configs.length}');

if (!source.includes('adxMin:28') || !source.includes('tpR:1.4')) {
  throw new Error('Failed to inject Quick V2 configs');
}

eval(source);
