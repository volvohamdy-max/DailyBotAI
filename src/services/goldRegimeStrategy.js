const { getCandles, getPrice } = require('./marketService');
const { analyzePair } = require('./analysisGate');

const STATE = {
  lastSentAt: 0,
  lastDirection: null,
  lastEntryBucket: null
};

const CONFIG = {
  pair: 'XAUUSD',

  // Active, but not reckless.
  minScoreStrict: 65,
  minScoreEarly: 72,
  minScoreBreakout: 68,

  minAiStrong: 60,
  minAiSupport: 54,

  cooldownMs: 10 * 60 * 1000,
  reverseCooldownMs: 5 * 60 * 1000,

  baseLateAtr: 1.25,
  strongLateAtr: 1.55,
  eliteLateAtr: 1.80,
  breakoutLateAtr: 2.20,

  slAtrMultiplier: 1.20,
  minRiskUsd: 3.0,
  maxRiskAtr: 2.20,
  maxRiskUsd: 8.5,

  tp1R: 1.50,
  tp2R: 2.00
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;

  const k = 2 / (period + 1);
  let value = Number(values[0]);

  if (!Number.isFinite(value)) return null;

  for (let i = 1; i < values.length; i++) {
    const n = Number(values[i]);
    if (!Number.isFinite(n)) continue;
    value = n * k + value * (1 - k);
  }

  return value;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const current = Number(values[i]);
    const previous = Number(values[i - 1]);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return null;
    }

    const diff = current - previous;

    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;

  const sample = candles.slice(-(period + 1));
  const ranges = [];

  for (let i = 1; i < sample.length; i++) {
    const high = finite(sample[i].high);
    const low = finite(sample[i].low);
    const prevClose = finite(sample[i - 1].close);

    if (high == null || low == null || prevClose == null) continue;

    ranges.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );
  }

  if (!ranges.length) return null;

  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}


function adx(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period * 2 + 1) {
    return null;
  }

  const rows = candles.slice(-(period * 2 + 1));

  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < rows.length; i++) {
    const high = finite(rows[i].high);
    const low = finite(rows[i].low);
    const prevHigh = finite(rows[i - 1].high);
    const prevLow = finite(rows[i - 1].low);
    const prevClose = finite(rows[i - 1].close);

    if (
      high == null ||
      low == null ||
      prevHigh == null ||
      prevLow == null ||
      prevClose == null
    ) {
      return null;
    }

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    plusDM.push(
      upMove > downMove && upMove > 0 ? upMove : 0
    );

    minusDM.push(
      downMove > upMove && downMove > 0 ? downMove : 0
    );

    tr.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );
  }

  const dxValues = [];

  for (let end = period; end <= tr.length; end++) {
    const start = end - period;

    const trSum = tr.slice(start, end)
      .reduce((a, b) => a + b, 0);

    if (trSum <= 0) continue;

    const plusSum = plusDM.slice(start, end)
      .reduce((a, b) => a + b, 0);

    const minusSum = minusDM.slice(start, end)
      .reduce((a, b) => a + b, 0);

    const plusDI = 100 * plusSum / trSum;
    const minusDI = 100 * minusSum / trSum;

    const total = plusDI + minusDI;

    if (total <= 0) continue;

    dxValues.push(
      100 * Math.abs(plusDI - minusDI) / total
    );
  }

  if (!dxValues.length) return null;

  return dxValues.slice(-period)
    .reduce((a, b) => a + b, 0) /
    Math.min(period, dxValues.length);
}


function vwap(candles, lookback = 24) {
  if (!Array.isArray(candles) || !candles.length) {
    return null;
  }

  const rows = candles.slice(-lookback);

  let totalPV = 0;
  let totalVolume = 0;

  for (const candle of rows) {
    const high = finite(candle.high);
    const low = finite(candle.low);
    const close = finite(candle.close);
    const volume = finite(
      candle.volume ??
      candle.v ??
      candle.tick_volume ??
      candle.tickVolume ??
      candle.vol
    );

    if (
      high == null ||
      low == null ||
      close == null ||
      volume == null ||
      volume <= 0
    ) {
      continue;
    }

    const typicalPrice =
      (high + low + close) / 3;

    totalPV += typicalPrice * volume;
    totalVolume += volume;
  }

  if (totalVolume <= 0) {
    return null;
  }

  return totalPV / totalVolume;
}

