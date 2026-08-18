const { getCandles } = require('./marketService');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function candleTime(c) {
  const raw =
    c.datetime ??
    c.date ??
    c.time ??
    c.timestamp ??
    c.open_time ??
    c.openTime;

  if (raw == null) return null;

  if (typeof raw === 'number') {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trueRange(current, previous) {
  const high = num(current.high);
  const low = num(current.low);
  const prevClose = num(previous.close);

  if (
    high == null ||
    low == null ||
    prevClose == null
  ) {
    return null;
  }

  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose)
  );
}


function calculateATR(candles, period = 14) {
  if (
    !Array.isArray(candles) ||
    candles.length < period + 1
  ) {
    return null;
  }

  const rows = candles.slice(-(period + 1));
  const ranges = [];

  for (let i = 1; i < rows.length; i++) {
    const tr = trueRange(
      rows[i],
      rows[i - 1]
    );

    if (Number.isFinite(tr)) {
      ranges.push(tr);
    }
  }

  if (!ranges.length) return null;

  return ranges.reduce(
    (sum, value) => sum + value,
    0
  ) / ranges.length;
}

// ======================================
// ADX + DI
// ======================================

function calculateADX(candles, period = 14) {
  if (
    !Array.isArray(candles) ||
    candles.length < period * 2 + 2
  ) {
    return null;
  }

  const rows = candles.slice(-(period * 3 + 5));

  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < rows.length; i++) {
    const high = num(rows[i].high);
    const low = num(rows[i].low);
    const prevHigh = num(rows[i - 1].high);
    const prevLow = num(rows[i - 1].low);

    if (
      high == null ||
      low == null ||
      prevHigh == null ||
      prevLow == null
    ) {
      continue;
    }

    const range = trueRange(
      rows[i],
      rows[i - 1]
    );

    if (range == null) continue;

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    tr.push(range);

    plusDM.push(
      upMove > downMove && upMove > 0
        ? upMove
        : 0
    );

    minusDM.push(
      downMove > upMove && downMove > 0
        ? downMove
        : 0
    );
  }

  if (tr.length < period * 2) {
    return null;
  }

  const dx = [];

  for (
    let i = period - 1;
    i < tr.length;
    i++
  ) {
    const trSum = tr
      .slice(i - period + 1, i + 1)
      .reduce((a, b) => a + b, 0);

    const plusSum = plusDM
      .slice(i - period + 1, i + 1)
      .reduce((a, b) => a + b, 0);

    const minusSum = minusDM
      .slice(i - period + 1, i + 1)
      .reduce((a, b) => a + b, 0);

    if (trSum <= 0) continue;

    const plusDI =
      (plusSum / trSum) * 100;

    const minusDI =
      (minusSum / trSum) * 100;

    const total = plusDI + minusDI;

    const currentDX =
      total > 0
        ? (
            Math.abs(plusDI - minusDI) /
            total
          ) * 100
        : 0;

    dx.push({
      plusDI,
      minusDI,
      dx: currentDX
    });
  }

  if (!dx.length) return null;

  const tail = dx.slice(-period);

  const adx =
    tail.reduce(
      (sum, item) => sum + item.dx,
      0
    ) / tail.length;

  const latest = dx[dx.length - 1];

  let strength = 'WEAK';

  if (adx >= 40) strength = 'VERY_STRONG';
  else if (adx >= 25) strength = 'STRONG';
  else if (adx >= 20) strength = 'DEVELOPING';

  let direction = 'NEUTRAL';

  if (latest.plusDI > latest.minusDI) {
    direction = 'BUY';
  } else if (
    latest.minusDI > latest.plusDI
  ) {
    direction = 'SELL';
  }

  return {
    adx,
    plusDI: latest.plusDI,
    minusDI: latest.minusDI,
    strength,
    direction
  };
}

// ======================================
// VWAP
// ======================================

