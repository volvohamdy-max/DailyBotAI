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
  console.log(
    '=============================================='
  );
  console.log(
    ' 📈 EMA 200 CLOSE CROSS - ROUND 2'
  );
  console.log(
    ' XAUUSD | 5m'
  );
  console.log(
    '=============================================='
  );

  console.log(
    `🕯️ Target candles: ${HISTORY}`
  );

  console.log(
    `💸 Spread=$${SPREAD} | Slippage=$${SLIP}/side`
  );

  console.log('');
  console.log(
    '📥 Loading historical candles...'
  );

  const c = rows(
    await getGoldHistoricalCandles(
      '5min',
      HISTORY
    )
  );

  console.log(
    `✅ Loaded: ${c.length}`
  );

  if (c.length < 1000) {
    throw new Error(
      `Not enough candles: ${c.length}`
    );
  }

  const closes =
    c.map(x => x.close);

  const ema200 =
    ema(
      closes,
      EMA_PERIOD
    );

  const atrValues =
    atr(c, 14);

  const N = c.length;

  const devEnd =
    Math.floor(N * 0.60) - 1;

  const valEnd =
    Math.floor(N * 0.80) - 1;

  const splits = {
    DEV: [210, devEnd],
    VAL: [
      devEnd + 1,
      valEnd
    ],
    FINAL: [
      valEnd + 1,
      N - 2
    ]
  };

  console.log('');
  console.log(
    `🧪 Split 60/20/20 | DEV=${splits.DEV[1] - splits.DEV[0] + 1}` +
    ` | VAL=${splits.VAL[1] - splits.VAL[0] + 1}` +
    ` | FINAL=${splits.FINAL[1] - splits.FINAL[0] + 1}`
  );

  const variants = [];

  for (
    const bodyMin of BODY_MINS
  ) {
    for (
      const maxDistAtr of MAX_DIST_ATR
    ) {
      for (
        const session of SESSION_MODES
      ) {
        variants.push({
          bodyMin,
          maxDistAtr,
          session
        });
      }
    }
  }

  console.log('');
  console.log(
    `🔬 Variants: ${variants.length}`
  );

  const validationPool = [];

  for (
    let index = 0;
    index < variants.length;
    index++
  ) {
    const params =
      variants[index];

    console.log(
      `🔍 ${index + 1}/${variants.length}` +
      ` body>=${params.bodyMin}ATR` +
      ` dist<=${params.maxDistAtr}ATR` +
      ` session=${params.session}`
    );

    const devResults =
      TP_PROFILES.map(tpR => {
        const tr =
          run(
            c,
            ema200,
            atrValues,
            ...splits.DEV,
            params,
            tpR
          );

        return {
          tpR,
          summary:
            summarize(
              'EMA200_R2',
              tr
            )
        };
      }).sort(
        (a, b) =>
          score(b.summary) -
          score(a.summary)
      );

    const chosen =
      devResults[0];

    const valTrades =
      run(
        c,
        ema200,
        atrValues,
        ...splits.VAL,
        params,
        chosen.tpR
      );

    const val =
      summarize(
        'EMA200_R2',
        valTrades
      );

    validationPool.push({
      params,
      tpR: chosen.tpR,
      dev: chosen.summary,
      val
    });
  }

  validationPool.sort(
    (a, b) =>
      score(b.val) -
      score(a.val)
  );

  console.log('');
  console.log(
    '🏅 TOP VALIDATION VARIANTS'
  );

  validationPool
    .slice(0, 10)
    .forEach((x, i) => {
      console.log(
        `${i + 1}. ` +
        `body>=${x.params.bodyMin}` +
        ` | dist<=${x.params.maxDistAtr}` +
        ` | ${x.params.session}` +
        ` | TP=${x.tpR}R` +
        ` | trades=${x.val.trades}` +
        ` | WR=${x.val.winRate.toFixed(1)}%` +
        ` | Net=${x.val.netR.toFixed(2)}R` +
        ` | PF=${x.val.pf.toFixed(2)}` +
        ` | Exp=${x.val.exp.toFixed(3)}R` +
        ` | DD=${x.val.dd.toFixed(2)}R`
      );
    });

  // Only the best validation variant
  // proceeds as primary candidate.
  const best =
    validationPool[0];

  const finalTrades =
    run(
      c,
      ema200,
      atrValues,
      ...splits.FINAL,
      best.params,
      best.tpR
    );

  const final =
    summarize(
      'EMA200_R2',
      finalTrades
    );

  const qualified =
    final.trades >= 20 &&
    final.netR > 0 &&
    final.pf >= 1.15 &&
    final.exp > 0 &&
    final.dd <= 15;

  console.log('');
  console.log(
    '🏆 FINAL HOLDOUT RESULT'
  );

  console.log(
    `EMA 200 ROUND 2` +
    ` | ${qualified ? '✅ QUALIFIED' : '❌'}` +
    ` | body>=${best.params.bodyMin}ATR` +
    ` | dist<=${best.params.maxDistAtr}ATR` +
    ` | session=${best.params.session}` +
    ` | TP=${best.tpR}R` +
    ` | trades=${final.trades}` +
    ` | WR=${final.winRate.toFixed(1)}%` +
    ` | Net=${final.netR.toFixed(2)}R` +
    ` | PF=${final.pf.toFixed(2)}` +
    ` | Exp=${final.exp.toFixed(3)}R` +
    ` | DD=${final.dd.toFixed(2)}R` +
    ` | MFE=${final.mfe.toFixed(2)}` +
    ` | MAE=${final.mae.toFixed(2)}`
  );

  console.log('');
  console.log(
    '📌 SELECTED PARAMETERS'
  );

  console.log(
    JSON.stringify(
      best.params,
      null,
      2
    )
  );

  const report = {
    generatedAt:
      new Date().toISOString(),

    strategy:
      'EMA200_CLOSE_CROSS_ROUND2',

    history: {
      candles: c.length,
      timeframe: '5min'
    },

    costs: {
      spread: SPREAD,
      slippagePerSide: SLIP
    },

    split:
      '60/20/20',

    parameterSpace: {
      bodyMinAtr:
        BODY_MINS,
      maxDistanceAtr:
        MAX_DIST_ATR,
      sessions:
        SESSION_MODES,
      tpProfiles:
        TP_PROFILES
    },

    selected: {
      params:
        best.params,
      tpR:
        best.tpR,
      dev:
        best.dev,
      validation:
        best.val,
      final,
      qualified
    },

    validationRanking:
      validationPool
  };

  const jp =
    path.join(
      OUT,
      'ema200-round2-latest.json'
    );

  fs.writeFileSync(
    jp,
    JSON.stringify(
      report,
      null,
      2
    )
  );

  console.log('');
  console.log(
    `📄 JSON: ${jp}`
  );
})().catch(e => {
  console.error(
    '❌ EMA200 Round 2 failed:',
    e
  );

  process.exitCode = 1;
});
