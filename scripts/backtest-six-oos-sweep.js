#!/usr/bin/env node
'use strict';
/**
 * OOS SWEEP for the six-strategy Telegram combo research.
 * Runs the existing final combo engine unchanged over several earlier periods.
 * This is a robustness sweep only: it does NOT touch live strategy files.
 * Each child run still prints all six candidate ledgers, MAX OPEN 2 and TOP combos.
 */
const {spawnSync}=require('child_process');
const path=require('path');
const engine=path.join(__dirname,'backtest-six-final-month-combo.js');
const periods=[
 ['2026-06-01','2026-06-30','JUN-2026'],
 ['2026-05-01','2026-05-31','MAY-2026'],
 ['2026-04-01','2026-04-30','APR-2026'],
 ['2026-03-01','2026-03-31','MAR-2026'],
 ['2026-02-01','2026-02-28','FEB-2026'],
 ['2026-01-01','2026-01-31','JAN-2026'],
 ['2026-03-01','2026-08-29','SIX-MONTH'],
 ['2025-08-29','2026-08-29','ONE-YEAR']
];
console.log('🧪 SIX STRATEGY OOS ROBUSTNESS SWEEP');
console.log('🔒 Research only — live bot untouched');
console.log('ℹ️ All six strategies remain included in every run.');
for(const [from,to,label] of periods){
 console.log(`\n\n══════════════════════════════════════════════════\n📆 ${label}: ${from} → ${to}\n══════════════════════════════════════════════════`);
 const r=spawnSync(process.execPath,[engine,from,to],{stdio:'inherit',env:process.env});
 if(r.error){console.error(`❌ ${label}:`,r.error.message);process.exitCode=1;break}
 if(r.status!==0){console.error(`❌ ${label} exited ${r.status}`);process.exitCode=r.status||1;break}
}
console.log('\n✅ OOS sweep finished. Compare repeated winners, WR, Winning Days, activity, LS and DD before any live change.');
