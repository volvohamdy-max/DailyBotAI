#!/usr/bin/env node
'use strict';

/*
 * One-pass detailed ledger for the exact six-live-strategy backtest.
 * Runs the full period ONCE through the canonical exact engine, captures its
 * accepted trade ledger via an opt-in JSON export, then reports month/side.
 * Research only; no live/VIP files are touched.
 */
const {spawnSync}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const FROM=process.argv[2]||'2025-08-29';
const TO=process.argv[3]||'2026-08-29';
const engine=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');
const tmp=path.join(os.tmpdir(),`dailybot-six-ledger-${process.pid}.json`);
const r=spawnSync(process.execPath,[engine,FROM,TO],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',env:{...process.env,BACKTEST_LEDGER_JSON:tmp}});
if(r.error){console.error(r.error);process.exit(1)}
if(r.status!==0)process.exit(r.status||1);
if(!fs.existsSync(tmp)){console.error('\n❌ Ledger export missing. Pull latest exact engine commit and retry.');process.exit(1)}
const data=JSON.parse(fs.readFileSync(tmp,'utf8'));try{fs.unlinkSync(tmp)}catch{}
const trades=data.accepted||[];
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,ml=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ml=Math.max(ml,++ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?100*w/t.length:0,net,pf:gl?gp/gl:(gp?999:0),dd,ls:ml}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;
const names=['EXHAUST','RAPID','GROK92','PRO','RANGE','SWEEP5'];
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('📆 TRUE ONE-PASS MONTHLY LEDGER');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const months=[...new Set(trades.map(x=>new Date(x.time).toISOString().slice(0,7)))].sort();
for(const m of months){const z=trades.filter(x=>new Date(x.time).toISOString().slice(0,7)===m);console.log(`\n🗓️ ${m} | TOTAL ${fmt(stats(z))}`);for(const n of names){const q=z.filter(x=>x.strategy===n);console.log(`${n.padEnd(7)} ${fmt(stats(q))}`)}}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('↕️ BUY / SELL — FULL YEAR');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for(const n of names){console.log(`\n${n}`);for(const side of ['BUY','SELL'])console.log(`  ${side.padEnd(4)} ${fmt(stats(trades.filter(x=>x.strategy===n&&x.side===side)))}`)}
console.log('\n🏆 PORTFOLIO BY SIDE');for(const side of ['BUY','SELL'])console.log(`${side.padEnd(4)} ${fmt(stats(trades.filter(x=>x.side===side)))}`);
console.log(`\n✅ Ledger integrity: ${trades.length} accepted trades | engine reported ${data.acceptedCount}`);console.log('🔒 Research only. Live strategies/VIP routing untouched.');