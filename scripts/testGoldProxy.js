const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SYMBOLS = ['PAXGUSDT', 'XAUTUSDT'];
const INTERVALS = ['5m', '15m', '1h'];
const LIMIT = 120;
const BINANCE_BASE = process.env.BINANCE_MARKET_BASE || 'https://data-api.binance.vision';

function ageMinutes(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round((Date.now() - n) / 60000));
}

function maxAge(interval) {
  if (interval === '5m') return 15;
  if (interval === '15m') return 35;
  if (interval === '1h') return 120;
  return 30;
}

async function fetchKlines(symbol, interval) {
  const started = Date.now();
  const response = await axios.get(`${BINANCE_BASE}/api/v3/klines`, {
    params: { symbol, interval, limit: LIMIT },
    timeout: 12000,
    validateStatus: () => true
  });

  const elapsedMs = Date.now() - started;
  const status = response.status;
  const rows = Array.isArray(response.data) ? response.data : [];

  if (status !== 200) {
    return {
      ok: false,
      symbol,
      interval,
      status,
      elapsedMs,
      bars: rows.length,
      error: response.data?.msg || `HTTP_${status}`
    };
  }

  const candles = rows.map(r => ({
    openTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    closeTime: Number(r[6]),
    quoteVolume: Number(r[7]),
    trades: Number(r[8])
  })).filter(c =>
    Number.isFinite(c.openTime) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );

  const last = candles.at(-1);
  const age = ageMinutes(last?.closeTime ?? last?.openTime);
  const fresh = age !== null && age <= maxAge(interval);
  const positiveVolume = candles.slice(-24).filter(c => Number(c.volume) > 0).length;

  return {
    ok: fresh && candles.length >= 50,
    symbol,
    interval,
    status,
    elapsedMs,
    bars: candles.length,
    ageMinutes: age,
    lastClose: Number(last?.close),
    positiveVolume24: positiveVolume,
    fresh,
    error: fresh && candles.length >= 50 ? null : 'NOT_FRESH_OR_INSUFFICIENT'
  };
}

async function fetchGoldApi() {
  const started = Date.now();
  const response = await axios.get('https://api.gold-api.com/price/XAU', {
    timeout: 10000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'DailyBotAI/1.0' }
  });

  const price = Number(
    response.data?.price ??
    response.data?.ask ??
    response.data?.bid
  );

  return {
    status: response.status,
    elapsedMs: Date.now() - started,
    price: Number.isFinite(price) && price > 0 ? price : null
  };
}

(async () => {
  console.log('🧪 GOLD PROXY VALIDATION START');
  console.log(`Symbols=${SYMBOLS.join(',')} | Intervals=${INTERVALS.join(',')} | Requests=${SYMBOLS.length * INTERVALS.length}`);
  console.log(`BinanceBase=${BINANCE_BASE}`);

  let goldApi;
  try {
    goldApi = await fetchGoldApi();
    console.log(`💰 GoldAPI | status=${goldApi.status} | price=${goldApi.price ?? 'N/A'} | ${goldApi.elapsedMs}ms`);
  } catch (error) {
    goldApi = { status: error.response?.status || null, price: null, error: error.message };
    console.log(`⚠️ GoldAPI unavailable: ${error.response?.status || error.message}`);
  }

  const results = [];

  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      try {
        const row = await fetchKlines(symbol, interval);

        if (goldApi?.price && Number.isFinite(row.lastClose)) {
          row.goldApiPrice = goldApi.price;
          row.deviationPct = Number((((row.lastClose - goldApi.price) / goldApi.price) * 100).toFixed(4));
        } else {
          row.goldApiPrice = goldApi?.price ?? null;
          row.deviationPct = null;
        }

        results.push(row);

        if (row.ok) {
          console.log(
            `✅ ${symbol} ${interval} | status=${row.status} | age=${row.ageMinutes}m | bars=${row.bars} | vol24=${row.positiveVolume24}/24 | close=${row.lastClose} | dev=${row.deviationPct ?? 'N/A'}% | ${row.elapsedMs}ms`
          );
        } else {
          console.log(
            `❌ ${symbol} ${interval} | status=${row.status} | age=${row.ageMinutes ?? 'N/A'}m | bars=${row.bars} | ${row.error}`
          );
        }
      } catch (error) {
        const row = {
          ok: false,
          symbol,
          interval,
          status: error.response?.status || null,
          error: error.message
        };
        results.push(row);
        console.log(`❌ ${symbol} ${interval} | ${row.status || ''} ${row.error}`.trim());
      }

      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  const http429 = results.filter(r => Number(r.status) === 429).length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 GOLD PROXY SUMMARY');
  console.log(`PASS=${pass}/${results.length}`);
  console.log(`FAIL=${fail}/${results.length}`);
  console.log(`HTTP429=${http429}`);

  const ranked = SYMBOLS.map(symbol => {
    const rows = results.filter(r => r.symbol === symbol);
    const passed = rows.filter(r => r.ok).length;
    const deviations = rows
      .map(r => Math.abs(Number(r.deviationPct)))
      .filter(Number.isFinite);
    const avgAbsDeviationPct = deviations.length
      ? Number((deviations.reduce((a, b) => a + b, 0) / deviations.length).toFixed(4))
      : null;

    return { symbol, passed, total: rows.length, avgAbsDeviationPct };
  }).sort((a, b) => {
    if (b.passed !== a.passed) return b.passed - a.passed;
    return (a.avgAbsDeviationPct ?? Infinity) - (b.avgAbsDeviationPct ?? Infinity);
  });

  console.log('\n🏅 PROXY RANKING');
  for (const row of ranked) {
    console.log(`${row.symbol} | pass=${row.passed}/${row.total} | avgAbsDev=${row.avgAbsDeviationPct ?? 'N/A'}%`);
  }

  const outDir = path.join(process.cwd(), 'data', 'provider-tests');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'gold-proxy-latest.json');
  fs.writeFileSync(outPath, JSON.stringify({
    testedAt: new Date().toISOString(),
    binanceBase: BINANCE_BASE,
    goldApi,
    results,
    summary: { pass, fail, http429, ranked }
  }, null, 2));

  console.log(`\n📄 JSON: ${outPath}`);
})();