function recentMomentum(closes) {
  if (!Array.isArray(closes) || closes.length < 6) {
    return { direction: 'WAIT', strength: 0, impulse: 0 };
  }

  const recent = closes.slice(-5);
  let up = 0;
  let down = 0;
  let impulse = 0;

  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    impulse += diff;

    if (diff > 0) up++;
    else if (diff < 0) down++;
  }

  if (up >= 3) {
    return { direction: 'BUY', strength: up, impulse };
  }

  if (down >= 3) {
    return { direction: 'SELL', strength: down, impulse };
  }

  if (up > down) {
    return { direction: 'BUY', strength: up, impulse };
  }

  if (down > up) {
    return { direction: 'SELL', strength: down, impulse };
  }

  return { direction: 'WAIT', strength: Math.max(up, down), impulse };
}

function get15mTrend(analysis) {
  if (!analysis) return 'WAIT';

  if (
    analysis.technicalDirection === 'BUY' ||
    analysis.technicalDirection === 'SELL'
  ) {
    return analysis.technicalDirection;
  }

  const ema20 = finite(analysis.indicators?.ema20);
  const ema50 = finite(analysis.indicators?.ema50);

  if (ema20 != null && ema50 != null) {
    if (ema20 > ema50) return 'BUY';
    if (ema20 < ema50) return 'SELL';
  }

  return 'WAIT';
}

function previousRange(candles, count = 6) {
  const rows = candles.slice(-(count + 1), -1);

  if (!rows.length) {
    return { high: null, low: null };
  }

  const highs = rows.map(c => finite(c.high)).filter(v => v != null);
  const lows = rows.map(c => finite(c.low)).filter(v => v != null);

  return {
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null
  };
}

function recentSwing(candles, direction, lookback = 12) {
  const rows = candles.slice(-lookback);

  if (!rows.length) return null;

  if (direction === 'BUY') {
    const lows = rows.map(c => finite(c.low)).filter(v => v != null);
    return lows.length ? Math.min(...lows) : null;
  }

  const highs = rows.map(c => finite(c.high)).filter(v => v != null);
  return highs.length ? Math.max(...highs) : null;
}

function calculateScalpScoreV2({
  direction,
  trend15,
  trend1h,
  emaAligned,
  setupType,
  adx15,
  adx5,
  vwapAligned,
  anchorDistanceAtr,
  momentum,
  rsi5,
  candleConfirmed,
  liveTrigger,
  liveMoveAtr
}) {
  let score = 0;
  const reasons = [];

  // Descriptive score only. Mandatory regime/setup gates are enforced separately.
  if (direction === trend15 && direction === trend1h) {
    score += 25;
    reasons.push('H1 + 15M regime aligned');
  }

  if (emaAligned) {
    score += 10;
    reasons.push('5M EMA structure aligned');
  }

  if (setupType === 'PULLBACK') {
    score += 20;
    reasons.push('5M pullback to EMA20/VWAP confirmed');
  }

  if (adx15 != null) {
    if (adx15 >= 35) {
      score += 15;
      reasons.push('15M ADX strong');
    } else if (adx15 >= 28) {
      score += 12;
      reasons.push('15M ADX healthy');
    } else if (adx15 >= 23) {
      score += 9;
      reasons.push('15M ADX acceptable');
    }
  }

  if (adx5 != null && adx5 >= 20) {
    score += 5;
    reasons.push('5M ADX supportive');
  }

  if (vwapAligned) {
    score += anchorDistanceAtr <= 0.35 ? 10 : 7;
    reasons.push('Entry close to EMA20/VWAP anchor');
  }

  if (candleConfirmed) {
    score += 10;
    reasons.push('5M rejection/continuation candle confirmed');
  }

  if (momentum.direction === direction) {
    score += momentum.strength >= 3 ? 8 : 6;
    reasons.push('Momentum returned with trend');
  }

  if (rsi5 != null) {
    const healthy = direction === 'BUY'
      ? rsi5 >= 46 && rsi5 <= 68
      : rsi5 <= 54 && rsi5 >= 32;

    if (healthy) {
      score += 5;
      reasons.push('RSI not exhausted');
    }
  }

  if (liveTrigger) {
    const move = Math.abs(Number(liveMoveAtr) || 0);
    if (move <= 0.16) {
      score += 7;
      reasons.push('Live trigger early');
    } else if (move <= 0.28) {
      score += 4;
      reasons.push('Live trigger acceptable');
    }
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    reasons
  };
}

