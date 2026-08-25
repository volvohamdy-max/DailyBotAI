'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const src=path.join(__dirname,'backtest-pro-v2-optimize.js');
const text=fs.readFileSync(src,'utf8');
const FROM=process.argv[2]||'2025-08-24',TO=process.argv[3]||'2026-08-24';
console.log('🔬 PRO V2 — FOCUSED ATR SWEEP');
console.log(`📅 ${FROM} → ${TO}`);
console.log('Fixed: BUY=37 SELL=63 ADX=21 BODY=0.50 SL=10');
console.log('Dukascopy cache: ./data/dukascopy-cache\n');
for(const atrMax of [1.10,1.15,1.20,1.25,1.30]){
 const code=text
  .replace("const grid=[];for(const buy of [35,37,39])for(const sell of [61,63,65])for(const adxMin of [15,18,21])for(const atrMax of [1.05,1.15,1.25])for(const body of [.4,.5,.6])for(const stop of [8,10,12])grid.push({buy,sell,adxMin,atrMax,body,stop});",`const grid=[{buy:37,sell:63,adxMin:21,atrMax:${atrMax},body:.5,stop:10}];`)
  .replace("if(dev.n<40||oos.n<15)continue;",'')
  .replace("for(const x of rows.slice(0,12))",'for(const x of rows)');
 const tmp=path.join(__dirname,`.tmp-pro-atr-${String(atrMax).replace('.','_')}.js`);fs.writeFileSync(tmp,code);
 const r=spawnSync(process.execPath,[tmp,FROM,TO],{encoding:'utf8',maxBuffer:30*1024*1024});
 try{fs.unlinkSync(tmp)}catch{}
 console.log(`\n━━━━━━━━━━ ATR <= ${atrMax.toFixed(2)} ━━━━━━━━━━`);
 if(r.status!==0){console.log((r.stderr||r.stdout||'failed').trim());continue}
 const out=r.stdout||'';
 const marker=out.indexOf('🏆 TOP ROBUST CONFIGS');
 console.log((marker>=0?out.slice(marker):out).replace(/BASELINE:[^\n]*/g,'').trim());
}
console.log('\n📌 Goal: relax PRO_ATR_TOO_HOT only if DEV/OOS remain stable.');
