'use strict';
const fs=require('fs');
const p=require('path').join(__dirname,'../src/services/scalpStrategies/grokGold92Strategy.js');
const s=fs.readFileSync(p,'utf8');
const bad=/getCandles\(pair,\s*['"](?:5min|1h)['"]\)/.test(s);
if(bad){console.error('GROK92_NOT_UNIFIED: strategy still calls marketService getCandles');process.exit(1);}
console.log('GROK92_UNIFIED_SOURCE_OK');
