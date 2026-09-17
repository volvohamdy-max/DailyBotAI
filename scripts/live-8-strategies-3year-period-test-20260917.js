'use strict';
/* CURRENT 8 LIVE GOLD STRATEGIES — 3 YEAR PERIOD TEST
   Resumable Dukascopy downloader: one calendar month at a time, disk cache per month,
   exponential backoff on 429/network failures. Strategy engine remains unchanged.
*/
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {getHistoricalRates}=require('dukascopy-node');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data','xauusd-m5-dukascopy.json');
const CACHE_DIR=path.join(ROOT,'data','dukascopy-xauusd-m5-months');
const CACHE3=path.join(ROOT,'data','xauusd-m5-dukascopy-3y-20230701-20260917.json');
const ENGINE=path.join(ROOT,'scripts','portfolio-q15-exact-merge-20260916.js');
const BACKUP=DATA+'.before-3y-test';
const START='2023-07-01', END='2026-09-17';
const periods=[
 ['YEAR 1 | 2023-09-17 → 2024-09-17','2023-09-17','2024-09-17'],
 ['YEAR 2 | 2024-09-17 → 2025-09-17','2024-09-17','2025-09-17'],
 ['YEAR 3 | 2025-09-17 → 2026-09-17','2025-09-17','2026-09-17'],
 ['FULL 3Y | 2023-09-17 → 2026-09-17','2023-09-17','2026-09-17']
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)), ts=s=>Date.parse(s+'T00:00:00Z');
function norm(a){return (a||[]).map(x=>({timestamp:+(x.timestamp??x.time),open:+(x.open??x.o),high:+(x.high??x.h),low:+(x.low??x.l),close:+(x.close??x.c),volume:+(x.volume??x.v??0)})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
function months(from,to){let out=[],d=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));while(d<end){let n=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));let a=new Date(Math.max(d.getTime(),Date.parse(from+'T00:00:00Z'))),b=new Date(Math.min(n.getTime(),end.getTime()));out.push([a,b]);d=n}return out}
async function fetchMonth(a,b,file){
 for(let attempt=1;attempt<=8;attempt++){
  try{
   console.log(`⬇️ ${a.toISOString().slice(0,10)} → ${b.toISOString().slice(0,10)} | attempt ${attempt}/8`);
   const x=norm(await getHistoricalRates({instrument:'xauusd',dates:{from:a,to:b},timeframe:'m5',format:'json',volumes:true,batchSize:1,pauseBetweenBatchesMs:1800,retryCount:1,pauseBetweenRetriesMs:3000}));
   if(!x.length)throw new Error('empty month');
   fs.writeFileSync(file,JSON.stringify(x));console.log(`   ✅ ${x.length} candles cached`);return x;
  }catch(e){
   const msg=String(e&&e.message||e),wait=Math.min(120000,10000*Math.pow(1.65,attempt-1));
   console.log(`   ⚠️ ${msg} — waiting ${(wait/1000).toFixed(0)}s`);
   if(attempt===8)throw e;await sleep(wait);
  }
 }
}
async function data(){
 fs.mkdirSync(CACHE_DIR,{recursive:true});
 if(fs.existsSync(CACHE3)){const x=norm(JSON.parse(fs.readFileSync(CACHE3,'utf8')));if(x.length>150000){console.log(`♻️ Complete 3Y cache: ${x.length} candles`);return x}}
 const parts=[];
 for(const [a,b] of months(START,END)){
  const key=a.toISOString().slice(0,7),file=path.join(CACHE_DIR,key+'.json');let x;
  if(fs.existsSync(file)){try{x=norm(JSON.parse(fs.readFileSync(file,'utf8')))}catch{x=[]}}
  if(x&&x.length){console.log(`♻️ ${key}: ${x.length} cached`)}else{x=await fetchMonth(a,b,file);await sleep(5000)}
  parts.push(...x);
 }
 const map=new Map();for(const x of parts)map.set(x.timestamp,x);const all=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp);
 if(all.length<150000)throw new Error('3Y dataset too small: '+all.length);
 fs.writeFileSync(CACHE3,JSON.stringify(all));console.log(`✅ COMPLETE DATASET: ${all.length} M5 candles`);return all;
}
function run(label,all,from,to){
 const a=ts(from),b=ts(to),warm=a-78*86400000,slice=all.filter(x=>x.timestamp>=warm&&x.timestamp<b);
 fs.writeFileSync(DATA,JSON.stringify(slice));
 console.log('\n'+'='.repeat(88));console.log('🧪 '+label);console.log(`M5 including 78d warmup: ${slice.length}`);console.log('='.repeat(88));
 const r=cp.spawnSync(process.execPath,[ENGINE],{cwd:ROOT,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,BACKTEST_REPORT_FROM:String(a),BACKTEST_REPORT_TO:String(b)}});
 process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.status!==0)throw new Error('engine exit '+r.status);
}
(async()=>{let had=fs.existsSync(DATA);if(had)fs.copyFileSync(DATA,BACKUP);try{const all=await data();console.log(`📚 ${new Date(all[0].timestamp).toISOString()} → ${new Date(all.at(-1).timestamp).toISOString()}`);for(const p of periods)run(p[0],all,p[1],p[2]);console.log('\n✅ 3-YEAR TEST COMPLETE')}finally{if(had&&fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP);console.log('♻️ Original data restored.')}else if(!had&&fs.existsSync(DATA))fs.unlinkSync(DATA)}})().catch(e=>{console.error('❌',e&&e.stack||e);try{if(fs.existsSync(BACKUP)){fs.copyFileSync(BACKUP,DATA);fs.unlinkSync(BACKUP)}}catch{}process.exit(1)});