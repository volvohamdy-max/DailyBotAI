'use strict';
// READ-ONLY walk-forward wrapper for the 24H session lab. LIVE FILES UNCHANGED.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const lab=path.join(__dirname,'backtest-live-hours-24h-lab.js');
if(!fs.existsSync(lab))throw Error('Missing backtest-live-hours-24h-lab.js');
const periods=[
 ['P1','2025-09-10','2025-12-09'],
 ['P2','2025-12-10','2026-03-09'],
 ['P3','2026-03-10','2026-06-09'],
 ['P4','2026-06-10','2026-09-10']
];
const keep=new Set(['EXHAUSTION','RAPID','PRO','MICRO']);
console.log('\n🧪 WALK-FORWARD HOURS VALIDATION — READ ONLY');
console.log('4 independent ~3-month windows | Exhaustion / Rapid / Pro / Micro');
for(const [name,from,to] of periods){
 console.log(`\n================ ${name} | ${from} -> ${to} ================`);
 const out=cp.execFileSync(process.execPath,[lab],{encoding:'utf8',env:{...process.env,BACKTEST_FROM:from+'T00:00:00Z',BACKTEST_TO:to+'T23:59:59Z'},maxBuffer:20*1024*1024});
 const lines=out.split(/\r?\n/);let active=false;
 for(const line of lines){
   const h=line.trim();
   if(keep.has(h)){active=true;console.log('\n'+h);continue}
   if(['SWEEP5'].includes(h)){active=false;continue}
   if(active&&(h.startsWith('CURRENT |')||h.startsWith('24H     |')||h.startsWith('EXTRA   |')))console.log(h);
 }
}
console.log('\nDECISION GUIDE');
console.log('- Prefer 24H only if performance is reasonably stable across windows, not carried by one period.');
console.log('- Compare WR/PF/NetR/DD against CURRENT in every window.');
console.log('- No live file is imported, edited, or executed by this script.');
console.log('\n🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');