const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'backtestNewYorkDukascopyQuick.js');let s=fs.readFileSync(base,'utf8');
s=s.replace("console.log('🗽 NEW YORK — DUKASCOPY QUICK OPTIMIZER');","console.log('🗽 NEW YORK — STEP 1: ADX ONLY');");
const old="const configs=[];for(const adxMin of [22,25])for(const chaseMax of [0.35,0.50])for(const rr of [1.0,1.25])configs.push({adxMin,chaseMax,rr,bodyMax:0.35});";
const neu="const configs=[22,24,26].map(adxMin=>({adxMin,chaseMax:0.50,rr:1.0,bodyMax:0.35}));";
if(!s.includes(old))throw new Error('NY config block not found');s=s.replace(old,neu);
eval(s);
