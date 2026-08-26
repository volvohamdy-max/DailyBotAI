#!/usr/bin/env node
'use strict';

/**
 * Exact 3-day replay wrapper for the 6-strategy portfolio backtest.
 * Research/audit only: does not import the bot, send Telegram messages,
 * change strategy files, or touch VIP routing.
 *
 * It deliberately runs the already-validated exact portfolio runner so the
 * replay cannot silently drift into a second copy of the strategy logic.
 */

const { spawnSync } = require('child_process');
const path = require('path');

function isoDay(d){ return d.toISOString().slice(0,10); }

function arg(name){
  const p=`--${name}=`;
  const x=process.argv.find(v=>v.startsWith(p));
  return x ? x.slice(p.length) : null;
}

const toArg=arg('to');
const days=Math.max(1,Number(arg('days')||3));
const to=toArg ? new Date(`${toArg}T23:59:59Z`) : new Date();
if(Number.isNaN(to.getTime())) throw new Error('Invalid --to date');

// Calendar lookback is intentionally wider than N days because XAUUSD is
// closed over the weekend. We print only the exact runner result for this
// requested window; use --from explicitly when auditing a known incident.
let fromArg=arg('from');
let from;
if(fromArg){
  from=new Date(`${fromArg}T00:00:00Z`);
  if(Number.isNaN(from.getTime())) throw new Error('Invalid --from date');
}else{
  from=new Date(to);
  from.setUTCDate(from.getUTCDate()-(days-1));
  from.setUTCHours(0,0,0,0);
}

const FROM=isoDay(from), TO=isoDay(to);
const runner=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔎 LIVE GOLD — EXACT RECENT REPLAY AUDIT');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🧠 Engine: existing exact 6-strategy portfolio runner');
console.log('🔒 AUDIT ONLY — live/VIP untouched');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const r=spawnSync(process.execPath,[runner,FROM,TO],{
  cwd:path.join(__dirname,'..'),
  stdio:'inherit',
  env:process.env
});

if(r.error){
  console.error('❌ Replay failed:',r.error.message);
  process.exit(1);
}
if(r.status!==0){
  console.error(`❌ Exact portfolio runner exited ${r.status}`);
  process.exit(r.status||1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📌 READ THIS RESULT AS:');
console.log('1) RAW COMPONENT LEDGERS = historical signals each live rule-set should find.');
console.log('2) PORTFOLIO MAX OPEN=2 = signals surviving the portfolio concurrency rule.');
console.log('3) Compare these counts/times with Telegram/live audit evidence.');
console.log('4) A large replay-vs-live gap means execution/data/scanner parity needs investigation;');
console.log('   it does NOT by itself justify loosening strategy conditions.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
