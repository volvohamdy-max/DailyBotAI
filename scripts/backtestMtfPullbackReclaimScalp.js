require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGoldHistoricalCandles } = require('./backtestHistoryV21');

const HISTORY_5M = Math.max(10000, Math.min(60000, Number(process.env.BACKTEST_HISTORY || 60000)));
const HISTORY_15M = Math.max(10000, Math.min(60000, Number(process.env.BACKTEST_HISTORY_15M || 60000)));
const SPREAD = Math.max(0, Number(process.env.BACKTEST_SPREAD_USD || 0.35));
const SLIP = Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_USD || 0.05));
const OUT = path.resolve(process.cwd(), 'data', 'backtests');
fs.mkdirSync(OUT, { recursive: true });

const TP_RS = [0.7, 1.0, 1.3];
const ADX_MINS = [20, 23, 26];
const BODY_ATR_MINS = [0.20, 0.30, 0.40];
const VOL_RATIOS = [0.90, 1.00, 1.10];
const PULLBACK_TOLS = [0.10, 0.20];

const num = v => Number.isFinite(Number(v)) ? Number(v) : null;

function normalize(x = []) {
  return x.map(r => ({
    time: Number(r.time), open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume) || 0
  })).filter(r => [r.time, r.open, r.high, r.low, r.close].every(Number.isFinite)).sort((a, b) => a.time - b.time);
}

