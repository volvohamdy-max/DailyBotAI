require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGoldHistoricalCandles } = require('./backtestHistoryV21');

const HISTORY = Math.max(
  10000,
  Math.min(60000, Number(process.env.BACKTEST_HISTORY || 50000))
);

const SPREAD = Math.max(
  0,
  Number(process.env.BACKTEST_SPREAD_USD || 0.35)
);

const SLIP = Math.max(
  0,
  Number(process.env.BACKTEST_SLIPPAGE_USD || 0.05)
);

const EMA_PERIOD = 200;
const TP_PROFILES = [1, 1.5, 2];

const BODY_MINS = [0, 0.20, 0.35];
const MAX_DIST_ATR = [0.25, 0.50, 0.75];
const SESSION_MODES = ['ALL', 'LDN_NY'];

const OUT = path.resolve(
  process.cwd(),
  'data',
  'backtests'
);

fs.mkdirSync(OUT, { recursive: true });

const n = v => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function rows(x = []) {
  return x
    .map(r => ({
      time: Number(r.time),
      open: n(r.open),
      high: n(r.high),
      low: n(r.low),
      close: n(r.close),
      volume: n(r.volume) || 0
    }))
    .filter(r =>
      [r.time, r.open, r.high, r.low, r.close]
        .every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time);
}

function ema(values, period) {
  const out = Array(values.length).fill(null);

  if (values.length < period) return out;

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += values[i];
  }

  let current = sum / period;
  out[period - 1] = current;

  const k = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    current =
      values[i] * k +
      current * (1 - k);

    out[i] = current;
  }

  return out;
}

function atr(c, period = 14) {
  const tr = Array(c.length).fill(null);
  const out = Array(c.length).fill(null);

  for (let i = 1; i < c.length; i++) {
    tr[i] = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close)
    );
  }

  if (c.length <= period) return out;

  let sum = 0;

  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }

  let current = sum / period;
  out[period] = current;

  for (let i = period + 1; i < c.length; i++) {
    current =
      (
        current * (period - 1) +
        tr[i]
      ) / period;

    out[i] = current;
  }

  return out;
}

const fmtCache = new Map();

function tz(t, zone) {
  let f = fmtCache.get(zone);

  if (!f) {
    f = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }
    );

    fmtCache.set(zone, f);
  }

  const obj = {};

  for (const p of f.formatToParts(new Date(t))) {
    if (p.type !== 'literal') {
      obj[p.type] = p.value;
    }
  }

  return {
    m:
      Number(obj.hour) * 60 +
      Number(obj.minute)
  };
}

function inNY(t) {
  const p = tz(
    t,
    'America/New_York'
  );

  return p.m >= 510 && p.m < 720;
}

function inLondon(t) {
  const p = tz(
    t,
    'Europe/London'
  );

  return p.m >= 480 && p.m < 720;
}

function sessionAllowed(t, mode) {
  if (mode === 'ALL') return true;

  if (mode === 'LDN_NY') {
    return inLondon(t) || inNY(t);
  }

  return true;
}

function bodyAtr(c, i, a) {
  if (!a[i]) return 0;

  return (
    Math.abs(
      c[i].close - c[i].open
    ) / a[i]
  );
}

function candleMatches(c, i, side) {
  return side === 'BUY'
    ? c[i].close > c[i].open
    : c[i].close < c[i].open;
}

function makeTrade(
  c,
  i,
  side,
  atrValue,
  tpR
) {
  const entryIndex = i + 1;

  if (entryIndex >= c.length) {
    return null;
  }

  const entry =
    side === 'BUY'
      ? c[entryIndex].open + SLIP
      : c[entryIndex].open - SLIP;

  const buffer = atrValue * 0.10;

  let risk;

  if (side === 'BUY') {
    risk =
      entry -
      (c[i].low - buffer);
  } else {
    risk =
      (c[i].high + buffer) -
      entry;
  }

  risk = Math.max(
    risk,
    atrValue * 0.50
  );

  if (!(risk > 0)) {
    return null;
  }

  const sl =
    side === 'BUY'
      ? entry - risk
      : entry + risk;

  const tp =
    side === 'BUY'
      ? entry + risk * tpR
      : entry - risk * tpR;

  const costR =
    (SPREAD + 2 * SLIP) /
    risk;

  return {
    side,
    entryIndex,
    signalTime: c[i].time,
    entryTime: c[entryIndex].time,
    entry,
    sl,
    tp,
    risk,
    tpR,
    costR
  };
}