function calculateVWAP(candles) {
  if (!Array.isArray(candles)) {
    return null;
  }

  let pv = 0;
  let volumeSum = 0;

  for (const c of candles) {
    const high = num(c.high);
    const low = num(c.low);
    const close = num(c.close);

    const volume =
      num(
        c.volume ??
        c.tick_volume ??
        c.tickVolume ??
        c.vol
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

    const typical =
      (high + low + close) / 3;

    pv += typical * volume;
    volumeSum += volume;
  }

  if (volumeSum <= 0) {
    return null;
  }

  return pv / volumeSum;
}

// ======================================
// MARKET STRUCTURE
// ======================================

function swingPoints(candles, lookback = 2) {
  const highs = [];
  const lows = [];

  for (
    let i = lookback;
    i < candles.length - lookback;
    i++
  ) {
    const h = num(candles[i].high);
    const l = num(candles[i].low);

    if (h == null || l == null) continue;

    let isHigh = true;
    let isLow = true;

    for (
      let j = i - lookback;
      j <= i + lookback;
      j++
    ) {
      if (j === i) continue;

      const otherH = num(candles[j].high);
      const otherL = num(candles[j].low);

      if (
        otherH != null &&
        otherH >= h
      ) {
        isHigh = false;
      }

      if (
        otherL != null &&
        otherL <= l
      ) {
        isLow = false;
      }
    }

    if (isHigh) {
      highs.push({
        index: i,
        value: h
      });
    }

    if (isLow) {
      lows.push({
        index: i,
        value: l
      });
    }
  }

  return { highs, lows };
}

function marketStructure(candles) {
  const { highs, lows } =
    swingPoints(candles.slice(-80));

  const h = highs.slice(-2);
  const l = lows.slice(-2);

  let structure = 'RANGE';

  if (
    h.length >= 2 &&
    l.length >= 2
  ) {
    const higherHigh =
      h[1].value > h[0].value;

    const higherLow =
      l[1].value > l[0].value;

    const lowerHigh =
      h[1].value < h[0].value;

    const lowerLow =
      l[1].value < l[0].value;

    if (
      higherHigh &&
      higherLow
    ) {
      structure = 'BULLISH';
    } else if (
      lowerHigh &&
      lowerLow
    ) {
      structure = 'BEARISH';
    } else {
      structure = 'MIXED';
    }
  }

  return {
    structure,
    lastSwingHigh:
      highs.length
        ? highs[highs.length - 1].value
        : null,

    previousSwingHigh:
      highs.length > 1
        ? highs[highs.length - 2].value
        : null,

    lastSwingLow:
      lows.length
        ? lows[lows.length - 1].value
        : null,

    previousSwingLow:
      lows.length > 1
        ? lows[lows.length - 2].value
        : null
  };
}

// ======================================
// BOS
// ======================================

function detectBOS(candles, structure, atrValue) {
  if (
    !Array.isArray(candles) ||
    candles.length < 3
  ) {
    return {
      bos: 'NONE',
      choch: 'NONE',
      breakDistance: 0,
      threshold: null
    };
  }

  const close =
    num(
      candles[candles.length - 1].close
    );

  if (close == null) {
    return {
      bos: 'NONE',
      choch: 'NONE',
      breakDistance: 0,
      threshold: null
    };
  }

  const threshold =
    Number.isFinite(atrValue) && atrValue > 0
      ? atrValue * 0.15
      : 0;

  let bos = 'NONE';
  let choch = 'NONE';
  let breakDistance = 0;

  if (
    structure.lastSwingHigh != null &&
    close > structure.lastSwingHigh
  ) {
    breakDistance =
      close - structure.lastSwingHigh;

    if (breakDistance >= threshold) {
      if (
        structure.structure === 'BEARISH'
      ) {
        choch = 'BUY';
      } else {
        bos = 'BUY';
      }
    }
  }

  if (
    structure.lastSwingLow != null &&
    close < structure.lastSwingLow
  ) {
    breakDistance =
      structure.lastSwingLow - close;

    if (breakDistance >= threshold) {
      if (
        structure.structure === 'BULLISH'
      ) {
        choch = 'SELL';
      } else {
        bos = 'SELL';
      }
    }
  }

  return {
    bos,
    choch,
    breakDistance,
    threshold
  };
}

// ======================================
// PREVIOUS DAY HIGH / LOW
// ======================================

function previousDayLevels(candles) {
  const now = new Date();

  const cairoDate = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  );

  const today =
    cairoDate.format(now);

  const grouped = {};

  for (const c of candles) {
    const d = candleTime(c);

    if (!d) continue;

    const key =
      cairoDate.format(d);

    if (!grouped[key]) {
      grouped[key] = {
        high: -Infinity,
        low: Infinity
      };
    }

    const high = num(c.high);
    const low = num(c.low);

    if (high != null) {
      grouped[key].high =
        Math.max(
          grouped[key].high,
          high
        );
    }

    if (low != null) {
      grouped[key].low =
        Math.min(
          grouped[key].low,
          low
        );
    }
  }

  const days = Object.keys(grouped)
    .filter(d => d < today)
    .sort();

  if (!days.length) {
    return {
      previousDayHigh: null,
      previousDayLow: null
    };
  }

  const prev =
    grouped[
      days[days.length - 1]
    ];

  return {
    previousDayHigh:
      Number.isFinite(prev.high)
        ? prev.high
        : null,

    previousDayLow:
      Number.isFinite(prev.low)
        ? prev.low
        : null
  };
}