function cooldownAllows(direction, entry, atr5) {
  const now = Date.now();

  if (!STATE.lastSentAt) {
    return { allowed: true };
  }

  const elapsed = now - STATE.lastSentAt;

  const reversing =
    STATE.lastDirection &&
    STATE.lastDirection !== direction;

  const minWait = reversing
    ? CONFIG.reverseCooldownMs
    : CONFIG.cooldownMs;

  if (elapsed >= minWait) {
    return { allowed: true };
  }

  const bucketSize = Math.max(Number(atr5) || 1, 1);
  const bucket = Math.round(Number(entry) / bucketSize);

  if (
    reversing &&
    bucket !== STATE.lastEntryBucket
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `COOLDOWN_${Math.ceil((minWait - elapsed) / 60000)}M`
  };
}

function markSent(direction, entry, atr5) {
  const bucketSize = Math.max(Number(atr5) || 1, 1);

  STATE.lastSentAt = Date.now();
  STATE.lastDirection = direction;
  STATE.lastEntryBucket =
    Math.round(Number(entry) / bucketSize);
}

function buildSmartLevels({
  direction,
  entry,
  atr5,
  candles5
}) {
  const baseRisk =
    Math.max(
      (Number(atr5) || 2) * CONFIG.slAtrMultiplier,
      CONFIG.minRiskUsd
    );

  let risk = baseRisk;

  const swing = recentSwing(
    candles5,
    direction,
    12
  );

  const safetyMargin =
    Math.max(
      (Number(atr5) || 2) * 0.15,
      0.5
    );

  if (Number.isFinite(swing)) {
    const swingRisk =
      direction === 'BUY'
        ? entry - swing + safetyMargin
        : swing - entry + safetyMargin;

    if (swingRisk > 0) {
      risk = Math.max(risk, swingRisk);
    }
  }

  const maxRisk =
    Math.max(
      (Number(atr5) || 2) * CONFIG.maxRiskAtr,
      CONFIG.maxRiskUsd
    );

  risk = Math.min(risk, maxRisk);

  const stopLoss =
    direction === 'BUY'
      ? entry - risk
      : entry + risk;

  const tp1 =
    direction === 'BUY'
      ? entry + risk * CONFIG.tp1R
      : entry - risk * CONFIG.tp1R;

  const tp2 =
    direction === 'BUY'
      ? entry + risk * CONFIG.tp2R
      : entry - risk * CONFIG.tp2R;

  return {
    risk,
    stopLoss,
    tp1,
    tp2,
    rrTp1: CONFIG.tp1R,
    rrTp2: CONFIG.tp2R
  };
}