function simulate(c, t, end) {
  let mfe = 0;
  let mae = 0;

  for (
    let j = t.entryIndex;
    j <= end && j < c.length;
    j++
  ) {
    const b = c[j];

    const fav =
      t.side === 'BUY'
        ? b.high - t.entry
        : t.entry - b.low;

    const adv =
      t.side === 'BUY'
        ? t.entry - b.low
        : b.high - t.entry;

    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);

    if (t.side === 'BUY') {
      if (b.low <= t.sl) {
        return {
          ...t,
          result: 'LOSS',
          r: -1 - t.costR,
          exitIndex: j,
          mfeR: mfe / t.risk,
          maeR: mae / t.risk
        };
      }

      if (b.high >= t.tp) {
        return {
          ...t,
          result: 'WIN',
          r: t.tpR - t.costR,
          exitIndex: j,
          mfeR: mfe / t.risk,
          maeR: mae / t.risk
        };
      }
    } else {
      if (b.high >= t.sl) {
        return {
          ...t,
          result: 'LOSS',
          r: -1 - t.costR,
          exitIndex: j,
          mfeR: mfe / t.risk,
          maeR: mae / t.risk
        };
      }

      if (b.low <= t.tp) {
        return {
          ...t,
          result: 'WIN',
          r: t.tpR - t.costR,
          exitIndex: j,
          mfeR: mfe / t.risk,
          maeR: mae / t.risk
        };
      }
    }
  }

  return null;
}

function summarize(name, tr) {
  const wins =
    tr.filter(x => x.r > 0).length;

  const net =
    tr.reduce(
      (a, x) => a + x.r,
      0
    );

  const gw =
    tr
      .filter(x => x.r > 0)
      .reduce(
        (a, x) => a + x.r,
        0
      );

  const gl = Math.abs(
    tr
      .filter(x => x.r < 0)
      .reduce(
        (a, x) => a + x.r,
        0
      )
  );

  let eq = 0;
  let peak = 0;
  let dd = 0;

  let streak = 0;
  let worstStreak = 0;

  for (const x of tr) {
    eq += x.r;

    peak = Math.max(
      peak,
      eq
    );

    dd = Math.max(
      dd,
      peak - eq
    );

    if (x.r < 0) {
      streak++;
      worstStreak = Math.max(
        worstStreak,
        streak
      );
    } else {
      streak = 0;
    }
  }

  const avg = key =>
    tr.length
      ? tr.reduce(
          (a, x) =>
            a + (x[key] || 0),
          0
        ) / tr.length
      : 0;

  return {
    name,
    trades: tr.length,
    wins,
    losses: tr.length - wins,

    winRate:
      tr.length
        ? 100 * wins / tr.length
        : 0,

    netR: net,

    pf:
      gl
        ? gw / gl
        : gw
          ? 999
          : 0,

    exp:
      tr.length
        ? net / tr.length
        : 0,

    dd,
    worstLossStreak: worstStreak,
    mfe: avg('mfeR'),
    mae: avg('maeR')
  };
}

