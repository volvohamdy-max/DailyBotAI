'use strict';
/* CURRENT 8 LIVE GOLD STRATEGIES — EXACT 3-YEAR PERIOD TEST
   Uses the canonical 7+Q15 engine; no strategy rules are reimplemented.
   Downloads extra history only as causal indicator warmup, while REPORT_FROM/TO
   makes every printed metric strictly belong to the requested period. */
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {getHistoricalRates}=require('dukascopy-node');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data','xauusd-m5-dukascopy.json');
const CACHE=path.join(ROOT,'data','xauusd-m5-dukascopy-3y-warmup-20230701-20260917.json');
const ENGINE=path.join(ROOT,'scripts','portfolio-q15-exact-merge-20260916.js');
const TEMP=path.join(ROOT,'scripts','.tmp-8strategy-period-engine.js');
const BACKUP=DATA+'.before-3y-test';
const periods=[
 ['YEAR 1 | 2023-09-17 → 2024-09-17','2023-09-17','2024-09-17'],
 ['YEAR 2 | 2024-09-17 → 2025-09-17','2024-09-17','2025-09-17'],
 ['YEAR 3 | 2025-09-17 → 2026-09-17','2025-09-17','2026-09-17'],
 ['FULL 3Y | 2023-09-17 → 2026-09-17','2023-09-17','2026-09-17']
];
const ts=s=>Date.parse(s+'T00:00:00Z');
function norm(a){return a.map(x=>({timestamp:+(x.timestamp??x.time),open:+(x.open??x.o),high:+(x.high??x.h),low:+(x.low??x.l),close:+(x.close??x.c),volume:+(x.volume??x.v??0)})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
async function data(){
 if(fs.existsSync(CACHE)){const d=norm(JSON.parse(fs.readFileSync(CACHE,'utf8')));if(d.length>100000){console.log(`♻️ Cached M5: ${d.length}`);return d}}
 console.log('⬇️ Dukascopy XAUUSD M5: 2023-07-01 → 2026-09-17 (first 78 days = warmup only)');
 const d=norm(await getHistoricalRates({instrument:'xauusd',dates:{from:new Date('2023-07-01T00:00:00Z'),to:new Date('2026-09-17T00:00:00Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:500,retryCount:3,pauseBetweenRetriesMs:1500}));
 if(d.length<100000)throw Error('Too few candles: '+d.length);fs.writeFileSync(CACHE,JSON.stringify(d));console.log(`✅ Downloaded ${d.length} candles`);return d;
}
function makePeriodEngine(){
 let s=fs.readFileSync(ENGINE,'utf8');
 const old="function flat(keys){return keys.flatMap(k=>E.trades[k].map(t=>({...t,k}))).sort((a,b)=>a.exit-b.exit||a.entryI-b.entryI)}";
 const neu="const REPORT_FROM=+(process.env.REPORT_FROM||0),REPORT_TO=+(process.env.REPORT_TO||Infinity);function flat(keys){return keys.flatMap(k=>E.trades[k].map(t=>({...t,k}))).filter(t=>t.exit>=REPORT_FROM&&t.exit<REPORT_TO).sort((a,b)=>a.exit-b.exit||a.entryI-b.entryI)}";
 if(!s.includes(old))throw Error('Canonical flat() anchor changed');s=s.replace(old,neu);
 const anchor="console.log('EXACT TRADE-LEVEL MERGE — 7 vs 7+Q15');";
 const add=`console.log('\\nPER-STRATEGY STRICT PERIOD');for(const k of [...seven,'Q15']){const z=flat([k]),qz=st(z),worst=z.length?Math.min(...z.map(x=>x.r)):NaN;console.log(k.padEnd(10)+' | '+f(qz)+' MAXLOSS '+(Number.isFinite(worst)?worst.toFixed(2)+'R':'NA'));}console.log('\\nPORTFOLIO STRICT PERIOD');`;
 if(!s.includes(anchor))throw Error('Canonical report anchor changed');s=s.replace(anchor,add+anchor);
 fs.writeFileSync(TEMP,s);
}
function run(label,all,from,to){
 const a=ts(from),b=ts(to),warm=a-78*86400000,slice=all.filter(x=>x.timestamp>=warm&&x.timestamp<b);fs.writeFileSync(DATA,JSON.stringify(slice));
 console.log('\n'+'='.repeat(96));console.log('🧪 '+label);console.log(`Measured strictly: ${from} → ${to} | loaded ${slice.length} M5 incl. causal warmup`);console.log('='.repeat(96));
 const r=cp.spawnSync(process.execPath,[TEMP],{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,REPORT_FROM:String(a),REPORT_TO:String(b)}});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.status!==0)throw Error('Engine failed: '+label);
}
(async()=>{let had=fs.existsSync(DATA);if(had)fs.copyFileSync(DATA,BACKUP);try{if(!fs.existsSync(ENGINE))throw Error('Missing canonical engine');makePeriodEngine();const all=await data();console.log(`📚 Loaded ${new Date(all[0].timestamp).toISOString()} → ${new Date(all.at(-1).timestamp).toISOString()}`);for(const p of periods)run(p[0],all,p[1],p[2]);console.log('\n✅ DONE — each strategy: T / WR / PF / NET R / DD / LS / MAXLOSS; plus 8-strategy portfolio.');}finally{if(fs.existsSync(TEMP))fs.unlinkSync(TEMP);if(had&&fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP);console.log('♻️ Original data restored.')}else if(!had&&fs.existsSync(DATA))fs.unlinkSync(DATA)}})().catch(e=>{console.error('❌',e.stack||e);try{if(fs.existsSync(TEMP))fs.unlinkSync(TEMP);if(fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP)}}catch{}process.exit(1)});
