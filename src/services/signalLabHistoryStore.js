const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(process.cwd(), 'data', 'signal-lab-history');
const memory = new Map();

function fileFor(symbol) {
  return path.join(ROOT, `${String(symbol || '').toUpperCase()}-m5.json.gz`);
}

function normalize(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    timestamp: Number(r.timestamp ?? r.time),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number.isFinite(Number(r.volume)) ? Number(r.volume) : null
  })).filter(x => [x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite))
    .sort((a,b)=>a.timestamp-b.timestamp);
}

function aggregate(rows, minutes) {
  if (minutes === 5) return rows;
  const ms = minutes * 60 * 1000;
  const m = new Map();
  for (const x of rows) {
    const t = Math.floor(x.timestamp / ms) * ms;
    let b = m.get(t);
    if (!b) {
      b = { timestamp:t, open:x.open, high:x.high, low:x.low, close:x.close, volume:0, hasVolume:false };
      m.set(t,b);
    } else {
      b.high = Math.max(b.high,x.high); b.low = Math.min(b.low,x.low); b.close = x.close;
    }
    if (Number.isFinite(x.volume)) { b.volume += x.volume; b.hasVolume = true; }
  }
  return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp).map(b=>({
    timestamp:b.timestamp, open:b.open, high:b.high, low:b.low, close:b.close,
    volume:b.hasVolume?b.volume:null
  }));
}

function loadM5(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (memory.has(s)) return memory.get(s);
  const f = fileFor(s);
  if (!fs.existsSync(f)) return [];
  const raw = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
  const rows = normalize(JSON.parse(raw));
  memory.set(s, rows);
  return rows;
}

function getSignalLabHistory(symbol, timeframe='5min', options={}) {
  const base = loadM5(symbol);
  const tf = String(timeframe).toLowerCase();
  let rows = tf === '5min' || tf === 'm5' ? base
    : tf === '15min' || tf === 'm15' ? aggregate(base,15)
    : tf === '1h' || tf === 'h1' || tf === '60min' ? aggregate(base,60)
    : tf === '4h' || tf === 'h4' ? aggregate(base,240)
    : [];
  if (!rows.length) return [];
  const from = options.from ? new Date(options.from).getTime() : -Infinity;
  const to = options.to ? new Date(options.to).getTime() : Infinity;
  if (Number.isFinite(from) || Number.isFinite(to)) rows = rows.filter(x=>x.timestamp>=from&&x.timestamp<=to);
  if (Number.isFinite(options.limit) && options.limit > 0) rows = rows.slice(-Number(options.limit));
  return rows;
}

function hasSignalLabHistory(symbol) { return fs.existsSync(fileFor(symbol)); }
function clearSignalLabHistoryMemory(symbol) { if (symbol) memory.delete(String(symbol).toUpperCase()); else memory.clear(); }

module.exports = { getSignalLabHistory, hasSignalLabHistory, clearSignalLabHistoryMemory, fileFor, aggregate };