function run(
  c,
  ema200,
  atrValues,
  start,
  end,
  params,
  tpR
) {
  const trades = [];

  for (
    let i = Math.max(210, start);
    i <= Math.min(
      end,
      c.length - 2
    );
  ) {
    const prevEma =
      ema200[i - 1];

    const currentEma =
      ema200[i];

    const currentAtr =
      atrValues[i];

    if (
      prevEma == null ||
      currentEma == null ||
      !currentAtr
    ) {
      i++;
      continue;
    }

    if (
      !sessionAllowed(
        c[i].time,
        params.session
      )
    ) {
      i++;
      continue;
    }

    let side = null;

    if (
      c[i - 1].close <= prevEma &&
      c[i].close > currentEma
    ) {
      side = 'BUY';
    } else if (
      c[i - 1].close >= prevEma &&
      c[i].close < currentEma
    ) {
      side = 'SELL';
    }

    if (!side) {
      i++;
      continue;
    }

    // Candle must agree with direction.
    if (
      !candleMatches(
        c,
        i,
        side
      )
    ) {
      i++;
      continue;
    }

    const bAtr =
      bodyAtr(
        c,
        i,
        atrValues
      );

    if (
      bAtr < params.bodyMin
    ) {
      i++;
      continue;
    }

    const distAtr =
      Math.abs(
        c[i].close -
        currentEma
      ) / currentAtr;

    if (
      distAtr >
      params.maxDistAtr
    ) {
      i++;
      continue;
    }

    const trade =
      makeTrade(
        c,
        i,
        side,
        currentAtr,
        tpR
      );

    if (!trade) {
      i++;
      continue;
    }

    const done =
      simulate(
        c,
        trade,
        end + 1
      );

    if (!done) {
      i++;
      continue;
    }

    trades.push(done);

    i = Math.max(
      i + 1,
      done.exitIndex + 1
    );
  }

  return trades;
}

function score(r) {
  if (r.trades < 20) {
    return -999;
  }

  return (
    r.exp * 25 +
    Math.min(r.pf, 3) * 2 +
    r.netR * 0.10 -
    r.dd * 0.08 +
    Math.min(
      r.trades,
      100
    ) * 0.005
  );
}

