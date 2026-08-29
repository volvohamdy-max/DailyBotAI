#!/usr/bin/env node
'use strict';

/*
 * Detailed diagnostic runner for the exact SIX live gold strategies.
 * It runs the existing exact engine month-by-month and by side without
 * changing any live strategy/VIP code. Dukascopy cache is reused.
 *
 * Default period: 2025-08-29 -> 2026-08-29
 */

const { spawnSync } = require('child_process');
const path = require('path');

const FROM = process.argv[2] || '2025-08-29';
const TO = process.argv[3] || '2026-08-29';
const engine = path.join(__dirname, 'backtest-live-gold-portfolio-6-exact.js');

function iso(d){ return d.toISOString().slice(0,10); }
function monthRanges(from,to){
  const start=new Date(from+'T00:00:00Z'), end=new Date(to+'T00:00:00Z');
  const out=[];
  let cur=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));
  while(cur<=end){
    const ms=new Date(Math.max(cur.getTime(),start.getTime()));
    const next=new Date(Date.UTC(cur.getUTCFullYear(),cur.getUTCMonth()+1,1));
    const me=new Date(Math.min(next.getTime()-86400000,end.getTime()));
    if(ms<=me) out.push([iso(ms),iso(me)]);
    cur=next;
  }
  return out;
}

function run(from,to){
  const r=spawnSync(process.execPath,[engine,from,to],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:process.env,
    maxBuffer:1024*1024*20
  });
  if(r.error) throw r.error;
  if(r.status!==0) throw new Error((r.stderr||r.stdout||'backtest failed').trim());
  return r.stdout;
}

function parseLine(line){
  const m=line.match(/(\d+) trades \| WR ([\d.]+)% \| Net ([+-]?[\d.]+)R \| PF ([\d.]+) \| DD ([\d.]+)R \| LS (\d+)/);
  if(!m)return null;
  return {n:+m[1],wr:+m[2],net:+m[3],pf:+m[4],dd:+m[5],ls:+m[6]};
}
function extract(text){
  const names=['EXHAUST','RAPID','GROK92','PRO','RANGE','SWEEP5'];
  const result={};
  for(const name of names){
    const line=text.split('\n').find(x=>x.startsWith(name.padEnd(7))||x.startsWith(name+' |'));
    result[name]=line?parseLine(line):null;
  }
  const p=text.split('\n').find(x=>/^\d+ trades \| WR/.test(x.trim()));
  result.PORTFOLIO=p?parseLine(p):null;
  return result;
}
function fmt(x){return !x?'n/a':`${x.n} | WR ${x.wr.toFixed(1)}% | Net ${x.net>=0?'+':''}${x.net.toFixed(2)}R | PF ${x.pf.toFixed(2)} | DD ${x.dd.toFixed(2)}R | LS ${x.ls}`;}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📆 LIVE SIX — MONTH-BY-MONTH DIAGNOSTIC');
console.log(`📅 ${FROM} → ${TO}`);
console.log('📦 Dukascopy cache reused | live code untouched');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for(const [a,b] of monthRanges(FROM,TO)){
  console.log(`\n🗓️ ${a.slice(0,7)} | ${a} → ${b}`);
  const z=extract(run(a,b));
  for(const n of ['EXHAUST','RAPID','GROK92','PRO','RANGE','SWEEP5']) console.log(`${n.padEnd(7)} ${fmt(z[n])}`);
  console.log(`TOTAL   ${fmt(z.PORTFOLIO)}`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('↕️ BUY / SELL BREAKDOWN');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('The exact engine records side on every trade.');
console.log('For a true one-pass side ledger (including portfolio MAX2), use:');
console.log('node scripts/backtest-live-six-side-ledger.js '+FROM+' '+TO);
