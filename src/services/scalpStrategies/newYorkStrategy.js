const { getCandles, getPrice } = require('../marketService');

const CONFIG = {
  id: 'NEW_YORK',
  label: '🗽 New York Strategy',
  pair: 'XAUUSD',
  sessionStartMinutes: 8 * 60 + 30,
  sessionEndMinutes: 12 * 60,
  adx15Min: 24,
  chaseAtrMax: 0.20,
  touchToleranceAtr: 0.12,
  confirmationBodyAtrMax: 0.20,
  momentumMin: 2,
  swingLookback: 12,
  slBufferAtr: 0.15,
  minRiskAtr: 0.55,
  tp1R: 1.50,
  tp2R: 1.50
};

const STATE = {
  lastSentAt: 0,
  lastDirection: null,
  lastEntryBucket: null
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function closedBars(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.length > 1 ? rows.slice(0, -1) : rows.slice();
}

function closes(rows) {
  return rows.map(x => finite(x.close)).filter(x => x != null);
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + Number(b), 0) / period;
  for (let i = period; i < values.length; i++) {
    const n = Number(values[i]);
    if (!Number.isFinite(n)) continue;
    value = n * k + value * (1 - k);
  }
  return value;
}

function atr(rows, period = 14) {
  if (!Array.isArray(rows) || rows.length < period + 1) return null;
  const sample = rows.slice(-(period + 1));
  let sum = 0;
  let count = 0;
  for (let i = 1; i < sample.length; i++) {
    const h = finite(sample[i].high);
    const l = finite(sample[i].low);
    const pc = finite(sample[i - 1].close);
    if (h == null || l == null || pc == null) continue;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    count++;
  }
  return count ? sum / count : null;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = Number(values[i]) - Number(values[i - 1]);
    if (!Number.isFinite(d)) return null;
    if (d >= 0) gains += d;
    else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function adx(rows, period = 14) {
  if (!Array.isArray(rows) || rows.length < period * 2 + 1) return null;
  const sample = rows.slice(-(period * 2 + 1));
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < sample.length; i++) {
    const h = finite(sample[i].high), l = finite(sample[i].low);
    const ph = finite(sample[i - 1].high), pl = finite(sample[i - 1].low), pc = finite(sample[i - 1].close);
    if ([h, l, ph, pl, pc].some(x => x == null)) return null;
    const up = h - ph;
    const down = pl - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const dx = [];
  for (let end = period; end <= tr.length; end++) {
    const start = end - period;
    const trSum = tr.slice(start, end).reduce((a, b) => a + b, 0);
    if (!(trSum > 0)) continue;
    const p = 100 * plusDM.slice(start, end).reduce((a, b) => a + b, 0) / trSum;
    const m = 100 * minusDM.slice(start, end).reduce((a, b) => a + b, 0) / trSum;
    if (!(p + m > 0)) continue;
    dx.push(100 * Math.abs(p - m) / (p + m));
  }
  if (!dx.length) return null;
  const tail = dx.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

function sessionVwap(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const last = rows[rows.length - 1];
  const lastDay = String(last.datetime || last.time || last.timestamp || '').slice(0, 10);
  const sameDay = rows.filter(r => String(r.datetime || r.time || r.timestamp || '').slice(0, 10) === lastDay);
  let pv = 0, vol = 0;
  for (const c of sameDay) {
    const h = finite(c.high), l = finite(c.low), cl = finite(c.close), v = finite(c.volume);
    if (h == null || l == null || cl == null || !(v > 0)) continue;
    pv += ((h + l + cl) / 3) * v;
    vol += v;
  }
  if (vol > 0) return pv / vol;
  const fallback = rows.slice(-24);
  let fpv = 0, fv = 0;
  for (const c of fallback) {
    const h = finite(c.high), l = finite(c.low), cl = finite(c.close), v = finite(c.volume);
    if (h == null || l == null || cl == null || !(v > 0)) continue;
    fpv += ((h + l + cl) / 3) * v;
    fv += v;
  }
  return fv > 0 ? fpv / fv : null;
}

function momentum(rows, lookback = 3) {
  const sample = rows.slice(-lookback);
  if (sample.length < lookback) return { direction: null, strength: 0, impulse: 0 };
  let impulse = 0, rawStrength = 0;
  for (const c of sample) {
    const o = finite(c.open), cl = finite(c.close);
    if (o == null || cl == null) continue;
    const d = cl - o;
    impulse += d;
    if (d > 0) rawStrength++;
    else if (d < 0) rawStrength--;
  }
  return {
    direction: impulse > 0 ? 'BUY' : impulse < 0 ? 'SELL' : null,
    strength: Math.abs(rawStrength),
    impulse
  };
}

function inNewYorkSession(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type)?.value || 0);
  const minuteOfDay = get('hour') * 60 + get('minute');
  return minuteOfDay >= CONFIG.sessionStartMinutes && minuteOfDay < CONFIG.sessionEndMinutes;
}

