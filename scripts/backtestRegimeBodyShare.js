const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'backtestRegimeDukascopyOptimize.js');
let source = fs.readFileSync(basePath, 'utf8');

source = source.replace(
  '🧭 GOLD REGIME — DUKASCOPY OPTIMIZER',
  '🧪 GOLD REGIME — BODY SHARE TEST'
);

const start = source.indexOf('  const configs=[];');
const endMarker = "    configs.push({adxMin,anchorMax,momentumMin,bodyShareMin,tpR,scoreMin,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2});";
const end = source.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error('Body Share test could not locate optimizer config block');
}

const common = 'adxMin:26,anchorMax:0.55,momentumMin:2,tpR:1.8,scoreMin:78,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2';
const replacement = `  const configs=[\n    {bodyShareMin:0.35,${common}},\n    {bodyShareMin:0.40,${common}},\n    {bodyShareMin:0.45,${common}},\n    {bodyShareMin:0.50,${common}},\n    {bodyShareMin:0.55,${common}}\n  ];`;

source = source.slice(0, start) + replacement + source.slice(end + endMarker.length);
source = source.replace('🔬 Variants=${configs.length}', '🔬 BODY SHARE Variants=${configs.length}');

eval(source);
