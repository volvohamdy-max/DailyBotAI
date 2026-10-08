'use strict';

/**
 * Diagnostic-only audit for the six live gold strategies.
 * Does not send Telegram messages and does not change strategy filters.
 * Run: node scripts/audit-gold-live-parity.js
 */

const strategies = [
  ['EXHAUST', require('../src/services/scalpStrategies/goldExhaustionV3Strategy').scan],
  ['RAPID', require('../src/services/scalpStrategies/goldRapidScalpStrategy').scan],
  ['GROK92', require('../src/services/scalpStrategies/grokGold92Strategy').scanGrokGold92Strategy],
  ['PRO', require('../src/services/scalpStrategies/proStrategy').scan],
  ['RANGE', require('../src/services/scalpStrategies/goldRangeMrStrategy').scan],
  ['SWEEP5', require('../src/services/scalpStrategies/goldSweep5Strategy').scan]
];

const counts = new Map();
function bump(name, status) {
  const key = `${name}|${status}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}

async function runOne(name, scan) {
  const started = Date.now();
  try {
    if (typeof scan !== 'function') {
      bump(name, 'EXPORT_MISSING');
      return { strategy:name, ready:false, status:'EXPORT_MISSING' };
    }
    const result = await scan();
    const status = result?.status || 'NO_STATUS';
    bump(name, status);
    return {
      strategy:name,
      ready:!!result?.ready,
      status,
      direction:result?.direction || null,
      signalBar:result?.signalBar || null,
      entry:Number.isFinite(Number(result?.entry)) ? Number(result.entry) : null,
      ms:Date.now()-started
    };
  } catch (e) {
    const status = `ERROR:${e?.message || e}`;
    bump(name, status);
    return { strategy:name, ready:false, status, ms:Date.now()-started };
  }
}

(async()=>{
  console.log('━━━━━━━━ GOLD LIVE PARITY DIAGNOSTIC ━━━━━━━━');
  console.log('UTC', new Date().toISOString());
  console.log('Diagnostic only: no Telegram delivery / no filter changes.');
  const rows=[];
  for (const [name,scan] of strategies) rows.push(await runOne(name,scan));
  console.table(rows);
  console.log('\nBlocker counters:');
  for (const [key,n] of [...counts].sort()) console.log(`${key} = ${n}`);
  console.log('\nImportant parity checks:');
  console.log('- EXHAUST/RAPID/RANGE/SWEEP use goldCandleRecovery (PAXG proxy).');
  console.log('- GROK92 currently uses marketService candles and may recover H1 via Dukascopy.');
  console.log('- PRO uses PAXG M5 but its daily bias is built from Dukascopy history.');
  console.log('- Therefore candle-source parity is NOT yet uniform across all six strategies.');
})().catch(e=>{ console.error(e); process.exit(1); });