function trendFrom(rows) {
  const cls = closes(rows);
  if (cls.length < 50) return null;
  const e20 = ema(cls, 20);
  const e50 = ema(cls, 50);
  if (e20 == null || e50 == null) return null;
  return e20 > e50 ? 'BUY' : e20 < e50 ? 'SELL' : null;
}

function recentSwing(rows, side, lookback = CONFIG.swingLookback) {
  const sample = rows.slice(-lookback);
  if (!sample.length) return null;
  const vals = sample.map(c => finite(side === 'BUY' ? c.low : c.high)).filter(v => v != null);
  if (!vals.length) return null;
  return side === 'BUY' ? Math.min(...vals) : Math.max(...vals);
}

function scoreSetup({ adx15, chaseAtr, momentumStrength }) {
  let score = 70;
  if (adx15 >= 25) score += 8;
  else if (adx15 >= 22) score += 5;
  if (chaseAtr <= 0.35) score += 10;
  else if (chaseAtr <= 0.50) score += 6;
  score += Math.min(8, momentumStrength * 2);
  return Math.min(100, Math.round(score));
}

async function scanNewYorkStrategy() {
  const pair = CONFIG.pair;

  if (!inNewYorkSession()) {
    return { ready: false, status: 'NY_OUTSIDE_SESSION', pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const [raw5, raw15, raw1h, livePrice] = await Promise.all([
    getCandles(pair, '5min'),
    getCandles(pair, '15min'),
    getCandles(pair, '1h'),
    getPrice(pair)
  ]);

  const c5 = closedBars(raw5);
  const c15 = closedBars(raw15);
  const c1h = closedBars(raw1h);

  if (c5.length < 40 || c15.length < 55 || c1h.length < 55) {
    return { ready: false, status: 'NY_NO_DATA', pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const trend15 = trendFrom(c15);
  const trend1h = trendFrom(c1h);
  const adx15 = adx(c15, 14);

  if (!trend15 || !trend1h || trend15 !== trend1h) {
    return { ready: false, status: 'NY_REGIME_MISMATCH', pair, trend15, trend1h, adx15, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  if (!(adx15 >= CONFIG.adx15Min)) {
    return { ready: false, status: 'NY_ADX15_TOO_WEAK', pair, trend15, trend1h, adx15, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const side = trend15;
  const close5 = closes(c5);
  const atr5 = atr(c5, 14);
  const rsi5 = rsi(close5, 14);
  const ema20 = ema(close5, 20);
  const vwap5 = sessionVwap(c5);
  const last = c5[c5.length - 1];
  const lastClose = finite(last.close);
  const lastOpen = finite(last.open);

  if ([atr5, ema20, vwap5, lastClose, lastOpen].some(x => x == null) || !(atr5 > 0)) {
    return { ready: false, status: 'NY_INDICATORS_NOT_READY', pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const distEmaAtr = Math.abs(lastClose - ema20) / atr5;
  const distVwapAtr = Math.abs(lastClose - vwap5) / atr5;
  const chaseAtr = Math.min(distEmaAtr, distVwapAtr);

  if (chaseAtr > CONFIG.chaseAtrMax) {
    return { ready: false, status: 'NY_ANTI_CHASE', pair, side, trend15, trend1h, adx15, atr5, ema20, vwap5, chaseAtr, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const recent = c5.slice(-4);
  const tol = atr5 * CONFIG.touchToleranceAtr;
  const touchedEma = recent.some(x => finite(x.low) <= ema20 + tol && finite(x.high) >= ema20 - tol);
  const touchedVwap = recent.some(x => finite(x.low) <= vwap5 + tol && finite(x.high) >= vwap5 - tol);

  if (!touchedEma && !touchedVwap) {
    return { ready: false, status: 'NY_NO_PULLBACK_TOUCH', pair, side, trend15, trend1h, adx15, atr5, ema20, vwap5, chaseAtr, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const candleDirectionOk = side === 'BUY' ? lastClose > lastOpen : lastClose < lastOpen;
  const anchorConfirmed = side === 'BUY'
    ? (lastClose >= ema20 || lastClose >= vwap5)
    : (lastClose <= ema20 || lastClose <= vwap5);

  if (!candleDirectionOk || !anchorConfirmed) {
    return { ready: false, status: 'NY_CONFIRMATION_NOT_READY', pair, side, trend15, trend1h, adx15, atr5, ema20, vwap5, chaseAtr, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const mom = momentum(c5, 3);
  if (mom.direction !== side || mom.strength < CONFIG.momentumMin) {
    return { ready: false, status: 'NY_MOMENTUM_NOT_RETURNED', pair, side, trend15, trend1h, adx15, atr5, ema20, vwap5, chaseAtr, momentum: mom, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const bodyAtr = Math.abs(lastClose - lastOpen) / atr5;
  if (bodyAtr > CONFIG.confirmationBodyAtrMax) {
    return { ready: false, status: 'NY_EXECUTION_CANDLE_TOO_LARGE', pair, side, trend15, trend1h, adx15, atr5, bodyAtr, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const entry = finite(livePrice) ?? finite(raw5?.[raw5.length - 1]?.close) ?? lastClose;
  const liveDist = Math.min(Math.abs(entry - ema20), Math.abs(entry - vwap5)) / atr5;
  if (liveDist > CONFIG.chaseAtrMax) {
    return { ready: false, status: 'NY_LIVE_ANTI_CHASE', pair, side, entry, atr5, liveDist, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const swing = recentSwing(c5, side, CONFIG.swingLookback);
  if (swing == null) {
    return { ready: false, status: 'NY_SWING_NOT_READY', pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const rawRisk = side === 'BUY'
    ? entry - (swing - atr5 * CONFIG.slBufferAtr)
    : (swing + atr5 * CONFIG.slBufferAtr) - entry;
  const risk = Math.max(rawRisk, atr5 * CONFIG.minRiskAtr);
  if (!(risk > 0)) {
    return { ready: false, status: 'NY_INVALID_RISK', pair, strategyId: CONFIG.id, strategyLabel: CONFIG.label };
  }

  const stopLoss = side === 'BUY' ? entry - risk : entry + risk;
  const tp1 = side === 'BUY' ? entry + risk * CONFIG.tp1R : entry - risk * CONFIG.tp1R;
  const tp2 = side === 'BUY' ? entry + risk * CONFIG.tp2R : entry - risk * CONFIG.tp2R;
  const score = scoreSetup({ adx15, chaseAtr: liveDist, momentumStrength: mom.strength });

  return {
    ready: true,
    status: 'NY_READY',
    pair,
    direction: side,
    strategyId: CONFIG.id,
    strategyLabel: CONFIG.label,
    entryMode: 'REGIME_PULLBACK',
    grade: 'A',
    score,
    aiConfidence: 0,
    entry,
    stopLoss,
    tp1,
    tp2,
    risk,
    rrTp1: CONFIG.tp1R,
    rrTp2: CONFIG.tp2R,
    atr5,
    rsi5,
    adx5: adx(c5, 14),
    adx15,
    trend15,
    trend1h,
    ema20,
    vwap5,
    chaseAtr: liveDist,
    momentum: mom,
    bodyAtr,
    reasons: [
      'NY session active',
      'H1 + 15M regime aligned',
      `ADX15 >= ${CONFIG.adx15Min}`,
      '5M pullback touched EMA20/VWAP',
      `Anti-chase <= ${CONFIG.chaseAtrMax} ATR`,
      '5M confirmation candle',
      `Momentum strength >= ${CONFIG.momentumMin}`
    ]
  };
}

function markSent(direction, entry, atr5) {
  STATE.lastSentAt = Date.now();
  STATE.lastDirection = direction;
  const bucket = Math.max(Number(atr5) || 1, 1);
  STATE.lastEntryBucket = Math.round(Number(entry) / bucket);
}

module.exports = {
  CONFIG,
  scan: scanNewYorkStrategy,
  markSent
};
