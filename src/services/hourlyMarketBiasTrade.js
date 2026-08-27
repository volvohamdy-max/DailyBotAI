const { analyzePair } = require('./analysisService');
const { getPrice } = require('./marketService');
const { runSignalLab } = require('./signalLab');
const { addTrade, getOpenTrades } = require('../database/trades');
const config = require('../config');

const SOURCE_PREFIX = 'VIP_HOURLY_MARKET_BIAS';
const DISTANCE_USD = 5;
const MIN_SIMILAR_CASES = 10;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Same market-direction idea used by "Check Your Trade": prefer the live
// analysis direction, then use EMA20/EMA50 only when the analysis has no side.
function currentMarketDirection(analysis) {
  const action = String(analysis?.signal?.action || '').toUpperCase();
  if (action === 'BUY' || action === 'SELL') return action;

  const ema20 = finite(analysis?.indicators?.ema20);
  const ema50 = finite(analysis?.indicators?.ema50);
  if (ema20 == null || ema50 == null || ema20 === ema50) return 'WAIT';
  return ema20 > ema50 ? 'BUY' : 'SELL';
}

function hasOpenBiasTrade() {
  return getOpenTrades().some(trade =>
    String(trade.telegram_id || '').toUpperCase().startsWith(SOURCE_PREFIX)
  );
}

function opportunityKey(date = new Date()) {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function runHourlyMarketBiasTrade(bot) {
  // One automatic Signal Lab trade at a time. Other bot strategies are untouched.
  if (hasOpenBiasTrade()) {
    console.log('🧪 AUTO SIGNAL LAB | existing trade still open | scan skipped');
    return false;
  }

  const analysis = await analyzePair('XAUUSD');
  if (!analysis?.indicators) {
    console.log('🧪 AUTO SIGNAL LAB | WAIT | no live indicators');
    return false;
  }

  const direction = currentMarketDirection(analysis);
  if (!['BUY', 'SELL'].includes(direction)) {
    console.log('🧪 AUTO SIGNAL LAB | WAIT | neutral market');
    return false;
  }

  // This is the same historical Signal Lab engine already used by the bot.
  // It reads the local XAUUSD history store and compares the current indicator
  // state with historical setups. No London/ADX35/RSI58 research filter here.
  const lab = await runSignalLab('XAUUSD', analysis.indicators, direction, {
    timeframe: '5min'
  });

  if (!lab?.approved || Number(lab.similarSetups || 0) < MIN_SIMILAR_CASES) {
    console.log(
      `🧪 AUTO SIGNAL LAB | WAIT | ${direction} | similar=${lab?.similarSetups || 0} | ` +
      `score=${lab?.historicalScore || 0} | TP1=${lab?.tp1Rate || 0}% | SL=${lab?.slRate || 0}% | ` +
      `${lab?.reason || 'historical validation failed'}`
    );
    return false;
  }

  const entry = finite(await getPrice('XAUUSD'));
  if (entry == null || entry <= 0) {
    throw new Error('Auto Signal Lab cannot determine XAUUSD live price');
  }

  const sl = direction === 'BUY' ? entry - DISTANCE_USD : entry + DISTANCE_USD;
  const tp = direction === 'BUY' ? entry + DISTANCE_USD : entry - DISTANCE_USD;
  const source = `${SOURCE_PREFIX}_SIGNALLAB_${opportunityKey()}`;

  const inserted = addTrade({
    telegram_id: source,
    pair: 'XAUUSD',
    action: direction,
    entry,
    stop_loss: sl,
    target1: tp,
    target2: tp
  });

  const tradeId = Number(inserted?.lastInsertRowid || 0);
  if (tradeId <= 0) {
    console.log(`❌ AUTO SIGNAL LAB | trade insert rejected | ${direction}`);
    return false;
  }

  const message = [
    '🧪 صفقة Signal Lab تلقائية',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '🥇 الزوج: #XAUUSD',
    `📊 الاتجاه: ${direction === 'BUY' ? '📈 BUY' : '📉 SELL'}`,
    '',
    `📚 حالات تاريخية مشابهة: ${lab.similarSetups}`,
    `⭐ Historical Score: ${lab.historicalScore}/100`,
    `🎯 TP1 تاريخيًا: ${lab.tp1Rate}%`,
    `🏆 TP2 تاريخيًا: ${lab.tp2Rate}%`,
    `🛑 SL تاريخيًا: ${lab.slRate}%`,
    `🧭 توافق الاتجاه تاريخيًا: ${lab.directionMatchRate}%`,
    '',
    `💰 الدخول: ${entry.toFixed(2)}`,
    `🛑 وقف الخسارة: ${sl.toFixed(2)}`,
    `🎯 الهدف: ${tp.toFixed(2)}`,
    '',
    `📏 SL: $${DISTANCE_USD}`,
    `💵 TP: $${DISTANCE_USD}`,
    '',
    '🧪 المصدر: Auto Signal Lab — Gold History'
  ].join('\n');

  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) {
    console.log(`❌ AUTO SIGNAL LAB | VIP_CHANNEL_ID missing | Trade #${tradeId} remains open`);
    return false;
  }

  try {
    await bot.telegram.sendMessage(chatId, message);
    console.log(
      `💎 AUTO SIGNAL LAB SENT | Trade #${tradeId} | ${direction} | ` +
      `similar=${lab.similarSetups} | score=${lab.historicalScore} | TP1=${lab.tp1Rate}% | SL=${lab.slRate}% | ` +
      `entry=${entry.toFixed(2)} | SL=${sl.toFixed(2)} | TP=${tp.toFixed(2)}`
    );
    return true;
  } catch (error) {
    console.log(`❌ AUTO SIGNAL LAB VIP SEND FAILED | Trade #${tradeId} | ${error.message}`);
    return false;
  }
}

// Kept for compatibility with any existing imports/tests.
function getMarketDirection(analysis) {
  return currentMarketDirection(analysis);
}

module.exports = {
  runHourlyMarketBiasTrade,
  getMarketDirection,
  currentMarketDirection
};
