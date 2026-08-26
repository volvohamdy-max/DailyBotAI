#!/usr/bin/env node
'use strict';
// Recent parity audit: same exact 6-strategy portfolio rules, Binance PAXG M5 only.
// AUDIT ONLY. Does not alter live strategies or VIP routing.
const {spawnSync}=require('child_process');
const path=require('path');
const FROM=(process.argv.find(x=>x.startsWith('--from='))||'--from=2026-08-24').split('=')[1];
const TO=(process.argv.find(x=>x.startsWith('--to='))||'--to=2026-08-26').split('=')[1];
function run(file,args){const r=spawnSync(process.execPath,[path.resolve(file),...args],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔎 BINANCE PAXG — RECENT EXACT LIVE REPLAY');
console.log(`📅 ${FROM} → ${TO}`);
console.log('📌 Same six live rule-sets / MAX OPEN 2');
console.log('🔒 Audit only — live/VIP untouched');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
run('scripts/download-binance-paxg-m5-history.js',[FROM,TO]);
run('scripts/run-live-gold-portfolio-on-paxg.js',[FROM,TO]);
console.log('\n📌 Compare RAW/ACCEPTED counts above with Telegram/live audit for the same dates.');
console.log('If replay finds signals live did not send, investigate scanner timing/data/routing before changing strategy conditions.');