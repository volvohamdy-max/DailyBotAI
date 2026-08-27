const { analyzePair } = require('./analysisService');
const { getPrice } = require('./marketService');
const { addTrade } = require('../database/trades');
const config = require('../config');

const SOURCE_PREFIX = 'VIP_HOURLY_MARKET_BIAS';
const DISTANCE_USD = 5;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getMarketDirection(analysis) {
  const signalAction = String(analysis?.signal?.action || '').toUpperCase();
  if (signalAction === 'BUY' || signalAction === 'SELL') return signalAction;

  const ema20 = finite(analysis?.indicators?.ema20);
  const ema50 = finite(analysis?.indicators?.ema50);
  if (ema20 == null || ema50 == null) return 'WAIT';
  return ema20 >= ema50 ? 'BUY' : 'SELL';
}

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13).replace(/[-T:]/g, '');
}

async function runHourlyMarketBiasTrade(bot) {
  const analysis = await analyzePair('XAUUSD');
  const direction = getMarketDirection(analysis);

  if (!['BUY', 'SELL'].includes(direction)) {
    console.log('🕐 HOURLY MARKET BIAS | WAIT | no trade');
    return false;
  }

  const entry = finite(await getPrice('XAUUSD'));
  if (entry == null || entry <= 0) {
    throw new Error('Hourly Market Bias cannot determine XAUUSD live price');
  }

  const sl = direction === 'BUY' ? entry - DISTANCE_USD : entry + DISTANCE_USD;
  const tp = direction === 'BUY' ? entry + DISTANCE_USD : entry - DISTANCE_USD;
  const source = `${SOURCE_PREFIX}_${hourKey()}`;

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
    console.log(`❌ HOURLY MARKET BIAS | trade insert rejected | ${direction}`);
    return false;
  }

  const confidence = finite(analysis?.signal?.confidence);
  const message = `🕐 صفقة ميل السوق الساعية\n━━━━━━━━━━━━━━━━━━\n\n🥇 الزوج: #XAUUSD\n📊 ميل السوق: ${direction === 'BUY' ? '📈 BUY' : '📉 SELL'}\n\n💰 الدخول:\n${entry.toFixed(2)}\n\n🛑 وقف الخسارة:\n${sl.toFixed(2)}\n\n🎯 الهدف:\n${tp.toFixed(2)}\n\n📏 SL: $${DISTANCE_USD}\n💵 TP: $${DISTANCE_USD}${confidence == null ? '' : `\n\n🤖 ثقة التحليل: ${confidence.toFixed(0)}%`}\n\n🧪 المصدر: Hourly Market Bias`;

  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) {
    console.log(`❌ HOURLY MARKET BIAS | VIP_CHANNEL_ID missing | Trade #${tradeId} remains open`);
    return false;
  }

  try {
    await bot.telegram.sendMessage(chatId, message);
    console.log(`💎 HOURLY MARKET BIAS SENT | Trade #${tradeId} | ${direction} | entry=${entry.toFixed(2)} | SL=${sl.toFixed(2)} | TP=${tp.toFixed(2)}`);
    return true;
  } catch (error) {
    console.log(`❌ HOURLY MARKET BIAS VIP SEND FAILED | Trade #${tradeId} | ${error.message}`);
    return false;
  }
}

module.exports = {
  runHourlyMarketBiasTrade,
  getMarketDirection
};
