require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'backtests', 'history-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function intervalCode(tf) { return ({'5min':'5m','15min':'15m','1h':'1h'})[tf] || null; }
function intervalMinutes(tf) { return ({'5min':5,'15min':15,'1h':60})[tf] || null; }
function normalizeTimestamp(v){ const n=Number(v); return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):null; }
function normalizeRows(data){
  const rows=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:[];
  return rows.map(r=>({
    time:normalizeTimestamp(r.t??r.timestamp??r.datetime),
    open:Number(r.o??r.open), high:Number(r.h??r.high), low:Number(r.l??r.low), close:Number(r.c??r.close),
    volume:Number.isFinite(Number(r.v??r.volume))?Number(r.v??r.volume):0
  })).filter(r=>Number.isFinite(r.time)&&Number.isFinite(r.open)&&Number.isFinite(r.high)&&Number.isFinite(r.low)&&Number.isFinite(r.close));
}
function cachePath(tf){ return path.join(CACHE_DIR, `XAUUSD_${tf}.json`); }
function loadCache(tf){
  try { const rows=JSON.parse(fs.readFileSync(cachePath(tf),'utf8')); return normalizeRows(rows).sort((a,b)=>a.time-b.time); }
  catch { return []; }
}
function saveCache(tf, rows){
  try { fs.writeFileSync(cachePath(tf), JSON.stringify(rows)); } catch(e){ console.log('⚠️ History cache save failed:', e.message); }
}
async function fetchChunk({apiKey,tf,start,end,limit}){
  let lastErr;
  for(let attempt=1; attempt<=6; attempt++){
    try{
      const res=await axios.get('https://api.sifting.io/v1/hist/commodities/XAUUSD/bars',{
        headers:{'X-API-Key':apiKey,'Accept-Encoding':'gzip'},
        params:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),interval:intervalCode(tf),limit},
        timeout:45000
      });
      return normalizeRows(res.data);
    }catch(err){
      lastErr=err;
      const status=err.response?.status;
      if(status===429){
        const retryAfterSec=Number(err.response?.headers?.['retry-after']);
        const wait=Number.isFinite(retryAfterSec)&&retryAfterSec>0
          ? retryAfterSec*1000
          : Math.min(60000, 5000 * Math.pow(2, attempt-1));
        console.log(`🧊 Sifting 429 | ${tf} | retry ${attempt}/6 in ${Math.ceil(wait/1000)}s`);
        await sleep(wait);
        continue;
      }
      if(attempt<3){ await sleep(2500*attempt); continue; }
      throw err;
    }
  }
  throw lastErr || new Error('Historical Sifting request failed');
}

async function getGoldHistoricalCandles(tf='5min', requested=10000){
  const apiKey=process.env.SIFTING_API_KEY||'';
  if(!apiKey) throw new Error('SIFTING_API_KEY missing from .env');
  const minutes=intervalMinutes(tf);
  if(!minutes) throw new Error(`Unsupported timeframe: ${tf}`);
  const count=Math.max(500, Math.min(60000, Number(requested)||10000));
  console.log(`🧪 Backtest history: ${tf} target=${count}`);

  const existing=loadCache(tf);
  const all=new Map(existing.map(r=>[r.time,r]));
  if(existing.length) console.log(`💾 Disk history cache: ${tf} ${existing.length} candles`);

  let end=existing.length ? existing[0].time - minutes*60*1000 : Date.now();
  let chunk=0;
  const maxChunks=Math.ceil(Math.max(0,count-all.size)/1800)+10;

  while(all.size<count && chunk<maxChunks){
    chunk++;
    const remaining=count-all.size;
    const limit=Math.min(2000, Math.max(500, remaining+180));
    const barsWindow=limit*2.0;
    const start=end-barsWindow*minutes*60*1000;
    const rows=await fetchChunk({apiKey,tf,start,end,limit});
    if(!rows.length) break;
    for(const row of rows) all.set(row.time,row);
    const earliest=Math.min(...rows.map(r=>r.time));
    console.log(`🧪 ${tf} chunk ${chunk}: +${rows.length} | unique=${all.size}/${count}`);
    if(!Number.isFinite(earliest)) break;
    end=earliest-minutes*60*1000;
    if(rows.length<20) break;
    if(all.size<count) await sleep(1400);
  }

  const candles=[...all.values()].sort((a,b)=>a.time-b.time).slice(-count);
  if(candles.length<500) throw new Error(`Not enough ${tf} history: ${candles.length}`);
  saveCache(tf,[...all.values()].sort((a,b)=>a.time-b.time));
  console.log(`✅ Backtest history ready: ${tf} ${candles.length} candles`);
  return candles;
}

module.exports={getGoldHistoricalCandles};