// ======================================
// SESSION LEVELS
// Cairo local time approximation
// ======================================

function sessionLevels(candles) {
  const sessions = {
    ASIA: {
      start: 2,
      end: 9
    },
    LONDON: {
      start: 9,
      end: 16
    },
    NEW_YORK: {
      start: 15,
      end: 23
    }
  };

  const result = {};

  for (
    const [name, session]
    of Object.entries(sessions)
  ) {
    let high = -Infinity;
    let low = Infinity;
    let found = false;

    for (const c of candles) {
      const d = candleTime(c);

      if (!d) continue;

      const hour = Number(
        new Intl.DateTimeFormat(
          'en-US',
          {
            timeZone: 'Africa/Cairo',
            hour: '2-digit',
            hourCycle: 'h23'
          }
        ).format(d)
      );

      if (
        hour < session.start ||
        hour >= session.end
      ) {
        continue;
      }

      const h = num(c.high);
      const l = num(c.low);

      if (
        h == null ||
        l == null
      ) {
        continue;
      }

      high = Math.max(high, h);
      low = Math.min(low, l);
      found = true;
    }

    result[name] = {
      high:
        found
          ? high
          : null,

      low:
        found
          ? low
          : null
    };
  }

  return result;
}

// ======================================
// LIQUIDITY SWEEP
// ======================================

function detectLiquiditySweep(
  candles,
  structure
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 2
  ) {
    return {
      buySideSweep: false,
      sellSideSweep: false
    };
  }

  const last =
    candles[candles.length - 1];

  const high = num(last.high);
  const low = num(last.low);
  const close = num(last.close);

  let buySideSweep = false;
  let sellSideSweep = false;

  if (
    structure.lastSwingHigh != null &&
    high != null &&
    close != null &&
    high >
      structure.lastSwingHigh &&
    close <
      structure.lastSwingHigh
  ) {
    buySideSweep = true;
  }

  if (
    structure.lastSwingLow != null &&
    low != null &&
    close != null &&
    low <
      structure.lastSwingLow &&
    close >
      structure.lastSwingLow
  ) {
    sellSideSweep = true;
  }

  return {
    buySideSweep,
    sellSideSweep
  };
}

// ======================================
// MAIN ENGINE
// ======================================

