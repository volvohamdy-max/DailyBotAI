const { analyzePair } = require('./analysisService');
const { getCandles } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');
const { addTrade, getOpenTrades } = require('../database/trades');
const config = require('../config');

const SOURCE_PREFIX = 'VIP_HOURLY_MARKET_BIAS';
const MIN_SCORE = 70;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Same scoring engine used by "Check Your Trade".
function directionalMarketScore(analysis, selectedDirection) {
  const indicators = analysis?.indicators || {};
  const ema20 = Number(indicators.ema20);
  const ema50 = Number(indicators.ema50);
  const rsi = Number(indicators.rsi);
  const adx = Number(indicators.adx);
  const macd = Number(indicators.macd?.macd);
  const macdSignal = Number(indicators.macd?.signal);

  const marketDirection =
    analysis?.signal?.action === 'BUY' || analysis?.signal?.action === 'SELL'
      ? analysis.signal.action
      : Number.isFinite(ema20) && Number.isFinite(ema50)
        ? (ema20 >= ema50 ? 'BUY' : 'SELL')
        : 'WAIT';

  let score = 0;
  if (selectedDirection === marketDirection) score += 35;

  if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
    if (selectedDirection === 'BUY' && ema20 > ema50) score += 20;
    if (selectedDirection === 'SELL' && ema20 < ema50) score += 20;
  }

  if (Number.isFinite(rsi)) {
    if (selectedDirection === 'BUY' && rsi >= 50 && rsi <= 70) score += 15;
    if (selectedDirection === 'SELL' && rsi <= 50 && rsi >= 30) score += 15;
  }

  if (Number.isFinite(macd) && Number.isFinite(macdSignal)) {
    if (selectedDirection === 'BUY' && macd > macdSignal) score += 15;
    if (selectedDirection === 'SELL' && macd < macdSignal) score += 15;
  }

  if (Number.isFinite(adx) && adx >= 25) score += 15;

  return {
    score: Math.max(0, Math.min(100, score)),
    marketDirection
  };
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
  if (hasOpenBiasTrade()) {
    console.log('🥇 AUTO TRADE CHECK | existing trade still open | scan skipped');
    return false;
  }

  const timeframe = '5min';
  const [analysis, candles] = await Promise.all([
    analyzePair('XAUUSD'),
    getCandles('XAUUSD', timeframe)
  ]);

  if (!analysis?.indicators || !Array.isArray(candles) || candles.length < 20) {
    console.log('🥇 AUTO TRADE CHECK | WAIT | insufficient market data');
    return false;
  }

  const liveAction = String(analysis?.signal?.action || '').toUpperCase();
  const fallbackDirection =
    Number(analysis.indicators.ema20) >= Number(analysis.indicators.ema50)
      ? 'BUY'
      : 'SELL';
  const direction = ['BUY', 'SELL'].includes(liveAction) ? liveAction : fallbackDirection;

  const { score, marketDirection } = directionalMarketScore(analysis, direction);
  const confidence = Number(analysis?.signal?.confidence || 0);

  // Hourly Check Your Trade gate: score 70+ is enough. Signal Lab is intentionally not used here.
  if (marketDirection !== direction || score < MIN_SCORE) {
    console.log(
      `🥇 AUTO TRADE CHECK | WAIT | ${direction} | score=${score}/100 | AI=${Number.isFinite(confidence) ? confidence : 0}%`
    );
    return false;
  }

  const levels = calculateTradeLevels(candles, direction, 'XAUUSD');
  if (!levels) {
    console.log('🥇 AUTO TRADE CHECK | WAIT | unable to calculate trade levels');
    return false;
  }

  const entry = finite(levels.entry);
  const sl = finite(levels.sl ?? levels.stopLoss);
  const tp1 = finite(levels.tp1 ?? levels.target1);
  const tp2 = finite(levels.tp2 ?? levels.target2);

  if (entry == null || sl == null || tp1 == null || tp2 == null) {
    console.log('🥇 AUTO TRADE CHECK | WAIT | invalid trade levels');
    return false;
  }

  const source = `${SOURCE_PREFIX}_CHECKTRADE_${opportunityKey()}`;
  const inserted = addTrade({
    telegram_id: source,
    pair: 'XAUUSD',
    action: direction,
    entry,
    stop_loss: sl,
    target1: tp1,
    target2: tp2
  });

  const tradeId = Number(inserted?.lastInsertRowid || 0);
  if (tradeId <= 0) {
    console.log(`❌ AUTO TRADE CHECK | trade insert rejected | ${direction}`);
    return false;
  }

  const message = [
    '🥇 صفقة الذهب — اختبر صفقتك',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '⚙️ نوع الصفقة: ⚡ سكالب',
    `📊 الاتجاه: ${direction === 'BUY' ? '📈 BUY' : '📉 SELL'}`,
    '',
    `💰 الدخول: ${entry.toFixed(2)}`,
    `🛑 وقف الخسارة: ${sl.toFixed(2)}`,
    `🎯 الهدف الأول TP1: ${tp1.toFixed(2)}`,
    `🏆 الهدف الثاني TP2: ${tp2.toFixed(2)}`,
    '',
    `⭐ قوة الصفقة: ${score}/100`,
    `🤖 ثقة AI: ${Number.isFinite(confidence) ? confidence : 0}%`,
    '✅ معتمدة بالسكور — الحد الأدنى 70/100',
    '',
    `⏱️ فريم التحليل: ${timeframe}`
  ].join('\n');

  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) {
    console.log(`❌ AUTO TRADE CHECK | VIP_CHANNEL_ID missing | Trade #${tradeId} remains open`);
    return false;
  }

  try {
    await bot.telegram.sendMessage(chatId, message);
    console.log(
      `💎 AUTO TRADE CHECK SENT | Trade #${tradeId} | XAUUSD ${direction} | ` +
      `score=${score}/100 | AI=${Number.isFinite(confidence) ? confidence : 0}% | gate=SCORE70`
    );
    return true;
  } catch (error) {
    console.log(`❌ AUTO TRADE CHECK VIP SEND FAILED | Trade #${tradeId} | ${error.message}`);
    return false;
  }
}

function getMarketDirection(analysis) {
  return directionalMarketScore(analysis, 'BUY').marketDirection;
}

function currentMarketDirection(analysis) {
  return getMarketDirection(analysis);
}

module.exports = {
  runHourlyMarketBiasTrade,
  getMarketDirection,
  currentMarketDirection
};
