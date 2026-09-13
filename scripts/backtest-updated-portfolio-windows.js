'use strict';
// RESEARCH ONLY — runs the latest updated portfolio over rolling windows.
// No live strategy files are imported or modified.
const {spawnSync}=require('child_process');
const path=require('path');
const runner=path.join(__dirname,'backtest-all-live-gold-strategies-updated.js');
const END=process.env.PORTFOLIO_END||'2026-08-24T23:59:59Z';
const endMs=Date.parse(END);
if(!Number.isFinite(endMs))throw new Error('Bad PORTFOLIO_END');
const DAY=86400000;
const windows=[['1Y',365],['180D',180],['90D',90],['60D',60],['30D',30]];
console.log('📊 UPDATED PORTFOLIO — ROLLING WINDOWS');
console.log('Pro19/no08BUY | Micro BUY-only 2ATR/2ATR | Exhaustion E3 | Rapid R1 23h/no20UTC');
console.log('END '+new Date(endMs).toISOString());
for(const [name,days] of windows){
 const from=new Date(endMs-(days-1)*DAY);from.setUTCHours(0,0,0,0);
 console.log('\n━━━━━━━━ '+name+' | '+from.toISOString().slice(0,10)+' → '+new Date(endMs).toISOString().slice(0,10)+' ━━━━━━━━');
 const r=spawnSync(process.execPath,[runner],{cwd:path.join(__dirname,'..'),env:{...process.env,BACKTEST_FROM:from.toISOString(),BACKTEST_TO:new Date(endMs).toISOString()},encoding:'utf8',maxBuffer:10*1024*1024});
 if(r.error)throw r.error;
 if(r.status!==0){process.stderr.write(r.stderr||'');process.exit(r.status||1)}
 const lines=(r.stdout||'').split(/\r?\n/).filter(x=>/^(EXHAUSTION|RAPID|GROK92|PRO\s|RANGE|SWEEP5|MICRO|TOTAL)\s/.test(x));
 for(const line of lines)console.log(line);
}
console.log('\nDONE — READ ONLY');
