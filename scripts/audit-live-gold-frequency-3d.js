'use strict';

/**
 * 3-day LIVE frequency audit.
 *
 * IMPORTANT: This does NOT change trading or VIP routing.
 * It repeatedly invokes the production gold scanner and records exactly what
 * the currently configured live data/provider + production strategies report.
 *
 * This is a forward audit (not a historical replay): run it while the bot is
 * live to build evidence about why strategies remain WAIT.
 * For true historical Binance/PAXG replay we need to reuse/export the provider
 * history path rather than pretend production scan() accepts arbitrary candles.
 */

const fs = require('fs');
const path = require('path');
const { scanGoldScalp } = require('../src/services/goldScalper');

const OUT = path.join(__dirname, '..', 'data', 'gold-live-frequency-audit.jsonl');
const INTERVAL_MS = Math.max(60_000, Number(process.env.AUDIT_INTERVAL_MS || 5 * 60_000));

function nowIso(){ return new Date().toISOString(); }
function ensureDir(){ fs.mkdirSync(path.dirname(OUT), { recursive:true }); }
function append(row){ ensureDir(); fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); }

function summarize(rows){
  const s = new Map();
  for(const row of rows){
    for(const x of row.checks || []){
      const key=x.strategyLabel || x.strategyId || 'UNKNOWN';
      if(!s.has(key)) s.set(key,{scans:0,ready:0,statuses:{}});
      const z=s.get(key); z.scans++; if(x.ready) z.ready++;
      const st=x.status || 'UNKNOWN'; z.statuses[st]=(z.statuses[st]||0)+1;
    }
  }
  return s;
}

function readRows(){
  if(!fs.existsSync(OUT)) return [];
  return fs.readFileSync(OUT,'utf8').split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
}

function printSummary(){
  const rows=readRows();
  const since=Date.now()-3*24*60*60*1000;
  const recent=rows.filter(x=>new Date(x.time).getTime()>=since);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 GOLD LIVE FREQUENCY AUDIT — LAST 3 DAYS');
  console.log(`Scans recorded: ${recent.length}`);
  for(const [name,z] of summarize(recent)){
    const top=Object.entries(z.statuses).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}=${v}`).join(' | ');
    console.log(`${name} | READY ${z.ready}/${z.scans} | ${top}`);
  }
  console.log(`📝 ${OUT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function once(){
  const t=nowIso();
  try{
    const r=await scanGoldScalp();
    const checks=Array.isArray(r?.strategyChecks)?r.strategyChecks:[];
    const ready=Array.isArray(r?.readyStrategies)?r.readyStrategies:[];
    append({time:t,checks,ready});
    console.log(`🧪 AUDIT ${t} | ready=${ready.length} | ${checks.map(x=>`${x.strategyLabel}:${x.status}`).join(' || ')}`);
  }catch(e){
    append({time:t,error:e.message});
    console.error('❌ AUDIT',e.message);
  }
}

(async()=>{
  if(process.argv.includes('--summary')) return printSummary();
  if(process.argv.includes('--once')) { await once(); return printSummary(); }
  console.log('🧪 Gold live frequency audit started');
  console.log(`⏱️ Interval ${Math.round(INTERVAL_MS/60000)}m | output ${OUT}`);
  console.log('⚠️ Forward production-data audit only; trading/VIP untouched.');
  await once();
  setInterval(once,INTERVAL_MS);
})().catch(e=>{console.error(e);process.exit(1)});
