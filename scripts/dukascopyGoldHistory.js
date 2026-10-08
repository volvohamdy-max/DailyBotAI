'use strict';

const https = require('https');
const zlib = require('zlib');

// Dukascopy public historical feed. XAUUSD is requested directly; no SiftingIO path is used.
// BI5 tick files are aggregated into UTC M5 candles.

function getBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DailyBotAI-backtest/1.0' } }, res => {
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Dukascopy HTTP ${res.statusCode}`)); }
      const chunks=[];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function hourUrl(d) {
  const y=d.getUTCFullYear();
  const m=String(d.getUTCMonth()).padStart(2,'0'); // Dukascopy months are zero-based
  const day=String(d.getUTCDate()).padStart(2,'0');
  const h=String(d.getUTCHours()).padStart(2,'0');
  return `https://datafeed.dukascopy.com/datafeed/XAUUSD/${y}/${m}/${day}/${h}h_ticks.bi5`;
}

function parseTicks(buf, hour) {
  if (!buf || !buf.length) return [];
  const raw=zlib.unzipSync(buf);
  const ticks=[];
  for(let o=0;o+20<=raw.length;o+=20){
    const ms=raw.readUInt32BE(o);
    const ask=raw.readUInt32BE(o+4)/1000;
    const bid=raw.readUInt32BE(o+8)/1000;
    const askVol=raw.readFloatBE(o+12);
    const bidVol=raw.readFloatBE(o+16);
    if(!Number.isFinite(bid)||!Number.isFinite(ask)) continue;
    ticks.push({time:hour.getTime()+ms, price:(bid+ask)/2, volume:(Number(askVol)||0)+(Number(bidVol)||0)});
  }
  return ticks;
}

function aggregate5m(ticks) {
  const map=new Map();
  for(const t of ticks){
    const time=Math.floor(t.time/300000)*300000;
    let c=map.get(time);
    if(!c){ c={time,open:t.price,high:t.price,low:t.price,close:t.price,volume:0}; map.set(time,c); }
    c.high=Math.max(c.high,t.price); c.low=Math.min(c.low,t.price); c.close=t.price; c.volume+=t.volume;
  }
  return [...map.values()].sort((a,b)=>a.time-b.time);
}

async function getDukascopyGoldM5(limit=60000) {
  limit=Math.max(100,Number(limit)||60000);
  const out=[];
  let cursor=new Date();
  cursor.setUTCMinutes(0,0,0);
  cursor=new Date(cursor.getTime()-3600000); // only completed hours
  const maxHours=Math.ceil(limit/12*1.65)+72; // weekends/holidays allowance
  let checked=0;
  while(out.length<limit && checked<maxHours){
    checked++;
    try {
      const buf=await getBuffer(hourUrl(cursor));
      if(buf){
        const candles=aggregate5m(parseTicks(buf,cursor));
        if(candles.length) out.unshift(...candles);
      }
    } catch(e) {
      if(process.env.DUKASCOPY_VERBOSE==='1') console.warn(`Dukascopy skip ${cursor.toISOString()}: ${e.message}`);
    }
    cursor=new Date(cursor.getTime()-3600000);
  }
  const dedup=[...new Map(out.map(x=>[x.time,x])).values()].sort((a,b)=>a.time-b.time);
  if(dedup.length<100) throw new Error(`Dukascopy returned insufficient XAUUSD M5 history: ${dedup.length}`);
  return dedup.slice(-limit);
}

module.exports={getDukascopyGoldM5};
