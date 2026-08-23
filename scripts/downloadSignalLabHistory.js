const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { getHistoricalRates } = require('dukascopy-node');

const ROOT = path.join(process.cwd(),'data','signal-lab-history');
const YEARS = Math.max(1, Number(process.env.SIGNAL_LAB_HISTORY_YEARS || 5));
const DEFAULT_PAIRS = ['XAUUSD','EURUSD','GBPUSD','USDJPY','GBPJPY','EURJPY','CHFJPY'];
const PAIRS = (process.env.SIGNAL_LAB_PAIRS || process.argv.slice(2).join(',') || DEFAULT_PAIRS.join(','))
  .split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function normalize(rows){return (Array.isArray(rows)?rows:[]).map(r=>({timestamp:Number(r.timestamp),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number.isFinite(Number(r.volume))?Number(r.volume):null})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
function merge(a,b){const m=new Map();for(const x of [...a,...b])m.set(x.timestamp,x);return [...m.values()].sort((x,y)=>x.timestamp-y.timestamp)}
function fileFor(s){return path.join(ROOT,`${s}-m5.json.gz`)}
function loadExisting(s){const f=fileFor(s);if(!fs.existsSync(f))return[];try{return normalize(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')))}catch(e){console.log(`⚠️ Could not read existing ${s}: ${e.message}`);return[]}}
function save(s,rows){fs.mkdirSync(ROOT,{recursive:true});const tmp=fileFor(s)+'.tmp';fs.writeFileSync(tmp,zlib.gzipSync(Buffer.from(JSON.stringify(rows))));fs.renameSync(tmp,fileFor(s));}
async function fetchChunk(symbol,from,to){const rows=await getHistoricalRates({instrument:symbol.toLowerCase(),dates:{from,to},timeframe:'m5',format:'json',priceType:'bid',volumes:true,batchSize:5,pauseBetweenBatchesMs:1200,useCache:true,cacheFolderPath:'./data/dukascopy-cache',retryCount:1,retryOnEmpty:false});return normalize(rows)}
async function downloadSymbol(symbol){let existing=loadExisting(symbol);const now=new Date();const targetStart=new Date(now);targetStart.setUTCFullYear(targetStart.getUTCFullYear()-YEARS);targetStart.setUTCHours(0,0,0,0);let cursor=existing.length?new Date(existing.at(-1).timestamp+5*60000):targetStart;if(cursor<targetStart)cursor=targetStart;if(existing.length)console.log(`📦 ${symbol}: existing ${existing.length} candles | last=${new Date(existing.at(-1).timestamp).toISOString()}`);else console.log(`📥 ${symbol}: downloading ${YEARS} years M5`);
  while(cursor<now){const end=new Date(Math.min(now.getTime(),new Date(Date.UTC(cursor.getUTCFullYear()+1,cursor.getUTCMonth(),cursor.getUTCDate())).getTime()));console.log(`  ↳ ${cursor.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`);try{const rows=await fetchChunk(symbol,cursor,end);existing=merge(existing,rows);save(symbol,existing);console.log(`  ✅ +${rows.length} | total=${existing.length}`);}catch(e){console.log(`  ❌ ${symbol} chunk failed: ${e.message}`);throw e;}cursor=new Date(end.getTime()+5*60000);await sleep(1500)}
  if(existing.length)console.log(`✅ ${symbol}: ${existing.length} M5 candles | ${new Date(existing[0].timestamp).toISOString().slice(0,10)} → ${new Date(existing.at(-1).timestamp).toISOString().slice(0,10)} | ${(fs.statSync(fileFor(symbol)).size/1024/1024).toFixed(1)} MB gz`);
}
(async()=>{console.log(`🧠 SIGNAL LAB HISTORY — DUKASCOPY M5 | ${YEARS} years`);console.log(`Pairs: ${PAIRS.join(', ')}`);fs.mkdirSync(ROOT,{recursive:true});for(const s of PAIRS){if(s==='BTCUSD'){console.log('⏭️ BTCUSD skipped (use Binance history)');continue;}await downloadSymbol(s);}console.log('\n🎯 Signal Lab history download complete.');})().catch(e=>{console.error(e);process.exit(1)});