function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let e = sum / period;
  out[period - 1] = e;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function atr(c, period = 14) {
  const tr = Array(c.length).fill(null);
  const out = Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) {
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  if (c.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let a = sum / period;
  out[period] = a;
  for (let i = period + 1; i < c.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

function adx(c, period = 14) {
  const out = Array(c.length).fill(null);
  if (c.length < period * 2 + 2) return out;
  const tr = Array(c.length).fill(0);
  const plusDM = Array(c.length).fill(0);
  const minusDM = Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  let smTR = 0, smPlus = 0, smMinus = 0;
  for (let i = 1; i <= period; i++) {
    smTR += tr[i]; smPlus += plusDM[i]; smMinus += minusDM[i];
  }
  const dx = Array(c.length).fill(null);
  for (let i = period; i < c.length; i++) {
    if (i > period) {
      smTR = smTR - smTR / period + tr[i];
      smPlus = smPlus - smPlus / period + plusDM[i];
      smMinus = smMinus - smMinus / period + minusDM[i];
    }
    const pdi = smTR > 0 ? 100 * smPlus / smTR : 0;
    const mdi = smTR > 0 ? 100 * smMinus / smTR : 0;
    dx[i] = (pdi + mdi) > 0 ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
  }
  let sumDx = 0;
  const first = period * 2 - 1;
  for (let i = period; i <= first; i++) sumDx += dx[i] || 0;
  let a = sumDx / period;
  out[first] = a;
  for (let i = first + 1; i < c.length; i++) {
    a = (a * (period - 1) + (dx[i] || 0)) / period;
    out[i] = a;
  }
  return out;
}

function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += Number(values[i]) || 0;
    if (i >= period) sum -= Number(values[i - period]) || 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function nyDayKey(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(ts));
}

function sessionVwap(c) {
  const out = Array(c.length).fill(null);
  let key = null, pv = 0, vol = 0;
  for (let i = 0; i < c.length; i++) {
    const k = nyDayKey(c[i].time);
    if (k !== key) { key = k; pv = 0; vol = 0; }
    const v = Math.max(0, c[i].volume || 0);
    const typical = (c[i].high + c[i].low + c[i].close) / 3;
    pv += typical * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

function mapHigherTimeframe(base, higher, higherValues) {
  const out = Array(base.length).fill(null);
  let j = 0;
  for (let i = 0; i < base.length; i++) {
    while (j + 1 < higher.length && higher[j + 1].time <= base[i].time) j++;
    if (higher[j] && higher[j].time <= base[i].time) out[i] = higherValues[j];
  }
  return out;
}

function makeTrade(c, i, side, atrValue, tpR) {
  const entryIndex = i + 1;
  if (entryIndex >= c.length || !(atrValue > 0)) return null;
  const entry = side === 'BUY' ? c[entryIndex].open + SLIP : c[entryIndex].open - SLIP;
  const structural = side === 'BUY' ? entry - (c[i].low - atrValue * 0.10) : (c[i].high + atrValue * 0.10) - entry;
  const risk = Math.max(structural, atrValue * 0.65);
  if (!(risk > 0)) return null;
  const sl = side === 'BUY' ? entry - risk : entry + risk;
  const tp = side === 'BUY' ? entry + risk * tpR : entry - risk * tpR;
  const costR = (SPREAD + 2 * SLIP) / risk;
  return { side, signalIndex: i, entryIndex, entry, sl, tp, risk, costR, tpR };
}

function resolveTrade(c, t, maxBars = 36) {
  const end = Math.min(c.length - 1, t.entryIndex + maxBars);
  for (let k = t.entryIndex; k <= end; k++) {
    const bar = c[k];
    const hitSL = t.side === 'BUY' ? bar.low <= t.sl : bar.high >= t.sl;
    const hitTP = t.side === 'BUY' ? bar.high >= t.tp : bar.low <= t.tp;
    if (hitSL && hitTP) return { ...t, exitIndex: k, resultR: -1 - t.costR, reason: 'BOTH->SL' };
    if (hitSL) return { ...t, exitIndex: k, resultR: -1 - t.costR, reason: 'SL' };
    if (hitTP) return { ...t, exitIndex: k, resultR: t.tpR - t.costR, reason: 'TP' };
  }
  const last = c[end].close;
  const grossR = t.side === 'BUY' ? (last - t.entry) / t.risk : (t.entry - last) / t.risk;
  return { ...t, exitIndex: end, resultR: grossR - t.costR, reason: 'TIME' };
}

function stats(trades) {
  const n = trades.length;
  if (!n) return { trades: 0, wins: 0, wr: 0, netR: 0, avgR: 0, pf: 0, dd: 0, maxLS: 0 };
  let wins = 0, grossWin = 0, grossLoss = 0, netR = 0, peak = 0, equity = 0, dd = 0, ls = 0, maxLS = 0;
  for (const t of trades) {
    const r = t.resultR;
    netR += r; equity += r;
    if (r > 0) { wins++; grossWin += r; ls = 0; }
    else { grossLoss += Math.abs(r); ls++; maxLS = Math.max(maxLS, ls); }
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return { trades: n, wins, wr: wins / n * 100, netR, avgR: netR / n, pf: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0, dd, maxLS };
}

function fmt(s) {
  return `${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.netR >= 0 ? '+' : ''}${s.netR.toFixed(2)}R | Avg ${s.avgR.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.maxLS}`;
}

function signalFor(c, i, ctx, p) {
  const { e9, e21, a14, adx14, vwap, volSma, htfEma200 } = ctx;
  if (i < 2 || ![e9[i], e21[i], a14[i], adx14[i], vwap[i], htfEma200[i], volSma[i]].every(Number.isFinite)) return null;
  const body = Math.abs(c[i].close - c[i].open) / a14[i];
  if (body < p.bodyMin || adx14[i] < p.adxMin) return null;
  if (c[i].volume > 0 && volSma[i] > 0 && c[i].volume / volSma[i] < p.volRatio) return null;
  const tol = a14[i] * p.pullbackTol;

  const buyTrend = c[i].close > htfEma200[i] && e9[i] > e21[i] && c[i].close > vwap[i];
  const sellTrend = c[i].close < htfEma200[i] && e9[i] < e21[i] && c[i].close < vwap[i];

  const buyPullback = c[i - 1].low <= e9[i - 1] + tol || c[i - 1].low <= e21[i - 1] + tol;
  const sellPullback = c[i - 1].high >= e9[i - 1] - tol || c[i - 1].high >= e21[i - 1] - tol;

  const buyReclaim = c[i].close > e9[i] && c[i].close > c[i - 1].high && c[i].close > c[i].open;
  const sellReclaim = c[i].close < e9[i] && c[i].close < c[i - 1].low && c[i].close < c[i].open;

  if (buyTrend && buyPullback && buyReclaim) return 'BUY';
  if (sellTrend && sellPullback && sellReclaim) return 'SELL';
  return null;
}

function runVariant(c, ctx, p, from, to) {
  const trades = [];
  let nextFree = from;
  for (let i = Math.max(from, 250); i < Math.min(to, c.length - 2); i++) {
    if (i < nextFree) continue;
    const side = signalFor(c, i, ctx, p);
    if (!side) continue;
    const t = makeTrade(c, i, side, ctx.a14[i], p.tpR);
    if (!t) continue;
    const done = resolveTrade(c, t);
    trades.push(done);
    nextFree = done.exitIndex + 1;
  }
  return trades;
}

function score(dev, val) {
  if (dev.trades < 20 || val.trades < 6) return -1e9;
  const robustness = Math.min(dev.pf, val.pf);
  const wr = Math.min(dev.wr, val.wr) / 100;
  const avg = Math.min(dev.avgR, val.avgR);
  const ddPenalty = (dev.dd + val.dd) * 0.03;
  return robustness * 1.4 + wr + avg * 2 - ddPenalty;
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚡ MTF PULLBACK-RECLAIM SCALP BACKTEST');
  console.log('XAUUSD | 5m trigger + 15m EMA200 trend');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`History 5m=${HISTORY_5M} | 15m=${HISTORY_15M} | spread=$${SPREAD} | slip=$${SLIP}`);

  const [raw5, raw15] = await Promise.all([
    getGoldHistoricalCandles('5min', HISTORY_5M),
    getGoldHistoricalCandles('15min', HISTORY_15M)
  ]);
  const c = normalize(raw5);
  const h = normalize(raw15);
  const e9 = ema(c.map(x => x.close), 9);
  const e21 = ema(c.map(x => x.close), 21);
  const a14 = atr(c, 14);
  const adx14 = adx(c, 14);
  const vwap = sessionVwap(c);
  const volSma = sma(c.map(x => x.volume), 20);
  const hEma = ema(h.map(x => x.close), 200);
  const htfEma200 = mapHigherTimeframe(c, h, hEma);
  const ctx = { e9, e21, a14, adx14, vwap, volSma, htfEma200 };

  const start = Math.max(250, c.findIndex((x, i) => Number.isFinite(htfEma200[i])));
  const usable = c.length - start;
  const devEnd = start + Math.floor(usable * 0.60);
  const valEnd = start + Math.floor(usable * 0.80);

  const variants = [];
  for (const tpR of TP_RS) for (const adxMin of ADX_MINS) for (const bodyMin of BODY_ATR_MINS) for (const volRatio of VOL_RATIOS) for (const pullbackTol of PULLBACK_TOLS) {
    variants.push({ tpR, adxMin, bodyMin, volRatio, pullbackTol });
  }
  console.log(`🔬 Variants=${variants.length}`);

  const leaderboard = [];
  for (let v = 0; v < variants.length; v++) {
    const p = variants[v];
    const devT = runVariant(c, ctx, p, start, devEnd);
    const valT = runVariant(c, ctx, p, devEnd, valEnd);
    const dev = stats(devT), val = stats(valT);
    leaderboard.push({ p, dev, val, score: score(dev, val) });
    if ((v + 1) % 18 === 0 || v === variants.length - 1) console.log(`🔍 ${v + 1}/${variants.length}`);
  }

  leaderboard.sort((a, b) => b.score - a.score);
  const top = leaderboard.slice(0, 10);
  console.log('\n🏆 TOP DEV+VAL');
  top.forEach((x, i) => {
    console.log(`${i + 1}. ${JSON.stringify(x.p)}`);
    console.log(`   DEV ${fmt(x.dev)}`);
    console.log(`   VAL ${fmt(x.val)} | score=${x.score.toFixed(3)}`);
  });

  const best = top[0];
  if (!best || best.score <= -1e8) throw new Error('No robust variant passed minimum trade counts');
  const oosTrades = runVariant(c, ctx, best.p, valEnd, c.length);
  const oos = stats(oosTrades);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 OOS — UNTOUCHED 20%');
  console.log(`Params: ${JSON.stringify(best.p)}`);
  console.log(fmt(oos));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const payload = {
    generatedAt: new Date().toISOString(), strategy: 'MTF_PULLBACK_RECLAIM_SCALP',
    symbol: 'XAUUSD', timeframes: { trigger: '5min', trend: '15min' }, costs: { spreadUsd: SPREAD, slippageUsd: SLIP },
    split: { start, devEnd, valEnd, total: c.length }, best: { ...best, oos }, top10: top
  };
  const jsonPath = path.join(OUT, 'mtf-pullback-reclaim-scalp-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.log(`💾 ${jsonPath}`);
})().catch(err => {
  console.error('❌ Backtest failed:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
