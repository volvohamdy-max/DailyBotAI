const axios = require('axios');

const BASE_URL = 'https://biquote.io/api';
const PAIRS = ['XAUUSD','EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY'];
const INTERVALS = ['5m','15m','1h'];
const LIMIT = 120;
const TIMEOUT_MS = 12000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toMs(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function extractBars(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.bars)) return data.bars;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

function normalizeBar(row) {
  return {
    timestamp: toMs(row?.openTime ?? row?.timestamp ?? row?.time ?? row?.datetime ?? row?.t),
    open: Number(row?.open ?? row?.o),
    high: Number(row?.high ?? row?.h),
    low: Number(row?.low ?? row?.l),
    close: Number(row?.close ?? row?.c),
    volume: Number(row?.volume ?? row?.v),
    tickVolume: Number(row?.tickVolume ?? row?.tick_volume ?? row?.tv),
    isOpen: Boolean(row?.isOpen)
  };
}

function expectedMinutes(interval) {
  return interval === '5m' ? 5 : interval === '15m' ? 15 : 60;
}

async function testOne(pair, interval) {
  const started = Date.now();
  const url = `${BASE_URL}/${pair}/ohlc`;

  try {
    const res = await axios.get(url, {
      params: { interval, limit: LIMIT },
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'DailyBotAI-BiQuote-Test/1.0' },
      validateStatus: () => true
    });

    if (res.status !== 200) {
      return {
        pair, interval, ok: false, status: res.status,
        error: res.data?.message || res.data?.error || `HTTP ${res.status}`,
        latencyMs: Date.now() - started
      };
    }

    const raw = extractBars(res.data);
    const bars = raw.map(normalizeBar).filter(b =>
      Number.isFinite(b.timestamp) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close)
    );

    const closed = bars.filter(b => !b.isOpen);
    const last = closed.at(-1) || bars.at(-1);
    const ageMin = last && Number.isFinite(last.timestamp)
      ? Math.round((Date.now() - last.timestamp) / 60000)
      : null;

    const volumeCount = closed.slice(-24).filter(b => Number.isFinite(b.volume) && b.volume > 0).length;
    const tickVolumeCount = closed.slice(-24).filter(b => Number.isFinite(b.tickVolume) && b.tickVolume > 0).length;
    const expected = expectedMinutes(interval);
    const freshEnough = Number.isFinite(ageMin) && ageMin <= expected * 3;

    return {
      pair,
      interval,
      ok: closed.length >= 20 && freshEnough,
      status: res.status,
      bars: bars.length,
      closedBars: closed.length,
      ageMin,
      freshEnough,
      volume24: volumeCount,
      tickVolume24: tickVolumeCount,
      latencyMs: Date.now() - started,
      firstTs: closed[0]?.timestamp || null,
      lastTs: last?.timestamp || null,
      sample: last ? {
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: Number.isFinite(last.volume) ? last.volume : null,
        tickVolume: Number.isFinite(last.tickVolume) ? last.tickVolume : null,
        isOpen: last.isOpen
      } : null
    };
  } catch (error) {
    return {
      pair,
      interval,
      ok: false,
      status: error.response?.status || null,
      error: error.code || error.message,
      latencyMs: Date.now() - started
    };
  }
}

(async () => {
  console.log('🧪 BIQUOTE VALIDATION START');
  console.log(`Pairs=${PAIRS.length} | Intervals=${INTERVALS.join(',')} | Requests=${PAIRS.length * INTERVALS.length}`);

  const results = [];

  for (const pair of PAIRS) {
    for (const interval of INTERVALS) {
      const r = await testOne(pair, interval);
      results.push(r);

      if (r.ok) {
        console.log(`✅ ${pair} ${interval} | closed=${r.closedBars} | age=${r.ageMin}m | vol24=${r.volume24} | tickVol24=${r.tickVolume24} | ${r.latencyMs}ms`);
      } else {
        console.log(`❌ ${pair} ${interval} | status=${r.status ?? '-'} | age=${r.ageMin ?? '-'}m | bars=${r.closedBars ?? 0} | ${r.error || 'NOT_FRESH_OR_INSUFFICIENT'}`);
      }

      await sleep(750);
    }
  }

  const passed = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const rateLimited = results.filter(r => Number(r.status) === 429);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 BIQUOTE SUMMARY');
  console.log(`PASS=${passed.length}/${results.length}`);
  console.log(`FAIL=${failed.length}/${results.length}`);
  console.log(`HTTP429=${rateLimited.length}`);

  if (failed.length) {
    console.log('\n❌ FAILED CASES');
    for (const r of failed) {
      console.log(`${r.pair} ${r.interval} | status=${r.status ?? '-'} | age=${r.ageMin ?? '-'} | ${r.error || 'stale/insufficient'}`);
    }
  }

  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(__dirname, '..', 'data', 'provider-tests');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'biquote-latest.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    passed: passed.length,
    failed: failed.length,
    rateLimited: rateLimited.length,
    results
  }, null, 2));

  console.log(`\n📄 JSON: ${outPath}`);
  process.exit(failed.length ? 2 : 0);
})();