async function scanGoldRegime() {
  const pair = CONFIG.pair;

  const [
    analysis15,
    candles5,
    candles15,
    candles1h,
    liveMarketPrice
  ] = await Promise.all([
    analyzePair(pair),
    getCandles(pair, '5min'),

    // Dedicated 15M candles let the Gold Scalper
    // calculate trend using CLOSED candles only.
    getCandles(pair, '15min')
      .catch(error => {
        console.log(
          '⚠️ Gold Scalper 15M candle fallback:',
          error.message
        );
        return null;
      }),

    getCandles(pair, '1h')
      .catch(error => {
        console.log(
          '⚠️ Gold Scalper 1H candle fallback:',
          error.message
        );
        return null;
      }),

    // Entry must track the actual spot price, not only the latest candle close.
    // Candle close remains a safe fallback if all live-price providers fail.
    getPrice(pair)
      .catch(error => {
        console.log(
          '⚠️ Gold Scalper live price fallback:',
          error.message
        );
        return null;
      })
  ]);

  if (
    !analysis15 ||
    !Array.isArray(candles5) ||
    candles5.length < 25
  ) {
    return {
      ready: false,
      status: 'NO_DATA',
      pair
    };
  }

  // Last bar can still be forming.
  // Indicators use CLOSED candles only.
  const closedCandles5 =
    candles5.length > 1
      ? candles5.slice(0, -1)
      : candles5;

  const closes = closedCandles5
    .map(c => finite(c.close))
    .filter(v => v != null);

  if (closes.length < 25) {
    return {
      ready: false,
      status: 'NO_5M_DATA',
      pair
    };
  }

  // Entry remains close to the current market:
  // use the latest raw candle close.
  const liveClose =
    finite(
      candles5[
        candles5.length - 1
      ]?.close
    );

  const spotPrice = finite(liveMarketPrice);

  const entry =
    spotPrice != null
      ? spotPrice
      : liveClose != null
        ? liveClose
        : closes[closes.length - 1];

  if (
    spotPrice != null &&
    liveClose != null
  ) {
    const gap = Math.abs(spotPrice - liveClose);
    const gapPct = liveClose > 0
      ? (gap / liveClose) * 100
      : 0;

    // Diagnostic only: do not silently trade from a stale candle close.
    if (gapPct >= 0.10) {
      console.log(
        `⚠️ GOLD PRICE/CANDLE GAP: spot=${spotPrice} candle=${liveClose} gap=${gap.toFixed(2)} (${gapPct.toFixed(3)}%)`
      );
    }
  }

  const ema9 =
    ema(closes.slice(-35), 9);

  const ema20 =
    ema(closes.slice(-40), 20);

  const rsi5 =
    rsi(closes, 14);

  const atr5 =
    atr(closedCandles5, 14);

  const adx5 =
    adx(closedCandles5, 14);

  const vwap5 =
    vwap(closedCandles5, 24);

  // TEMP VWAP DATA DIAGNOSTIC
  if (vwap5 == null) {
    const sample =
      closedCandles5.slice(-24);

    const usableVolumes =
      sample
        .map(c => Number(c?.volume))
        .filter(v =>
          Number.isFinite(v) &&
          v > 0
        );

    console.log(
      '🧪 VWAP DEBUG XAUUSD:',
      {
        candles: closedCandles5.length,
        sample: sample.length,
        usableVolumes: usableVolumes.length,
        firstVolume:
          sample[0]?.volume,
        lastVolume:
          sample[sample.length - 1]?.volume,
        lastCandle:
          sample[sample.length - 1]
      }
    );
  }

  const momentum =
    recentMomentum(closes);

  // =====================================================
  // REGIME FILTER — CLOSED candles only
  // H1 EMA20/EMA50 and 15M EMA20/EMA50 must agree.
  // ADX15 confirms that the regime is actually trending.
  // =====================================================
  let trend15 = 'WAIT';
  let trend1h = 'WAIT';
  let ema20_15 = null;
  let ema50_15 = null;
  let ema20_1h = null;
  let ema50_1h = null;
  let adx15 = null;

  if (Array.isArray(candles15) && candles15.length >= 52) {
    const closed15 = candles15.slice(0, -1);
    const closes15 = closed15
      .map(c => finite(c.close))
      .filter(v => v != null);

    ema20_15 = ema(closes15.slice(-70), 20);
    ema50_15 = ema(closes15.slice(-90), 50);
    adx15 = adx(closed15, 14);

    if (ema20_15 != null && ema50_15 != null) {
      if (ema20_15 > ema50_15) trend15 = 'BUY';
      else if (ema20_15 < ema50_15) trend15 = 'SELL';
    }
  }

  if (Array.isArray(candles1h) && candles1h.length >= 52) {
    const closed1h = candles1h.slice(0, -1);
    const closes1h = closed1h
      .map(c => finite(c.close))
      .filter(v => v != null);

    ema20_1h = ema(closes1h.slice(-70), 20);
    ema50_1h = ema(closes1h.slice(-90), 50);

    if (ema20_1h != null && ema50_1h != null) {
      if (ema20_1h > ema50_1h) trend1h = 'BUY';
      else if (ema20_1h < ema50_1h) trend1h = 'SELL';
    }
  }

  // If 15M candle data is temporarily unavailable, retain the old analysis
  // only for diagnostics; it may NOT bypass the H1+15M regime gate.
  const analysisTrend15 = get15mTrend(analysis15);

  const range =
    previousRange(
      closedCandles5,
      6
    );

  if (
    entry == null ||
    ema9 == null ||
    ema20 == null ||
    atr5 == null ||
    atr5 <= 0
  ) {
    return {
      ready: false,
      status: 'INDICATORS_NOT_READY',
      pair,
      trend15,
      rsi5,
      atr5
    };
  }

  // =====================================================
  // GOLD REGIME PULLBACK — H1/15M regime -> 5M pullback -> trigger
  // =====================================================
  if (trend15 === 'WAIT' || trend1h === 'WAIT') {
    return {
      ready: false,
      status: 'REGIME_NOT_READY',
      pair,
      trend15,
      trend1h,
      analysisTrend15,
      ema20_15,
      ema50_15,
      ema20_1h,
      ema50_1h,
      adx15
    };
  }

  if (trend15 !== trend1h) {
    return {
      ready: false,
      status: 'REGIME_H1_15M_CONFLICT',
      pair,
      trend15,
      trend1h,
      ema20_15,
      ema50_15,
      ema20_1h,
      ema50_1h,
      adx15
    };
  }

  // 22-25 was the intended band; 23 is the balanced mandatory threshold.
  if (adx15 == null || adx15 < 23) {
    return {
      ready: false,
      status: 'REGIME_ADX15_TOO_WEAK',
      pair,
      trend15,
      trend1h,
      adx15,
      ema20_15,
      ema50_15,
      ema20_1h,
      ema50_1h
    };
  }

  const direction = trend15;
  const emaAligned = direction === 'BUY'
    ? ema9 > ema20
    : ema9 < ema20;

  // 5M structure should support the higher-timeframe trend, but ADX5 is no
  // longer a hard gate. The actual strength gate is ADX15.
  if (!emaAligned) {
    return {
      ready: false,
      status: 'PULLBACK_5M_EMA_NOT_ALIGNED',
      pair,
      direction,
      trend15,
      trend1h,
      adx15,
      adx5,
      ema9,
      ema20,
      momentum
    };
  }

  if (vwap5 == null) {
    return {
      ready: false,
      status: 'PULLBACK_VWAP_NOT_READY',
      pair,
      direction,
      trend15,
      trend1h,
      adx15,
      atr5
    };
  }

  const vwapAligned = direction === 'BUY'
    ? entry >= vwap5 - atr5 * 0.08
    : entry <= vwap5 + atr5 * 0.08;

  if (!vwapAligned) {
    return {
      ready: false,
      status: 'PULLBACK_VWAP_OPPOSES',
      pair,
      direction,
      entry,
      vwap5,
      atr5,
      trend15,
      trend1h,
      adx15
    };
  }

  const ema20DistanceAtr = Math.abs(entry - ema20) / atr5;
  const vwapDistanceAtr = Math.abs(entry - vwap5) / atr5;
  const anchorDistanceAtr = Math.min(ema20DistanceAtr, vwapDistanceAtr);
  const maxAnchorDistanceAtr = 0.55;

  // Price must still be near fair-value / pullback anchors; no chasing.
  if (anchorDistanceAtr > maxAnchorDistanceAtr) {
    return {
      ready: false,
      status: 'PULLBACK_TOO_FAR_FROM_ANCHOR',
      pair,
      direction,
      entry,
      ema20,
      vwap5,
      ema20DistanceAtr,
      vwapDistanceAtr,
      anchorDistanceAtr,
      maxAnchorDistanceAtr,
      atr5,
      trend15,
      trend1h,
      adx15
    };
  }

  // Require a genuine pullback near EMA20 OR VWAP during the last 3 closed 5M bars.
  const recent3 = closedCandles5.slice(-3);
  const anchorTolerance = atr5 * 0.20;

  const touchedEma20 = recent3.some(c => {
    const lo = finite(c.low);
    const hi = finite(c.high);
    return lo != null && hi != null &&
      hi >= ema20 - anchorTolerance &&
      lo <= ema20 + anchorTolerance;
  });

  const touchedVwap = recent3.some(c => {
    const lo = finite(c.low);
    const hi = finite(c.high);
    return lo != null && hi != null &&
      hi >= vwap5 - anchorTolerance &&
      lo <= vwap5 + anchorTolerance;
  });

  if (!touchedEma20 && !touchedVwap) {
    return {
      ready: false,
      status: 'PULLBACK_WAIT_TOUCH',
      pair,
      direction,
      trend15,
      trend1h,
      adx15,
      entry,
      ema20,
      vwap5,
      anchorDistanceAtr
    };
  }

  const lastClosed = closedCandles5[closedCandles5.length - 1] || {};
  const o = finite(lastClosed.open);
  const h = finite(lastClosed.high);
  const l = finite(lastClosed.low);
  const c = finite(lastClosed.close);

  if (o == null || h == null || l == null || c == null) {
    return {
      ready: false,
      status: 'PULLBACK_CONFIRM_CANDLE_MISSING',
      pair,
      direction
    };
  }

  const candleRange = Math.max(h - l, 0.00001);
  const candleBody = Math.abs(c - o);
  const bodyRatio = candleBody / candleRange;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const candleRangeAtr = candleRange / atr5;
  const candleBodyAtr = candleBody / atr5;

  // Avoid entering after an impulse candle. We want the pullback confirmation,
  // not the end of a one-candle expansion.
  if (candleRangeAtr > 1.20 || candleBodyAtr > 0.80) {
    return {
      ready: false,
      status: 'PULLBACK_IMPULSE_CANDLE_AVOID',
      pair,
      direction,
      candleRangeAtr,
      candleBodyAtr,
      atr5
    };
  }

  const directionalClose = direction === 'BUY' ? c > o : c < o;
  const closeBackWithTrend = direction === 'BUY'
    ? (c >= ema20 || c >= vwap5)
    : (c <= ema20 || c <= vwap5);

  const rejection = direction === 'BUY'
    ? lowerWick >= upperWick * 1.15 && lowerWick >= candleBody * 0.35
    : upperWick >= lowerWick * 1.15 && upperWick >= candleBody * 0.35;

  const continuation = directionalClose && bodyRatio >= 0.30;
  const candleConfirmed = directionalClose && closeBackWithTrend &&
    (rejection || continuation);

  if (!candleConfirmed) {
    return {
      ready: false,
      status: 'PULLBACK_WAIT_REJECTION',
      pair,
      direction,
      trend15,
      trend1h,
      adx15,
      candle: { o, h, l, c, bodyRatio, upperWick, lowerWick },
      rejection,
      continuation
    };
  }

  // Momentum must have returned with the higher-timeframe direction.
  if (momentum.direction !== direction || momentum.strength < 2) {
    return {
      ready: false,
      status: 'PULLBACK_MOMENTUM_NOT_RETURNED',
      pair,
      direction,
      trend15,
      trend1h,
      adx15,
      momentum
    };
  }

  // RSI is only an exhaustion guard, not the strategy trigger.
  const rsiAllowed = rsi5 != null && (
    direction === 'BUY'
      ? rsi5 >= 44 && rsi5 <= 70
      : rsi5 <= 56 && rsi5 >= 30
  );

  if (!rsiAllowed) {
    return {
      ready: false,
      status: 'PULLBACK_RSI_EXHAUSTED',
      pair,
      direction,
      rsi5,
      trend15,
      trend1h,
      adx15
    };
  }

  const entryMode = 'PULLBACK';

  // Current 5M candle gives a small execution trigger only. It may not be extended.
  const liveCandle = candles5[candles5.length - 1] || null;
  const liveOpen = finite(liveCandle?.open);
  const liveHigh = finite(liveCandle?.high);
  const liveLow = finite(liveCandle?.low);
  const liveBarClose = finite(liveCandle?.close);
  const liveMove = liveOpen != null ? entry - liveOpen : 0;
  const liveMoveAtr = atr5 > 0 ? liveMove / atr5 : 0;

  const liveDirectionOk = direction === 'BUY'
    ? liveMoveAtr >= 0.02 && entry >= ema20
    : liveMoveAtr <= -0.02 && entry <= ema20;

  if (!liveDirectionOk) {
    return {
      ready: false,
      status: direction === 'BUY'
        ? 'PULLBACK_WAIT_LIVE_BUY_TRIGGER'
        : 'PULLBACK_WAIT_LIVE_SELL_TRIGGER',
      pair,
      direction,
      entryMode,
      trend15,
      trend1h,
      adx15,
      entry,
      liveCandle: {
        open: liveOpen,
        high: liveHigh,
        low: liveLow,
        close: liveBarClose,
        move: liveMove,
        moveAtr: liveMoveAtr
      }
    };
  }

  const maxLiveMoveAtr = 0.35;
  if (Math.abs(liveMoveAtr) > maxLiveMoveAtr) {
    return {
      ready: false,
      status: 'PULLBACK_LIVE_MOVE_EXTENDED',
      pair,
      direction,
      entryMode,
      trend15,
      trend1h,
      adx15,
      entry,
      liveMoveAtr,
      maxLiveMoveAtr,
      anchorDistanceAtr
    };
  }

  const aiDirection =
    analysis15.signal?.action === 'BUY' ||
    analysis15.signal?.action === 'SELL'
      ? analysis15.signal.action
      : null;

  const aiConfidence =
    Number.isFinite(Number(analysis15.signal?.confidence))
      ? Number(analysis15.signal.confidence)
      : 0;

  // Only strong AI disagreement blocks a technical setup.
  if (
    aiDirection &&
    aiDirection !== direction &&
    aiConfidence >= CONFIG.minAiStrong
  ) {
    return {
      ready: false,
      status: 'AI_DIRECTION_MISMATCH',
      pair,
      direction,
      aiDirection,
      aiConfidence,
      trend15,
      entryMode
    };
  }

  const distanceFromEma = Math.abs(entry - ema20);
  const distanceFromEmaAtr = distanceFromEma / atr5;
  const maxEmaDistanceAtr = 0.55;

  // Second anti-chase gate around the fast EMA.
  if (distanceFromEmaAtr > maxEmaDistanceAtr) {
    return {
      ready: false,
      status: 'PULLBACK_ANTI_CHASE_EMA20',
      pair,
      direction,
      entryMode,
      trend15,
      entry,
      ema20,
      atr5,
      distanceFromEma,
      distanceFromEmaAtr,
      maxEmaDistanceAtr,
      vwap5,
      vwapDistanceAtr
    };
  }

  const scored = calculateScalpScoreV2({
    direction,
    trend15,
    trend1h,
    emaAligned,
    setupType: entryMode,
    adx15,
    adx5,
    vwapAligned,
    anchorDistanceAtr,
    momentum,
    rsi5,
    candleConfirmed,
    liveTrigger: true,
    liveMoveAtr
  });

  const minRequiredScore = 78;

  if (scored.score < minRequiredScore) {
    return {
      ready: false,
      status: 'V2_SCORE_WATCH',
      pair,
      direction,
      entryMode,
      score: scored.score,
      minRequiredScore,
      aiConfidence,
      trend15,
      rsi5,
      atr5,
      adx5,
      vwap5,
      ema9,
      ema20,
      momentum,
      reasons: scored.reasons
    };
  }

  let grade = 'A';
  if (scored.score >= 92) grade = 'A+';
  else if (scored.score >= 84) grade = 'A';
  else grade = 'TECH-A';

  const cooldown = cooldownAllows(
    direction,
    entry,
    atr5
  );

  if (!cooldown.allowed) {
    return {
      ready: false,
      status: cooldown.reason,
      pair,
      direction,
      entryMode,
      grade,
      score: scored.score,
      aiConfidence,
      trend15,
      atr5
    };
  }

  const levels = buildSmartLevels({
    direction,
    entry,
    atr5,
    candles5
  });

  const zoneHalf =
    Math.max(
      0.35,
      Math.min(atr5 * 0.20, 1.20)
    );

  return {
    ready: true,
    status: 'ENTRY_READY',
    pair,
    direction,
    entryMode,
    grade,
    score: scored.score,
    aiConfidence,
    aiDirection,
    trend15,
    trend1h,
    ema20_15,
    ema50_15,
    ema20_1h,
    ema50_1h,
    adx15,
    rsi5,
    atr5,
    adx5,
    vwap5,
    ema9,
    ema20,
    momentum,

    entry,
    entryFrom: entry - zoneHalf,
    entryTo: entry + zoneHalf,

    stopLoss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    risk: levels.risk,
    rrTp1: levels.rrTp1,
    rrTp2: levels.rrTp2,

    previousHigh: range.high,
    previousLow: range.low,
    distanceFromEma,
    vwapDistanceAtr,
    ema20DistanceAtr,
    anchorDistanceAtr,
    maxAnchorDistanceAtr,
    distanceFromEmaAtr,
    liveMoveAtr,
    maxLiveMoveAtr,
    maxEmaDistanceAtr,
    candleConfirmed,
    touchedEma20,
    touchedVwap,

    reasons: scored.reasons,

    markSent: () =>
      markSent(direction, entry, atr5)
  };
}

