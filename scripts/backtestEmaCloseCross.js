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

const EMA_PERIODS = [9, 20, 50, 100, 200];
const TP_PROFILES = [1, 1.5, 2];

const OUT = path.resolve(process.cwd(), 'data', 'backtests');
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
      [r.time, r.open, r.high, r.low, r.close].every(Number.isFinite)
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
    current = values[i] * k + current * (1 - k);
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
    current = (current * (period - 1) + tr[i]) / period;
    out[i] = current;
  }

  return out;
}

function makeTrade(c, i, side, atrValue, tpR) {
  const entryIndex = i + 1;

  if (entryIndex >= c.length) return null;

  const entry =
    side === 'BUY'
      ? c[entryIndex].open + SLIP
      : c[entryIndex].open - SLIP;

  // Stop = opposite side of signal candle + small ATR buffer.
  const buffer = atrValue * 0.10;

  let risk;

  if (side === 'BUY') {
    risk = entry - (c[i].low - buffer);
  } else {
    risk = (c[i].high + buffer) - entry;
  }

  // Don't allow unrealistically tiny stop.
  risk = Math.max(risk, atrValue * 0.50);

  if (!(risk > 0)) return null;

  const sl =
    side === 'BUY'
      ? entry - risk
      : entry + risk;

  const tp =
    side === 'BUY'
      ? entry + risk * tpR
      : entry - risk * tpR;

  const costR = (SPREAD + 2 * SLIP) / risk;

  return {
    side,
    signalIndex: i,
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

function simulate(c, trade, end) {
  let mfe = 0;
  let mae = 0;

  for (
    let j = trade.entryIndex;
    j <= end && j < c.length;
    j++
  ) {
    const bar = c[j];

    const fav =
      trade.side === 'BUY'
        ? bar.high - trade.entry
        : trade.entry - bar.low;

    const adv =
      trade.side === 'BUY'
        ? trade.entry - bar.low
        : bar.high - trade.entry;

    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);

    if (trade.side === 'BUY') {
      // Conservative: if TP and SL touched in same candle,
      // count SL first.
      if (bar.low <= trade.sl) {
        return {
          ...trade,
          result: 'LOSS',
          r: -1 - trade.costR,
          exitIndex: j,
          mfeR: mfe / trade.risk,
          maeR: mae / trade.risk
        };
      }

      if (bar.high >= trade.tp) {
        return {
          ...trade,
          result: 'WIN',
          r: trade.tpR - trade.costR,
          exitIndex: j,
          mfeR: mfe / trade.risk,
          maeR: mae / trade.risk
        };
      }
    } else {
      if (bar.high >= trade.sl) {
        return {
          ...trade,
          result: 'LOSS',
          r: -1 - trade.costR,
          exitIndex: j,
          mfeR: mfe / trade.risk,
          maeR: mae / trade.risk
        };
      }

      if (bar.low <= trade.tp) {
        return {
          ...trade,
          result: 'WIN',
          r: trade.tpR - trade.costR,
          exitIndex: j,
          mfeR: mfe / trade.risk,
          maeR: mae / trade.risk
        };
      }
    }
  }

  return null;
}

function summarize(name, trades) {
  const wins = trades.filter(x => x.r > 0).length;

  const netR = trades.reduce(
    (sum, x) => sum + x.r,
    0
  );

  const grossWin = trades
    .filter(x => x.r > 0)
    .reduce((sum, x) => sum + x.r, 0);

  const grossLoss = Math.abs(
    trades
      .filter(x => x.r < 0)
      .reduce((sum, x) => sum + x.r, 0)
  );

  let equity = 0;
  let peak = 0;
  let dd = 0;
  let lossStreak = 0;
  let worstLossStreak = 0;

  for (const x of trades) {
    equity += x.r;

    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);

    if (x.r < 0) {
      lossStreak++;
      worstLossStreak = Math.max(
        worstLossStreak,
        lossStreak
      );
    } else {
      lossStreak = 0;
    }
  }

  const avg = key =>
    trades.length
      ? trades.reduce(
          (sum, x) => sum + (x[key] || 0),
          0
        ) / trades.length
      : 0;

  return {
    name,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate:
      trades.length
        ? (wins / trades.length) * 100
        : 0,
    netR,
    pf:
      grossLoss
        ? grossWin / grossLoss
        : grossWin
          ? 999
          : 0,
    exp:
      trades.length
        ? netR / trades.length
        : 0,
    dd,
    worstLossStreak,
    mfe: avg('mfeR'),
    mae: avg('maeR')
  };
}

