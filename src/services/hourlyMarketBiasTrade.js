const { analyzePair } = require('./analysisService');
const { getPrice } = require('./marketService');
const { addTrade, getOpenTrades } = require('../database/trades');
const config = require('../config');

const SOURCE_PREFIX = 'VIP_HOURLY_MARKET_BIAS';
const DISTANCE_USD = 5;
const MIN_AI_CONFIDENCE = 65;
const MIN_TECH_SCORE = 3;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getMarketDecision(analysis) {
  const signalAction = String(analysis?.signal?.action || '').toUpperCase();
  const technicalDirection = String(analysis?.technicalDirection || '').toUpperCase();
  const confidence = finite(analysis?.signal?.confidence);
  const buyScore = finite(analysis?.buyScore) ?? 0;
  const sellScore = finite(analysis?.sellScore) ?? 0;
  const adx = finite(analysis?.indicators?.adx);
  const reasons = [];

  if (!['BUY', 'SELL'].includes(technicalDirection)) {
    reasons.push('no strong technical direction');
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  const technicalScore = technicalDirection === 'BUY' ? buyScore : sellScore;
  if (technicalScore < MIN_TECH_SCORE) {
    reasons.push(`technical score ${technicalScore}/4 below ${MIN_TECH_SCORE}`);
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  if (!['BUY', 'SELL'].includes(signalAction)) {
    reasons.push('AI did not confirm a direction');
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  if (signalAction !== technicalDirection || analysis?.aiDirectionMismatch === true) {
    reasons.push(`AI/technical conflict ${signalAction}/${technicalDirection}`);
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  if (confidence == null || confidence < MIN_AI_CONFIDENCE || analysis?.lowAIConfidence === true) {
    reasons.push(`AI confidence ${confidence ?? 0}% below quality filter`);
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  if (adx != null && adx < 20) {
    reasons.push(`weak trend ADX ${adx.toFixed(1)}`);
    return { direction: 'WAIT', confidence, buyScore, sellScore, adx, reasons };
  }

  reasons.push(`technical ${technicalDirection} ${technicalScore}/4`);
  reasons.push(`AI confirms ${signalAction} ${confidence}%`);
  if (adx != null) reasons.push(`ADX ${adx.toFixed(1)}`);
  return { direction: technicalDirection, confidence, buyScore, sellScore, adx, reasons };
}

function getMarketDirection(analysis) {
  return getMarketDecision(analysis).direction;
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
  // Never stack this scanner's trades. Wait until its current trade closes.
  if (hasOpenBiasTrade()) {
    console.log('🧠 STRONG MARKET BIAS | existing trade still open | scan skipped');
    return false;
  }

  const analysis = await analyzePair('XAUUSD');
  const decision = getMarketDecision(analysis);
  const direction = decision.direction;

  if (!['BUY', 'SELL'].includes(direction)) {
    console.log(`🧠 STRONG MARKET BIAS | WAIT | ${decision.reasons.join(' | ')}`);
    return false;
  }

  const entry = finite(await getPrice('XAUUSD'));
  if (entry == null || entry <= 0) throw new Error('Strong Market Bias cannot determine XAUUSD live price');

  const sl = direction === 'BUY' ? entry - DISTANCE_USD : entry + DISTANCE_USD;
  const tp = direction === 'BUY' ? entry + DISTANCE_USD : entry - DISTANCE_USD;
  const source = `${SOURCE_PREFIX}_${opportunityKey()}`;

  const inserted = addTrade({telegram_id:source,pair:'XAUUSD',action:direction,entry,stop_loss:sl,target1:tp,target2:tp});
  const tradeId = Number(inserted?.lastInsertRowid || 0);
  if (tradeId <= 0) {
    console.log(`❌ STRONG MARKET BIAS | trade insert rejected | ${direction}`);
    return false;
  }

  const score = direction === 'BUY' ? decision.buyScore : decision.sellScore;
  const message = [
    '🧠 صفقة Strong Market Bias',
    '━━━━━━━━━━━━━━━━━━','',
    '🥇 الزوج: #XAUUSD',
    `📊 الاتجاه: ${direction === 'BUY' ? '📈 BUY' : '📉 SELL'}`,
    `🧠 التأكيد الفني: ${score}/4`,
    ...(decision.confidence == null ? [] : [`🤖 ثقة AI: ${decision.confidence.toFixed(0)}%`]),
    ...(decision.adx == null ? [] : [`💪 ADX: ${decision.adx.toFixed(1)}`]),
    '',`💰 الدخول: ${entry.toFixed(2)}`,`🛑 وقف الخسارة: ${sl.toFixed(2)}`,`🎯 الهدف: ${tp.toFixed(2)}`,
    '',`📏 SL: $${DISTANCE_USD}`,`💵 TP: $${DISTANCE_USD}`,'','🧪 المصدر: Strong Market Bias'
  ].join('\n');

  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) {
    console.log(`❌ STRONG MARKET BIAS | VIP_CHANNEL_ID missing | Trade #${tradeId} remains open`);
    return false;
  }

  try {
    await bot.telegram.sendMessage(chatId, message);
    console.log(`💎 STRONG MARKET BIAS SENT | Trade #${tradeId} | ${direction} | score=${score}/4 | AI=${decision.confidence}% | entry=${entry.toFixed(2)} | SL=${sl.toFixed(2)} | TP=${tp.toFixed(2)}`);
    return true;
  } catch (error) {
    console.log(`❌ STRONG MARKET BIAS VIP SEND FAILED | Trade #${tradeId} | ${error.message}`);
    return false;
  }
}

module.exports = {runHourlyMarketBiasTrade,getMarketDirection,getMarketDecision};