async function buildGoldRegimeResult() {
  const scalp = await scanGoldRegime();

  if (!scalp.ready) {
    console.log(
      `🟡 GOLD REGIME WAIT: ${scalp.status}`,
      {
        direction: scalp.direction,
        mode: scalp.entryMode,
        score: scalp.score,
        min: scalp.minRequiredScore,
        ai: scalp.aiConfidence,
        atr: scalp.atr5,
        emaDistance: scalp.distanceFromEmaAtr,
        vwapDistance: scalp.vwapDistanceAtr
      }
    );

    return {
      pair: 'XAUUSD',
      signal: null,
      indicators: {
        atr: scalp.atr5 || null,
        rsi: scalp.rsi5 || null,
        adx: scalp.adx5 || null,
        vwap: scalp.vwap5 || null
      },
      regimeMeta: scalp
    };
  }

  console.log(
    `⚡ GOLD REGIME ${scalp.grade}: ${scalp.direction}`,
    {
      mode: scalp.entryMode,
      score: scalp.score,
      ai: scalp.aiConfidence,
      entry: scalp.entry,
      sl: scalp.stopLoss,
      tp1: scalp.tp1,
      tp2: scalp.tp2,
      risk: scalp.risk
    }
  );

  return {
    pair: 'XAUUSD',

    signal: {
      action: scalp.direction,
      entry: scalp.entry,
      stopLoss: scalp.stopLoss,
      targets: [
        scalp.tp1,
        scalp.tp2
      ],
      // AI confidence and technical Scalp Score are different metrics.
      // Never expose Scalp Score as fake AI confidence.
      confidence:
        Number(scalp.aiConfidence) > 0
          ? Number(scalp.aiConfidence)
          : null,
      reason:
        `Gold Regime ${scalp.grade} | ${scalp.entryMode} | Score ${scalp.score}/100`
    },

    indicators: {
      atr: scalp.atr5,
      rsi: scalp.rsi5,
      ema9: scalp.ema9,
      ema20: scalp.ema20,
      adx: scalp.adx5,
      vwap: scalp.vwap5
    },

    regimeMeta: scalp
  };
}

module.exports = {
  scanGoldRegime,
  buildGoldRegimeResult,
  markGoldRegimeSent: markSent
};
