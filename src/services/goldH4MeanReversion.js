const axios = require('axios');
const config = require('../config');
const { getPrice } = require('./marketService');
const {
  addTrade,
  getOpenTrades,
  updateTradeStatus
} = require('../database/trades');

const SOURCE = 'VIP_H4_MR';
const STATE = {
  lastSentCandle: null,
  h1CacheKey: null,
  h1CacheRows: null
};

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function smaSeries(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

function atrSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i++) {
    let sum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const prevClose = candles[j - 1].close;
      sum += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - prevClose),
        Math.abs(candles[j].low - prevClose)
      );
    }

    out[i] = sum / period;
  }

  return out;
}

async function loadGoldH1(cacheKey) {
  if (
    STATE.h1CacheKey === cacheKey &&
    Array.isArray(STATE.h1CacheRows) &&
    STATE.h1CacheRows.length
  ) {
    return STATE.h1CacheRows;
  }

  const apiKey = process.env.SIFTING_API_KEY || '';
  if (!apiKey) {
    throw new Error('SIFTING_API_KEY not configured for GOLD H4 MR');
  }

  const end = new Date().toISOString();
  const start = new Date(Date.now() - 24 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await axios.get(
    'https://api.sifting.io/v1/hist/commodities/XAUUSD/bars',
    {
      headers: {
        'X-API-Key': apiKey,
        'Accept-Encoding': 'gzip'
      },
      params: {
        start,
        end,
        interval: '1h',
        limit: 2000
      },
      timeout: 10000
    }
  );

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  const normalized = rows
    .map(r => ({
      timestamp: toMs(r.t ?? r.timestamp),
      open: finite(r.o ?? r.open),
      high: finite(r.h ?? r.high),
      low: finite(r.l ?? r.low),
      close: finite(r.c ?? r.close)
    }))
    .filter(r =>
      r.timestamp != null &&
      r.timestamp + HOUR <= now &&
      [r.open, r.high, r.low, r.close].every(Number.isFinite)
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (normalized.length) {
    STATE.h1CacheKey = cacheKey;
    STATE.h1CacheRows = normalized;
  }

  return normalized;
}

function aggregateH4(h1) {
  const H4 = 4 * 60 * 60 * 1000;
  const map = new Map();

  for (const x of h1) {
    const t = Math.floor(x.timestamp / H4) * H4;

    if (!map.has(t)) {
      map.set(t, {
        timestamp: t,
        open: x.open,
        high: x.high,
        low: x.low,
        close: x.close,
        count: 1
      });
    } else {
      const b = map.get(t);
      b.high = Math.max(b.high, x.high);
      b.low = Math.min(b.low, x.low);
      b.close = x.close;
      b.count++;
    }
  }

  return [...map.values()]
    .filter(x => x.count === 4)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function evaluateSetup(h4) {
  if (!Array.isArray(h4) || h4.length < 70) {
    return { ready: false, status: 'NOT_ENOUGH_H4_DATA' };
  }

  const i = h4.length - 1;
  const closes = h4.map(x => x.close);
  const ranges = h4.map(x => x.high - x.low);
  const ma50 = smaSeries(closes, 50);
  const avgRange25 = smaSeries(ranges, 25);
  const atr14 = atrSeries(h4, 14);

  const ma = ma50[i];
  const atr = atr14[i];
  const ar = avgRange25[i];

  if (
    !Number.isFinite(ma) ||
    !Number.isFinite(atr) ||
    !Number.isFinite(ar) ||
    !Number.isFinite(ma50[i - 3])
  ) {
    return { ready: false, status: 'INDICATORS_NOT_READY' };
  }

  let atrSum = 0;
  let atrCount = 0;

  for (let j = Math.max(14, i - 49); j <= i; j++) {
    if (Number.isFinite(atr14[j])) {
      atrSum += atr14[j];
      atrCount++;
    }
  }

  if (atrCount < 40) {
    return { ready: false, status: 'ATR_REGIME_NOT_READY' };
  }

  const atr50 = atrSum / atrCount;
  const atrRatio = atr / atr50;
  const candle = h4[i];
  const range = candle.high - candle.low;

  if (!(range > 0)) {
    return { ready: false, status: 'BAD_H4_RANGE' };
  }

  const ibs = (candle.close - candle.low) / range;
  const hh10 = Math.max(...h4.slice(i - 9, i + 1).map(x => x.high));
  const floor = hh10 - ar * 1.25;

  const checks = {
    floor: candle.close < floor,
    ibs: ibs < 0.25,
    aboveMa: candle.close > ma + atr * 0.50,
    maRising: ma > ma50[i - 3],
    atrRegime: atrRatio <= 1.40
  };

  const ready = Object.values(checks).every(Boolean);

  return {
    ready,
    status: ready ? 'H4_MR_READY' : 'H4_MR_WAIT',
    signalCandle: candle.timestamp,
    close: candle.close,
    atr,
    atr50,
    atrRatio,
    ma50: ma,
    avgRange25: ar,
    hh10,
    floor,
    ibs,
    checks
  };
}

async function scanGoldH4MeanReversion(bot) {
  try {
    const now = Date.now();
    const H4 = 4 * 60 * 60 * 1000;
    const h4Open = Math.floor(now / H4) * H4;
    const entryAge = now - h4Open;

    // Backtest enters at the next H4 open. Do not chase late entries.
    if (entryAge > 20 * 60 * 1000) {
      return { ready: false, status: 'H4_ENTRY_WINDOW_CLOSED' };
    }

    const day = new Date(h4Open).getUTCDay();

    // Monday -> Thursday UTC only.
    if (day < 1 || day > 4) {
      return { ready: false, status: 'H4_DAY_FILTER' };
    }

    // During the 20-minute H4 entry window, the same closed H1 history is
    // sufficient for this setup. Cache it by H4 open to avoid hitting the
    // provider once per minute and interfering with the shared market stack.
    const h1 = await loadGoldH1(h4Open);
    const h4 = aggregateH4(h1);
    const meta = evaluateSetup(h4);

    console.log('🟣 GOLD H4 MR:', {
      status: meta.status,
      h1: h1.length,
      h4: h4.length,
      ibs: Number.isFinite(meta.ibs) ? Number(meta.ibs).toFixed(3) : null,
      atrRatio: Number.isFinite(meta.atrRatio) ? Number(meta.atrRatio).toFixed(2) : null,
      checks: meta.checks || null
    });

    if (!meta.ready) return meta;

    if (STATE.lastSentCandle === meta.signalCandle) {
      return { ...meta, ready: false, status: 'H4_ALREADY_SENT' };
    }

    const existing = getOpenTrades().find(
      t => String(t.telegram_id || '').toUpperCase() === SOURCE
    );

    if (existing) {
      console.log(`🔒 GOLD H4 MR blocked: Trade #${existing.id} still open`);
      return { ...meta, ready: false, status: 'H4_TRADE_ALREADY_OPEN' };
    }

    if (!config.vipChannelId) {
      return { ...meta, ready: false, status: 'VIP_CHANNEL_MISSING' };
    }

    const entry = Number(await getPrice('XAUUSD'));
    if (!Number.isFinite(entry)) {
      throw new Error('Invalid GOLD H4 MR live entry');
    }

    const risk = meta.atr * 2;
    const stopLoss = entry - risk;
    const target = entry + risk * 2;

    const insert = addTrade({
      telegram_id: SOURCE,
      pair: 'XAUUSD',
      action: 'BUY',
      entry,
      stop_loss: stopLoss,

      // Intentionally null: generic monitor cannot activate secure-entry/BE.
      target1: null,
      target2: target
    });

    const tradeId = Number(insert?.lastInsertRowid || 0);
    if (!tradeId) {
      throw new Error('Failed to save GOLD H4 MR trade');
    }

    const message = `🟣 إشارة GOLD H4 — Mean Reversion\n━━━━━━━━━━━━━━━━━━\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n🕓 الفريم: H4\n\n📍 الدخول\n${entry.toFixed(2)}\n\n🛑 وقف الخسارة\n${stopLoss.toFixed(2)}\n\n🎯 الهدف النهائي — 2R\n${target.toFixed(2)}\n\n📏 مسافة وقف الخسارة\n${risk.toFixed(2)} دولار\n\n💰 مسافة الهدف\n${(risk * 2).toFixed(2)} دولار\n\n📊 ATR H4\n${meta.atr.toFixed(2)}\n\n📉 IBS\n${meta.ibs.toFixed(3)}\n\n📐 ATR Ratio\n${meta.atrRatio.toFixed(2)}\n\n🧠 النوع\nH4 Mean Reversion — مسار مستقل\n\n✅ دخول كامل\n✅ هدف كامل 2R\n❌ بدون Break-even\n❌ بدون Partial TP\n\n📅 التداول: الإثنين → الخميس UTC`;

    try {
      await bot.telegram.sendMessage(config.vipChannelId, message);
    } catch (sendError) {
      try {
        updateTradeStatus(tradeId, 'closed');
      } catch {}
      throw sendError;
    }

    STATE.lastSentCandle = meta.signalCandle;

    console.log(
      `🟣 GOLD H4 MR SENT | Trade #${tradeId} | entry=${entry.toFixed(2)} | SL=${stopLoss.toFixed(2)} | TP=${target.toFixed(2)}`
    );

    return {
      ...meta,
      sent: true,
      tradeId,
      entry,
      stopLoss,
      target
    };
  } catch (error) {
    console.log('❌ GOLD H4 MR scan error:', error.message);
    return {
      ready: false,
      status: 'H4_MR_ERROR',
      error: error.message
    };
  }
}

module.exports = { scanGoldH4MeanReversion };