function run(c, emaValues, atrValues, start, end, tpR) {
  const trades = [];

  for (
    let i = Math.max(210, start);
    i <= Math.min(end, c.length - 2);
  ) {
    const prevEma = emaValues[i - 1];
    const currentEma = emaValues[i];
    const currentAtr = atrValues[i];

    if (
      prevEma == null ||
      currentEma == null ||
      !currentAtr
    ) {
      i++;
      continue;
    }

    let side = null;

    // Close crosses from below to above EMA.
    if (
      c[i - 1].close <= prevEma &&
      c[i].close > currentEma
    ) {
      side = 'BUY';
    }

    // Close crosses from above to below EMA.
    else if (
      c[i - 1].close >= prevEma &&
      c[i].close < currentEma
    ) {
      side = 'SELL';
    }

    if (!side) {
      i++;
      continue;
    }

    const trade = makeTrade(
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

    const done = simulate(
      c,
      trade,
      end + 1
    );

    if (!done) {
      i++;
      continue;
    }

    trades.push(done);

    // Only one active trade at a time.
    i = Math.max(
      i + 1,
      done.exitIndex + 1
    );
  }

  return trades;
}

function score(r) {
  if (r.trades < 20) return -999;

  return (
    r.exp * 25 +
    Math.min(r.pf, 3) * 2 +
    r.netR * 0.10 -
    r.dd * 0.08 +
    Math.min(r.trades, 100) * 0.005
  );
}

(async () => {
  console.log('');
  console.log('==========================================');
  console.log(' 📈 EMA CLOSE CROSS BACKTEST V2');
  console.log(' XAUUSD | 5m');
  console.log('==========================================');
  console.log('');

  console.log(`🕯️ Target candles: ${HISTORY}`);
  console.log(
    `💸 Spread=$${SPREAD} | Slippage=$${SLIP}/side`
  );

  console.log('');
  console.log('📥 Loading historical XAUUSD 5m...');

  const c = rows(
    await getGoldHistoricalCandles(
      '5min',
      HISTORY
    )
  );

  console.log(`✅ Loaded: ${c.length} candles`);

  if (c.length < 1000) {
    throw new Error(
      `Not enough candles: ${c.length}`
    );
  }

  const closes = c.map(x => x.close);
  const atrValues = atr(c, 14);

  const N = c.length;

  const devEnd =
    Math.floor(N * 0.60) - 1;

  const valEnd =
    Math.floor(N * 0.80) - 1;

  const splits = {
    DEV: [210, devEnd],
    VAL: [devEnd + 1, valEnd],
    FINAL: [valEnd + 1, N - 2]
  };

  console.log('');
  console.log(
    `🧪 Split: 60/20/20 | DEV=${splits.DEV[1] - splits.DEV[0] + 1}` +
    ` | VAL=${splits.VAL[1] - splits.VAL[0] + 1}` +
    ` | FINAL=${splits.FINAL[1] - splits.FINAL[0] + 1}`
  );

  const selected = [];

  for (const period of EMA_PERIODS) {
    console.log('');
    console.log(`🔍 Testing EMA ${period}...`);

    const emaValues = ema(
      closes,
      period
    );

    const devResults =
      TP_PROFILES.map(tpR => {
        const trades = run(
          c,
          emaValues,
          atrValues,
          ...splits.DEV,
          tpR
        );

        return {
          tpR,
          summary: summarize(
            `EMA ${period}`,
            trades
          )
        };
      }).sort(
        (a, b) =>
          score(b.summary) -
          score(a.summary)
      );

    const bestDev = devResults[0];

    const valTrades = run(
      c,
      emaValues,
      atrValues,
      ...splits.VAL,
      bestDev.tpR
    );

    const val = summarize(
      `EMA ${period}`,
      valTrades
    );

    selected.push({
      period,
      tpR: bestDev.tpR,
      dev: bestDev.summary,
      val,
      emaValues
    });
  }

  // Select EMA based only on validation score.
  selected.sort(
    (a, b) =>
      score(b.val) -
      score(a.val)
  );

  const finalResults = [];

  for (const x of selected) {
    const finalTrades = run(
      c,
      x.emaValues,
      atrValues,
      ...splits.FINAL,
      x.tpR
    );

    const final = summarize(
      `EMA ${x.period}`,
      finalTrades
    );

    const qualified =
      final.trades >= 20 &&
      final.netR > 0 &&
      final.pf >= 1.15 &&
      final.exp > 0 &&
      final.dd <= 15;

    finalResults.push({
      ema: x.period,
      tpR: x.tpR,
      dev: x.dev,
      val: x.val,
      final,
      qualified
    });
  }

  finalResults.sort(
    (a, b) =>
      score(b.final) -
      score(a.final)
  );

  console.log('');
  console.log('🏆 FINAL HOLDOUT EMA RANKING');
  console.log('');

  finalResults.forEach(
    (x, index) => {
      console.log(
        `${index + 1}. EMA ${x.ema}` +
        ` | ${x.qualified ? '✅ QUALIFIED' : '❌'}` +
        ` | TP=${x.tpR}R` +
        ` | trades=${x.final.trades}` +
        ` | WR=${x.final.winRate.toFixed(1)}%` +
        ` | Net=${x.final.netR.toFixed(2)}R` +
        ` | PF=${x.final.pf.toFixed(2)}` +
        ` | Exp=${x.final.exp.toFixed(3)}R` +
        ` | DD=${x.final.dd.toFixed(2)}R` +
        ` | MFE=${x.final.mfe.toFixed(2)}` +
        ` | MAE=${x.final.mae.toFixed(2)}`
      );
    }
  );

  console.log('');
  console.log('🥇 QUALIFIED EMA RESULTS');

  const qualified =
    finalResults.filter(
      x => x.qualified
    );

  if (!qualified.length) {
    console.log(
      'No EMA passed the qualification gates.'
    );
  } else {
    qualified.forEach((x, i) => {
      console.log(
        `${i + 1}. EMA ${x.ema}` +
        ` | TP=${x.tpR}R` +
        ` | Net=${x.final.netR.toFixed(2)}R` +
        ` | PF=${x.final.pf.toFixed(2)}` +
        ` | Exp=${x.final.exp.toFixed(3)}R` +
        ` | DD=${x.final.dd.toFixed(2)}R`
      );
    });
  }

  const report = {
    generatedAt:
      new Date().toISOString(),

    strategy:
      'EMA_CLOSE_CROSS',

    rules: {
      buy:
        'Previous close <= EMA and current close > EMA',
      sell:
        'Previous close >= EMA and current close < EMA',
      entry:
        'Next candle open with slippage',
      stop:
        'Signal candle opposite extreme + 0.10 ATR buffer, minimum 0.50 ATR',
      tpProfiles:
        TP_PROFILES
    },

    history: {
      candles: c.length,
      timeframe: '5min'
    },

    costs: {
      spread: SPREAD,
      slippagePerSide: SLIP
    },

    split: '60/20/20',

    qualification: {
      minFinalTrades: 20,
      minPF: 1.15,
      minNetR: 0,
      minExpectancy: 0,
      maxDD: 15
    },

    results: finalResults
  };

  const jsonPath = path.join(
    OUT,
    'ema-close-cross-v2-latest.json'
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      report,
      null,
      2
    )
  );

  const csvPath = path.join(
    OUT,
    'ema-close-cross-v2-latest.csv'
  );

  fs.writeFileSync(
    csvPath,
    'rank,ema,qualified,tp,trades,wr,net_r,pf,exp,dd,mfe,mae\n' +
    finalResults
      .map(
        (x, i) =>
          [
            i + 1,
            x.ema,
            x.qualified,
            x.tpR,
            x.final.trades,
            x.final.winRate.toFixed(2),
            x.final.netR.toFixed(2),
            x.final.pf.toFixed(3),
            x.final.exp.toFixed(3),
            x.final.dd.toFixed(2),
            x.final.mfe.toFixed(3),
            x.final.mae.toFixed(3)
          ].join(',')
      )
      .join('\n') +
    '\n'
  );

  console.log('');
  console.log(`📄 JSON: ${jsonPath}`);
  console.log(`📄 CSV : ${csvPath}`);
})().catch(err => {
  console.error(
    '❌ EMA Close Cross backtest failed:',
    err
  );
  process.exitCode = 1;
});
