const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { getHistoricalRates } = require('dukascopy-node');

const ROOT = path.join(process.cwd(),'data','signal-lab-history');
const YEARS = Math.max(1, Number(process.env.SIGNAL_LAB_HISTORY_YEARS || 5));
const DEFAULT_PAIRS = ['XAUUSD','EURUSD','GBPUSD','USDJPY','GBPJPY','EURJPY','CHFJPY'];
const PAIRS = (process.env.SIGNAL_LAB_PAIRS || process.argv.slice(2).join(',') || DEFAULT_PAIRS.join(','))
  .split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);

const CHUNK_DAYS = Math.max(7, Number(process.env.SIGNAL_LAB_CHUNK_DAYS || 30));
const RETRIES = Math.max(1, Number(process.env.SIGNAL_LAB_RETRIES || 8));
const BASE_BACKOFF_MS = Math.max(5000, Number(process.env.SIGNAL_LAB_BACKOFF_MS || 15000));
const BETWEEN_CHUNKS_MS = Math.max(2000, Number(process.env.SIGNAL_LAB_BETWEEN_CHUNKS_MS || 5000));

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function normalize(rows){return (Array.isArray(rows)?rows:[]).map(r=>({timestamp:Number(r.timestamp),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number.isFinite(Number(r.volume))?Number(r.volume):null})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp)}
function merge(a,b){const m=new Map();for(const x of [...a,...b])m.set(x.timestamp,x);return [...m.values()].sort((x,y)=>x.timestamp-y.timestamp)}
function fileFor(s){return path.join(ROOT,`${s}-m5.json.gz`)}
function loadExisting(s){const f=fileFor(s);if(!fs.existsSync(f))return[];try{return normalize(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')))}catch(e){console.log(`⚠️ Could not read existing ${s}: ${e.message}`);return[]}}
function save(s,rows){fs.mkdirSync(ROOT,{recursive:true});const tmp=fileFor(s)+'.tmp';fs.writeFileSync(tmp,zlib.gzipSync(Buffer.from(JSON.stringify(rows))));fs.renameSync(tmp,fileFor(s));}
function is429(e){return Number(e?.response?.status)===429 || /\b429\b/.test(String(e?.message||''));}

async function fetchChunk(symbol,from,to){
  for(let attempt=1;attempt<=RETRIES;attempt++){
    try{
      const rows=await getHistoricalRates({
        instrument:symbol.toLowerCase(),
        dates:{from,to},
        timeframe:'m5',
        format:'json',
        priceType:'bid',
        volumes:true,
        batchSize:1,
        pauseBetweenBatchesMs:2500,
        useCache:true,
        cacheFolderPath:'./data/dukascopy-cache',
        retryCount:0,
        retryOnEmpty:false
      });
      return normalize(rows);
    }catch(e){
      if(!is429(e) || attempt===RETRIES) throw e;
      const wait=BASE_BACKOFF_MS*Math.pow(2,attempt-1);
      console.log(`  🧊 ${symbol} 429 rate limit | retry ${attempt}/${RETRIES} after ${Math.round(wait/1000)}s`);
      await sleep(wait);
    }
  }
  return [];
}

async function downloadSymbol(symbol){
  let existing=loadExisting(symbol);
  const now=new Date();
  const targetStart=new Date(now);
  targetStart.setUTCFullYear(targetStart.getUTCFullYear()-YEARS);
  targetStart.setUTCHours(0,0,0,0);

  let cursor=existing.length?new Date(existing.at(-1).timestamp+5*60000):targetStart;
  if(cursor<targetStart)cursor=targetStart;

  if(existing.length)console.log(`📦 ${symbol}: existing ${existing.length} candles | last=${new Date(existing.at(-1).timestamp).toISOString()}`);
  else console.log(`📥 ${symbol}: downloading ${YEARS} years M5`);

  while(cursor<now){
    const end=new Date(Math.min(now.getTime(),cursor.getTime()+CHUNK_DAYS*86400000));
    console.log(`  ↳ ${cursor.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`);
    try{
      const rows=await fetchChunk(symbol,cursor,end);
      existing=merge(existing,rows);
      save(symbol,existing);
      console.log(`  ✅ +${rows.length} | total=${existing.length}`);
    }catch(e){
      console.log(`  ❌ ${symbol} chunk failed after retries: ${e.message}`);
      console.log(`  💾 Progress saved. Re-run later and it will resume from the last candle.`);
      return false;
    }
    cursor=new Date(end.getTime()+5*60000);
    await sleep(BETWEEN_CHUNKS_MS);
  }

  if(existing.length)console.log(`✅ ${symbol}: ${existing.length} M5 candles | ${new Date(existing[0].timestamp).toISOString().slice(0,10)} → ${new Date(existing.at(-1).timestamp).toISOString().slice(0,10)} | ${(fs.statSync(fileFor(symbol)).size/1024/1024).toFixed(1)} MB gz`);
  return true;
}

(async()=>{
  console.log(`🧠 SIGNAL LAB HISTORY — DUKASCOPY M5 | ${YEARS} years`);
  console.log(`Pairs: ${PAIRS.join(', ')}`);
  console.log(`Throttle: ${CHUNK_DAYS}d chunks | ${Math.round(BETWEEN_CHUNKS_MS/1000)}s gap | ${RETRIES} retries`);
  fs.mkdirSync(ROOT,{recursive:true});
  const failed=[];
  for(const s of PAIRS){
    if(s==='BTCUSD'){console.log('⏭️ BTCUSD skipped (use Binance history)');continue;}
    const ok=await downloadSymbol(s);
    if(!ok)failed.push(s);
    await sleep(BETWEEN_CHUNKS_MS);
  }
  if(failed.length)console.log(`\n⚠️ Incomplete pairs: ${failed.join(', ')} | run the same command again to resume.`);
  else console.log('\n🎯 Signal Lab history download complete.');
})().catch(e=>{console.error(e);process.exit(1)});
