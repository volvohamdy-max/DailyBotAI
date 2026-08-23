const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { getHistoricalRates } = require('dukascopy-node');

const ROOT = path.join(process.cwd(),'data','signal-lab-history');
const YEARS = Math.max(1, Number(process.env.SIGNAL_LAB_HISTORY_YEARS || 5));
const SYMBOL = 'XAUUSD';
const CHUNK_DAYS = Math.max(7, Number(process.env.SIGNAL_LAB_CHUNK_DAYS || 30));
const RETRIES = Math.max(1, Number(process.env.SIGNAL_LAB_RETRIES || 8));
const BASE_BACKOFF_MS = Math.max(5000, Number(process.env.SIGNAL_LAB_BACKOFF_MS || 15000));
const BETWEEN_CHUNKS_MS = Math.max(2000, Number(process.env.SIGNAL_LAB_BETWEEN_CHUNKS_MS || 5000));

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function normalize(rows){return (Array.isArray(rows)?rows:[]).map(r=>({timestamp:Number(r.timestamp),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number.isFinite(Number(r.volume))?Number(r.volume):null})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
function merge(a,b){const m=new Map();for(const x of [...a,...b])m.set(x.timestamp,x);return [...m.values()].sort((x,y)=>x.timestamp-y.timestamp)}
function fileFor(){return path.join(ROOT,`${SYMBOL}-m5.json.gz`)}
function loadExisting(){const f=fileFor();if(!fs.existsSync(f))return[];try{return normalize(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')))}catch(e){console.log(`⚠️ Could not read existing ${SYMBOL}: ${e.message}`);return[]}}
function save(rows){fs.mkdirSync(ROOT,{recursive:true});const tmp=fileFor()+'.tmp';fs.writeFileSync(tmp,zlib.gzipSync(Buffer.from(JSON.stringify(rows))));fs.renameSync(tmp,fileFor());}
function is429(e){return Number(e?.response?.status)===429 || /\b429\b/.test(String(e?.message||''));}
async function fetchChunk(from,to){for(let attempt=1;attempt<=RETRIES;attempt++){try{return normalize(await getHistoricalRates({instrument:'xauusd',dates:{from,to},timeframe:'m5',format:'json',priceType:'bid',volumes:true,batchSize:1,pauseBetweenBatchesMs:2500,useCache:true,cacheFolderPath:'./data/dukascopy-cache',retryCount:0,retryOnEmpty:false}))}catch(e){if(!is429(e)||attempt===RETRIES)throw e;const wait=BASE_BACKOFF_MS*Math.pow(2,attempt-1);console.log(`  🧊 ${SYMBOL} 429 | retry ${attempt}/${RETRIES} after ${Math.round(wait/1000)}s`);await sleep(wait)}}return[]}
async function main(){let existing=loadExisting(),now=new Date(),targetStart=new Date(now);targetStart.setUTCFullYear(targetStart.getUTCFullYear()-YEARS);targetStart.setUTCHours(0,0,0,0);let cursor=existing.length?new Date(existing.at(-1).timestamp+300000):targetStart;if(cursor<targetStart)cursor=targetStart;console.log(`🧠 SIGNAL LAB GOLD HISTORY — DUKASCOPY M5 | ${YEARS} years`);if(existing.length)console.log(`📦 ${SYMBOL}: existing ${existing.length} | last=${new Date(existing.at(-1).timestamp).toISOString()}`);else console.log(`📥 ${SYMBOL}: initial 5-year download`);while(cursor<now){const end=new Date(Math.min(now.getTime(),cursor.getTime()+CHUNK_DAYS*86400000));console.log(`  ↳ ${cursor.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`);try{const rows=await fetchChunk(cursor,end);existing=merge(existing,rows);save(existing);console.log(`  ✅ +${rows.length} | total=${existing.length}`)}catch(e){console.log(`  ❌ chunk failed: ${e.message}`);console.log('  💾 Progress already saved; run again later to resume.');return}cursor=new Date(end.getTime()+300000);await sleep(BETWEEN_CHUNKS_MS)}console.log(`✅ ${SYMBOL}: ${existing.length} M5 candles | ${(fs.statSync(fileFor()).size/1024/1024).toFixed(1)} MB gz`)}
main().catch(e=>{console.error(e);process.exit(1)});
