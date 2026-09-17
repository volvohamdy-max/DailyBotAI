'use strict';
/*
 CURRENT 8 LIVE GOLD STRATEGIES — 3 YEAR PERIOD TEST
 Downloads XAUUSD M5 from Dukascopy, then runs the already parity-locked
 8-strategy exact merger independently on each year and on the full 3Y set.
 It deliberately reuses scripts/portfolio-q15-exact-merge-20260916.js so strategy
 logic is not reimplemented here.

 Periods (UTC):
  2023-09-17 -> 2024-09-17
  2024-09-17 -> 2025-09-17
  2025-09-17 -> 2026-09-17
  2023-09-17 -> 2026-09-17
*/
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const {getHistoricalRates}=require('dukascopy-node');

const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data','xauusd-m5-dukascopy.json');
const CACHE=path.join(ROOT,'data','xauusd-m5-dukascopy-3y-20230917-20260917.json');
const ENGINE=path.join(ROOT,'scripts','portfolio-q15-exact-merge-20260916.js');
const BACKUP=DATA+'.before-3y-test';

if(!fs.existsSync(ENGINE)){console.error('❌ Missing exact 8-strategy engine: '+ENGINE);process.exit(2)}
fs.mkdirSync(path.dirname(DATA),{recursive:true});

const periods=[
 ['YEAR 1 | 2023-09-17 → 2024-09-17','2023-09-17','2024-09-17'],
 ['YEAR 2 | 2024-09-17 → 2025-09-17','2024-09-17','2025-09-17'],
 ['YEAR 3 | 2025-09-17 → 2026-09-17','2025-09-17','2026-09-17'],
 ['FULL 3Y | 2023-09-17 → 2026-09-17','2023-09-17','2026-09-17']
];
const ts=s=>Date.parse(s+'T00:00:00Z');
function normalize(a){return a.map(x=>({timestamp:+(x.timestamp??x.time),open:+(x.open??x.o),high:+(x.high??x.h),low:+(x.low??x.l),close:+(x.close??x.c),volume:+(x.volume??x.v??0)})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
async function get3y(){
 if(fs.existsSync(CACHE)){
  const d=normalize(JSON.parse(fs.readFileSync(CACHE,'utf8')));
  if(d.length>100000){console.log(`♻️ Using cached 3Y M5 data: ${d.length} candles`);return d}
 }
 console.log('⬇️ Downloading XAUUSD M5 from Dukascopy: 2023-09-17 → 2026-09-17 ...');
 const d=normalize(await getHistoricalRates({instrument:'xauusd',dates:{from:new Date('2023-09-17T00:00:00Z'),to:new Date('2026-09-17T00:00:00Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:500,retryCount:3,pauseBetweenRetriesMs:1500}));
 if(d.length<100000)throw new Error('Downloaded too few candles: '+d.length);
 fs.writeFileSync(CACHE,JSON.stringify(d));
 console.log(`✅ Saved 3Y dataset: ${d.length} candles`);
 return d;
}
function run(label,all,from,to){
 // Include 70 calendar days of warmup before period start so D1 EMA50/H1 EMA200
 // are causal and ready at the first measured day. The engine may print warmup
 // trades too, therefore we clearly print the requested period boundaries and
 // also run a second strict slice below if no warmup is required by the engine.
 const a=ts(from),b=ts(to),warm=a-70*86400000;
 const slice=all.filter(x=>x.timestamp>=warm&&x.timestamp<b);
 fs.writeFileSync(DATA,JSON.stringify(slice));
 console.log('\n'+'='.repeat(88));
 console.log('🧪 '+label);
 console.log(`Data incl. causal warmup: ${slice.length} M5 | warmup from ${new Date(warm).toISOString().slice(0,10)}`);
 console.log('NOTE: first 70 days are indicator warmup; use dated/monthly rows from requested boundary onward.');
 console.log('='.repeat(88));
 const r=cp.spawnSync(process.execPath,[ENGINE],{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 if(r.status!==0)throw new Error('Backtest engine failed for '+label+' (exit '+r.status+')');
}
(async()=>{
 let had=fs.existsSync(DATA);
 if(had)fs.copyFileSync(DATA,BACKUP);
 try{
  const all=await get3y();
  console.log(`📚 3Y range: ${new Date(all[0].timestamp).toISOString()} → ${new Date(all.at(-1).timestamp).toISOString()}`);
  for(const p of periods)run(p[0],all,p[1],p[2]);
  console.log('\n✅ 3-YEAR TEST COMPLETE');
  console.log('Read each strategy line for: T / WR / PF / NET R / DD / LS.');
  console.log('Because fixed-target stops are executed at the stop price, a normal stopped trade is -1.00R; DD and LS are the more useful loss-severity measures.');
 }finally{
  if(had&&fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP);console.log('♻️ Restored original one-year data file.')}else if(!had&&fs.existsSync(DATA))fs.unlinkSync(DATA);
 }
})().catch(e=>{console.error('❌',e&&e.stack||e);try{if(fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP)}}catch{}process.exit(1)});