(async () => {
  console.log('');
  console.log('==============================================');
  console.log(' 📈 EMA 200 CLOSE CROSS - ROUND 3');
  console.log(' WALK-FORWARD ROBUSTNESS TEST');
  console.log('==============================================');

  console.log(`🕯️ Target candles: ${HISTORY}`);
  console.log(`💸 Spread=$${SPREAD} | Slippage=$${SLIP}/side`);

  console.log('');
  console.log('📥 Loading historical candles...');

  const c = rows(
    await getGoldHistoricalCandles('5min', HISTORY)
  );

  console.log(`✅ Loaded: ${c.length}`);

  if (c.length < 10000) {
    throw new Error(`Not enough candles: ${c.length}`);
  }

  const closes = c.map(x => x.close);
  const ema200 = ema(closes, EMA_PERIOD);
  const atrValues = atr(c, 14);

  // LOCKED parameters from Round 2.
  // NO optimization in Round 3.
  const params = {
    bodyMin: 0,
    maxDistAtr: 0.75,
    session: 'LDN_NY'
  };

  const tpR = 1.5;

  console.log('');
  console.log('🔒 LOCKED STRATEGY');
  console.log('EMA = 200');
  console.log('TP = 1.5R');
  console.log('Session = London + New York');
  console.log('Max distance = 0.75 ATR');
  console.log('Body minimum = 0');
  console.log('');

  /*
   * Split the complete history into 10 chronological
   * non-overlapping windows.
   *
   * No parameter selection is performed on any window.
   */
  const WINDOW_COUNT = 10;

  const usableStart = 210;
  const usableEnd = c.length - 2;
  const usable = usableEnd - usableStart + 1;

  const windowSize = Math.floor(
    usable / WINDOW_COUNT
  );

  const results = [];

  console.log(`🧪 Windows: ${WINDOW_COUNT}`);
  console.log(`📦 ~${windowSize} candles/window`);
  console.log('');

  for (let w = 0; w < WINDOW_COUNT; w++) {
    const start =
      usableStart + w * windowSize;

    const end =
      w === WINDOW_COUNT - 1
        ? usableEnd
        : start + windowSize - 1;

    const trades = run(
      c,
      ema200,
      atrValues,
      start,
      end,
      params,
      tpR
    );

    const r = summarize(
      `WINDOW_${w + 1}`,
      trades
    );

    const from =
      new Date(c[start].time)
        .toISOString()
        .slice(0, 10);

    const to =
      new Date(c[end].time)
        .toISOString()
        .slice(0, 10);

    const profitable =
      r.netR > 0 &&
      r.exp > 0 &&
      r.pf > 1;

    results.push({
      window: w + 1,
      from,
      to,
      candles: end - start + 1,
      profitable,
      ...r
    });

    console.log(
      `${profitable ? '✅' : '❌'} Window ${w + 1}` +
      ` | ${from} → ${to}` +
      ` | trades=${r.trades}` +
      ` | WR=${r.winRate.toFixed(1)}%` +
      ` | Net=${r.netR.toFixed(2)}R` +
      ` | PF=${r.pf.toFixed(2)}` +
      ` | Exp=${r.exp.toFixed(3)}R` +
      ` | DD=${r.dd.toFixed(2)}R`
    );
  }

  const profitableWindows =
    results.filter(x => x.profitable).length;

  const losingWindows =
    WINDOW_COUNT - profitableWindows;

  const totalTrades =
    results.reduce(
      (a, x) => a + x.trades,
      0
    );

  const totalNet =
    results.reduce(
      (a, x) => a + x.netR,
      0
    );

  const weightedExp =
    totalTrades
      ? totalNet / totalTrades
      : 0;

  const avgPF =
    results.reduce(
      (a, x) => a + x.pf,
      0
    ) / results.length;

  const avgWR =
    totalTrades
      ? results.reduce(
          (a, x) =>
            a + x.winRate * x.trades,
          0
        ) / totalTrades
      : 0;

  const maxDD =
    Math.max(
      ...results.map(x => x.dd)
    );

  console.log('');
  console.log('==============================================');
  console.log(' 🏆 ROUND 3 ROBUSTNESS SUMMARY');
  console.log('==============================================');

  console.log(
    `Profitable windows : ${profitableWindows}/${WINDOW_COUNT}`
  );

  console.log(
    `Losing windows     : ${losingWindows}/${WINDOW_COUNT}`
  );

  console.log(
    `Total trades       : ${totalTrades}`
  );

  console.log(
    `Combined Net       : ${totalNet.toFixed(2)}R`
  );

  console.log(
    `Weighted Exp       : ${weightedExp.toFixed(3)}R`
  );

  console.log(
    `Weighted WR        : ${avgWR.toFixed(1)}%`
  );

  console.log(
    `Average PF         : ${avgPF.toFixed(2)}`
  );

  console.log(
    `Worst window DD    : ${maxDD.toFixed(2)}R`
  );

  /*
   * Robustness classification.
   *
   * Strong:
   * >= 7/10 profitable windows
   * positive combined expectancy
   *
   * Moderate:
   * >= 6/10 profitable windows
   * positive combined expectancy
   *
   * Otherwise rejected.
   */

  let verdict;

  if (
    profitableWindows >= 7 &&
    weightedExp > 0
  ) {
    verdict = '✅ ROBUST';
  } else if (
    profitableWindows >= 6 &&
    weightedExp > 0
  ) {
    verdict = '🟡 MODERATE';
  } else {
    verdict = '❌ NOT ROBUST';
  }

  console.log('');
  console.log(`FINAL VERDICT: ${verdict}`);

  const report = {
    generatedAt:
      new Date().toISOString(),

    strategy:
      'EMA200_CLOSE_CROSS_ROUND3',

    purpose:
      'Fixed-parameter walk-forward robustness test',

    lockedParameters: {
      ema: 200,
      tpR,
      ...params
    },

    costs: {
      spread: SPREAD,
      slippagePerSide: SLIP
    },

    history: {
      candles: c.length,
      timeframe: '5min'
    },

    windows: results,

    summary: {
      profitableWindows,
      losingWindows,
      totalTrades,
      totalNetR: totalNet,
      weightedExpectancyR: weightedExp,
      weightedWinRate: avgWR,
      averagePF: avgPF,
      worstWindowDD: maxDD,
      verdict
    }
  };

  const jp = path.join(
    OUT,
    'ema200-round3-latest.json'
  );

  fs.writeFileSync(
    jp,
    JSON.stringify(report, null, 2)
  );

  console.log('');
  console.log(`📄 JSON: ${jp}`);

})().catch(e => {
  console.error(
    '❌ EMA200 Round 3 failed:',
    e
  );

  process.exitCode = 1;
});

