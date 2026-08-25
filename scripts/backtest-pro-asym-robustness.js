'use strict';
const {spawnSync}=require('child_process'),fs=require('fs'),path=require('path');
const src=path.join(__dirname,'backtest-pro-v2-asymmetric-adx.js');
const base=fs.readFileSync(src,'utf8');
const periods=[['2022-08-24','2023-08-24'],['2023-08-24','2024-08-24'],['2024-08-24','2025-08-24'],['2025-08-24','2026-08-24'],['2022-08-24','2026-08-24']];
console.log('🧪 PRO ASYMMETRIC — MULTI-PERIOD ROBUSTNESS');
console.log('Candidate: BUY ADX>=15 | SELL ADX>=18');
console.log('Fixed: RSI 37/63 | ATR<=1.15 | Body>=0.50 | SL=10\n');
for(const [from,to] of periods){
 const code=base
  .replace("for(let b=15;b<=21;b++)for(let s=18;s<=22;s++){",'for(let b=15;b<=15;b++)for(let s=18;s<=18;s++){')
  .replace('console.log(`✅ M5 ${m.length} | tested 35 combinations`);','console.log(`✅ M5 ${m.length}`);')
  .replace("console.log('\\n🏆 TOP 12 ASYMMETRIC CONFIGS');", "console.log('\\n🏆 CANDIDATE RESULT');")
  .replace('for(const x of rows.slice(0,12)){','for(const x of rows){');
 const tmp=path.join(__dirname,'.tmp-pro-asym-robustness.js');fs.writeFileSync(tmp,code);
 const r=spawnSync(process.execPath,[tmp,from,to],{encoding:'utf8',maxBuffer:40*1024*1024});
 try{fs.unlinkSync(tmp)}catch{}
 console.log(`\n━━━━━━━━━━ ${from} → ${to} ━━━━━━━━━━`);
 if(r.status!==0){console.log((r.stderr||r.stdout||'FAILED').trim());continue}
 const out=r.stdout||'';let p=out.indexOf('🏆 CANDIDATE RESULT');console.log((p>=0?out.slice(p):out).replace(/📌 BASELINE:[^\n]*/g,'').trim());
}
console.log('\n📌 PASS idea: candidate should remain profitable across independent years, with no catastrophic PF/DD deterioration.');