async function analyzeGoldIntelligence() {
  const [
    candles5,
    candles15
  ] = await Promise.all([
    getCandles('XAUUSD', '5min'),
    getCandles('XAUUSD', '15min')
  ]);

  if (
    !Array.isArray(candles5) ||
    !candles5.length
  ) {
    throw new Error(
      'No XAUUSD 5M candles'
    );
  }

  const currentPrice =
    num(
      candles5[
        candles5.length - 1
      ].close
    );

  const atr5 =
    calculateATR(candles5, 14);

  const adx =
    calculateADX(candles5);

  const structure =
    marketStructure(candles5);

  const breakState =
    detectBOS(
      candles5,
      structure,
      atr5
    );

  const liquidity =
    detectLiquiditySweep(
      candles5,
      structure
    );

  let rawScore = 0;
  const reasons = [];

  // ======================================
  // MARKET STRUCTURE
  // ======================================

  if (
    structure.structure ===
    'BULLISH'
  ) {
    rawScore += 25;
    reasons.push(
      'Bullish market structure'
    );
  }

  if (
    structure.structure ===
    'BEARISH'
  ) {
    rawScore -= 25;
    reasons.push(
      'Bearish market structure'
    );
  }

  // ======================================
  // ADX + DI
  // ======================================

  if (
    adx?.direction === 'BUY'
  ) {
    if (adx.adx >= 40) {
      rawScore += 30;
      reasons.push(
        'Very strong ADX BUY trend'
      );
    } else if (adx.adx >= 25) {
      rawScore += 25;
      reasons.push(
        'Strong ADX BUY trend'
      );
    } else if (adx.adx >= 20) {
      rawScore += 15;
      reasons.push(
        'Developing ADX BUY trend'
      );
    }
  }

  if (
    adx?.direction === 'SELL'
  ) {
    if (adx.adx >= 40) {
      rawScore -= 30;
      reasons.push(
        'Very strong ADX SELL trend'
      );
    } else if (adx.adx >= 25) {
      rawScore -= 25;
      reasons.push(
        'Strong ADX SELL trend'
      );
    } else if (adx.adx >= 20) {
      rawScore -= 15;
      reasons.push(
        'Developing ADX SELL trend'
      );
    }
  }

  // ======================================
  // CONFIRMED BOS
  // ======================================

  if (breakState.bos === 'BUY') {
    rawScore += 25;
    reasons.push(
      'Confirmed bullish BOS'
    );
  }

  if (breakState.bos === 'SELL') {
    rawScore -= 25;
    reasons.push(
      'Confirmed bearish BOS'
    );
  }

  // ======================================
  // CHoCH
  // ======================================

  if (breakState.choch === 'BUY') {
    rawScore += 20;
    reasons.push(
      'Bullish CHoCH detected'
    );
  }

  if (breakState.choch === 'SELL') {
    rawScore -= 20;
    reasons.push(
      'Bearish CHoCH detected'
    );
  }

  // ======================================
  // LIQUIDITY SWEEP
  // ======================================

  if (
    liquidity.sellSideSweep
  ) {
    rawScore += 15;
    reasons.push(
      'Sell-side liquidity sweep'
    );
  }

  if (
    liquidity.buySideSweep
  ) {
    rawScore -= 15;
    reasons.push(
      'Buy-side liquidity sweep'
    );
  }

  // ======================================
  // FINAL BIAS + CONFIDENCE
  // ======================================

  let bias = 'NEUTRAL';

  if (rawScore >= 25) {
    bias = 'BUY';
  } else if (rawScore <= -25) {
    bias = 'SELL';
  }

  const confidence =
    Math.min(
      100,
      Math.abs(rawScore)
    );

  return {
    pair: 'XAUUSD',
    price: currentPrice,

    atr5,

    adx,

    structure,

    bos:
      breakState.bos,

    choch:
      breakState.choch,

    breakDistance:
      breakState.breakDistance,

    bosThreshold:
      breakState.threshold,

    liquidity,

    bias,

    rawScore,

    confidence,

    reasons,

    dataCapabilities: {
      volumeAvailable: false,
      timestampsAvailable: false,
      vwapEnabled: false,
      previousDayLevelsEnabled: false,
      sessionLevelsEnabled: false
    }
  };
}

module.exports = {
  calculateATR,
  calculateADX,
  calculateVWAP,
  marketStructure,
  detectBOS,
  previousDayLevels,
  sessionLevels,
  detectLiquiditySweep,
  analyzeGoldIntelligence
};
