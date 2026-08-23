const fs = require('fs');
const path = require('path');

const FILE = path.resolve(process.cwd(), 'data', 'xauusd-m5-dukascopy.json');

function loadM5() {
  if (!fs.existsSync(FILE)) {
    throw new Error(`Dukascopy file missing: ${FILE}. Run: node scripts/exportDukascopyXauM5Local.js`);
  }
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return raw.map(r => ({
    time: Number(r.time ?? r.timestamp),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume) || 0
  })).filter(r => [r.time, r.open, r.high, r.low, r.close].every(Number.isFinite)).sort((a, b) => a.time - b.time);
}

function aggregate(rows, minutes) {
  const bucketMs = minutes * 60 * 1000;
  const out = [];
  let cur = null;
  for (const r of rows) {
    const bucket = Math.floor(r.time / bucketMs) * bucketMs;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.volume += r.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function getGoldHistoricalCandles(tf = '5min', requested = 10000) {
  const m5 = loadM5();
  let rows;
  if (tf === '5min') rows = m5;
  else if (tf === '15min') rows = aggregate(m5, 15);
  else if (tf === '1h') rows = aggregate(m5, 60);
  else throw new Error(`Unsupported Dukascopy timeframe: ${tf}`);

  const count = Math.max(500, Math.min(rows.length, Number(requested) || 10000));
  const sliced = rows.slice(-count);
  console.log(`✅ Dukascopy local history: ${tf} ${sliced.length}/${rows.length} candles`);
  return sliced;
}

module.exports = { getGoldHistoricalCandles };
