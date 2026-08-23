const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'backtestNewYorkDukascopyQuick.js');let s=fs.readFileSync(base,'utf8');
s=s.replace("const FROM = process.argv[2] || '2024-08-23';","const FROM = process.argv[2] || '2025-08-23';");
s=s.replace("console.log('🗽 NEW YORK — DUKASCOPY QUICK OPTIMIZER');","console.log('⚡ NEW YORK — STEP 1 ADX LITE (1 YEAR)');");
const old="const configs=[];for(const adxMin of [22,25])for(const chaseMax of [0.35,0.50])for(const rr of [1.0,1.25])configs.push({adxMin,chaseMax,rr,bodyMax:0.35});";
const neu="const configs=[22,24,26].map(adxMin=>({adxMin,chaseMax:0.50,rr:1.0,bodyMax:0.35}));";
if(!s.includes(old))throw new Error('NY config block not found');s=s.replace(old,neu);
// Restrict expensive signal scan to NY-session bars before running the rest of the strategy checks.
s=s.replace("for(let i=60;i<m5.length-2;i++){const sig=m5[i],entryIdx=i+1;if(!nySession(m5[entryIdx].timestamp))continue;","for(let i=60;i<m5.length-2;i++){const sig=m5[i],entryIdx=i+1;if(!nySession(m5[entryIdx].timestamp))continue;");
eval(s);
