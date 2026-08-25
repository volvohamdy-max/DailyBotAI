const { analyzePair } = require('./analysisGate');
const { buildGoldScalpResult } = require('./goldScalper');
const { scanGoldH4MeanReversion } = require('./goldH4MeanReversion');
const { allUsers } = require('../database/users');
const { addTrade, getOpenTrades, markTradeAsFree } = require('../database/trades');
const { canSendFreeSignal, markFreeSignalSent } = require('../database/freeSignalState');
const { getCandles } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');
const { saveSignal } = require('./signalCache');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');
const { saveTradeFeatures } = require('../database/adaptiveIntelligence');
const { publishHiddenSignal } = require('./hiddenSignalService');
const { evaluatePowerTrade } = require('./powerTradeEngine');
const config = require('../config');
const { getBoolSetting, getNumberSetting } = require('../database/adminControl');

const PAIRS = ['XAUUSD'];
let lastSignals = {};

async function processSignalResult(bot, pair, result) {
  if (!result?.signal) return false;
  if (result.signal.action !== 'BUY' && result.signal.action !== 'SELL') return false;

  const confidence = Number(result.signal.confidence);
  if (!Number.isFinite(confidence)) {
    console.log(`❌ Invalid AI confidence: ${pair} | ${result.scalpMeta?.strategyLabel || 'UNKNOWN'}`);
    return false;
  }

  const minAiConfidence = getNumberSetting('min_ai_confidence', 60);
  if (pair !== 'XAUUSD' && confidence < minAiConfidence) {
    console.log(`❌ Auto signal rejected: ${pair} confidence ${confidence}% < ${minAiConfidence}%`);
    return false;
  }

  if (pair === 'XAUUSD' && !result.scalpMeta?.ready) {
    console.log(`🟡 Gold scalp rejected: ${result.scalpMeta?.status || 'NOT_READY'}`);
    return false;
  }

  if (pair === 'XAUUSD' && result.scalpMeta?.ready) {
    const allowedGrades = new Set(['A+', 'A', 'TECH-A', 'TECH-BREAKOUT']);
    const grade = String(result.scalpMeta.grade || '').toUpperCase();
    const score = Number(result.scalpMeta.score || 0);
    const ai = Number(result.scalpMeta.aiConfidence || 0);
    if (!allowedGrades.has(grade)) {
      console.log(`🟡 Gold scalp blocked by grade: ${grade || 'NONE'} | score=${score} | ai=${ai}`);
      return false;
    }
    if (score < 72) {
      console.log(`🟡 Gold scalp blocked by score: ${score}/100`);
      return false;
    }
  }

  let levels;
  if (pair === 'XAUUSD' && result.scalpMeta?.ready) {
    const entry = Number(result.scalpMeta.entry);
    const sl = Number(result.scalpMeta.stopLoss);
    const tp1 = Number(result.scalpMeta.tp1);
    const tp2 = Number(result.scalpMeta.tp2);
    const atr = Number(result.scalpMeta.atr5);
    const riskDistance = Math.abs(entry - sl);
    levels = {
      entry, sl, tp1, tp2, atr, riskDistance,
      riskPct: Number.isFinite(entry) && entry > 0 ? (riskDistance / entry) * 100 : null,
      rrTp1: riskDistance > 0 ? Math.abs(tp1 - entry) / riskDistance : null,
      rrTp2: riskDistance > 0 ? Math.abs(tp2 - entry) / riskDistance : null
    };
    console.log('⚡ Using Gold Scalper 5M levels:', {
      strategy: result.scalpMeta?.strategyLabel,
      entry: levels.entry,
      sl: levels.sl,
      tp1: levels.tp1,
      tp2: levels.tp2,
      riskPct: Number(levels.riskPct).toFixed(3) + '%'
    });
  } else {
    const candles = await getCandles(pair);
    levels = calculateTradeLevels(candles, result.signal.action, pair);
  }

  if (!levels) {
    console.log(`❌ Auto signal rejected: ${pair} invalid Smart TP/SL levels`);
    return false;
  }

  if (pair === 'XAUUSD' && Number(levels.riskPct) > getNumberSetting('gold_max_risk_pct', 0.35)) {
    console.log(`❌ Auto signal rejected: ${pair} stop too wide for scalp (${Number(levels.riskPct).toFixed(3)}%)`);
    return false;
  }

  if (pair === 'XAUUSD' && Number.isFinite(Number(levels.riskDistance))) {
    const atr = Number(result.scalpMeta?.atr5 || result.indicators?.atr || 0);
    const maxStopDistance = Number.isFinite(atr) && atr > 0 ? Math.max(atr * 1.80, 8.0) : 8.0;
    if (Number(levels.riskDistance) > maxStopDistance) {
      console.log(`🟡 Gold scalp blocked: SL distance ${Number(levels.riskDistance).toFixed(2)} > max ${maxStopDistance.toFixed(2)}`);
      return false;
    }
  }

  let scalpEntry;
  if (pair === 'XAUUSD' && result.scalpMeta?.ready) {
    scalpEntry = { status: 'ENTRY_READY', reason: 'GOLD_SCALPER_APPROVED' };
    console.log(`⚡ XAUUSD bypassed legacy scalp confirmation: ${result.scalpMeta.grade} / ${result.scalpMeta.score}`);
  } else {
    scalpEntry = await evaluateScalpEntry(pair, result.signal.action, result.indicators);
  }

  if (scalpEntry.status !== 'ENTRY_READY') {
    console.log(`❌ AUTO SCALP ENTRY rejected ${pair}: ${scalpEntry.status} / ${scalpEntry.reason}`);
    return false;
  }

  const now = Date.now();
  const currentEntry = Number(levels.entry);
  const currentAtr = Number(result.scalpMeta?.atr5 || levels.atr || result.indicators?.atr || 0);
  const currentDirection = String(result.signal.action);
  const currentMode = String(result.scalpMeta?.entryMode || 'UNKNOWN');
  const scalpStrategyId = String(result.scalpMeta?.strategyId || 'SCALP').toUpperCase();
  const signalKey = `${pair}:${scalpStrategyId}`;
  const previousSignal = lastSignals[signalKey];

  if (previousSignal) {
    const sameDirection = previousSignal.direction === currentDirection;
    const sameMode = previousSignal.mode === currentMode;
    const elapsed = now - previousSignal.time;
    const priceDistance = Math.abs(currentEntry - previousSignal.entry);
    const referenceAtr = Math.max(currentAtr || 0, previousSignal.atr || 0, 1);
    const enoughPriceMovement = priceDistance >= referenceAtr * 0.80;
    const enoughTime = elapsed >= 20 * 60 * 1000;
    if (sameDirection && sameMode && !enoughPriceMovement && !enoughTime) {
      console.log(`♻️ DUPLICATE GOLD SETUP SKIPPED | ${scalpStrategyId} | ${currentDirection} ${currentMode} | entry=${currentEntry.toFixed(2)} | move=${priceDistance.toFixed(2)} | required=${(referenceAtr * 0.80).toFixed(2)}`);
      return false;
    }
  }

  const existingScalpTrade = getOpenTrades().find((trade) => {
    const source = String(trade.telegram_id || '').toUpperCase();
    return source === `VIP_SCALP_${scalpStrategyId}`;
  });
  if (existingScalpTrade) {
    console.log(`🔒 ${result.scalpMeta?.strategyLabel || 'GOLD SCALP'} blocked: Trade #${existingScalpTrade.id} still open`);
    return false;
  }

  const livePrice = Number(levels.entry);
  const atr = Number(result.indicators?.atr || 4);
  let zone = atr * 0.75;
  if (zone < 2) zone = 2;
  if (zone > 6) zone = 6;
  const entryFrom = result.signal.action === 'BUY' ? livePrice : livePrice - zone;
  const entryTo = result.signal.action === 'BUY' ? livePrice + zone : livePrice;
  const isProStrategy = scalpStrategyId === 'PRO_STRATEGY';

  const targetBlock = isProStrategy
    ? `📌 إدارة الصفقة\nالخروج ليس بهدف سعري ثابت.\n${result.signal.action === 'BUY' ? '✅ إغلاق الصفقة عند RSI(14) ≥ 63' : '✅ إغلاق الصفقة عند RSI(14) ≤ 37'}\n\n🧪 الاستراتيجية: RSI Reversal + Daily EMA50\n🕒 لا دخول بين 15:00 و16:59 UTC`
    : `🎯 الهدف الأول\n${Number(levels.tp1).toFixed(2)}\n\n🎯 الهدف الثاني\n${Number(levels.tp2).toFixed(2)}`;
  const riskBlock = isProStrategy
    ? `📏 مسافة وقف الخسارة\n${Number(levels.riskDistance).toFixed(2)} دولار`
    : `⚖️ العائد للمخاطرة\nTP1 → 1:${Number(levels.rrTp1).toFixed(2)}\nTP2 → 1:${Number(levels.rrTp2).toFixed(2)}\n\n📏 مسافة وقف الخسارة\n${Number(levels.riskDistance).toFixed(2)}`;

  const gradeMap = { 'A+': '🔥 قوية جدًا', 'A': '✅ قوية', 'TECH-A': '🧠 فنية مؤكدة', 'TECH-BREAKOUT': '🚀 اختراق فني قوي' };
  const quality = gradeMap[result.scalpMeta?.grade] || '✅ قوية';
  const message = `\n⚡ إشارة سكالب — ${result.scalpMeta?.strategyLabel || 'Gold Scalp'}\n\n🥇 الزوج: ${pair}\n\n📈 الاتجاه: ${result.signal.action}\n\n📍 منطقة الدخول\n\n${entryFrom.toFixed(2)} ➜ ${entryTo.toFixed(2)}\n\n🛑 وقف الخسارة\n${Number(levels.sl).toFixed(2)}\n\n${targetBlock}\n\n🤖 ثقة التحليل AI\n${Number(result.scalpMeta?.aiConfidence) > 0 ? `${Math.round(Number(result.scalpMeta.aiConfidence))}%` : 'غير متاحة'}\n\n${pair === 'XAUUSD' && result.scalpMeta?.ready ? `⚡ نوع الإشارة: ${result.scalpMeta?.strategyLabel || 'Gold Scalp'}\n🏅 جودة الفرصة: ${quality}\n⭐ Scalp Score: ${result.scalpMeta.score}/100\n⏱️ الفريم التنفيذي: 5M` : ''}\n\n📊 ATR\n${atr.toFixed(2)}\n\n${riskBlock}\n`;

  // A live trade is not committed until the VIP channel has actually received it.
  // This prevents silent open trades when Telegram/configuration is unavailable.
  if (!config.vipChannelId) {
    console.log(`❌ LIVE SIGNAL ABORTED | ${pair} | ${scalpStrategyId} | VIP_CHANNEL_ID is not configured`);
    return false;
  }

  try {
    await bot.telegram.sendMessage(config.vipChannelId, message);
    console.log(`💎 VIP SIGNAL DELIVERED | ${pair} | ${scalpStrategyId}`);
  } catch (e) {
    console.log(`❌ LIVE SIGNAL ABORTED | ${pair} | ${scalpStrategyId} | VIP delivery failed: ${e.message}`);
    return false;
  }

  const tradeInsert = addTrade({
    telegram_id: `VIP_SCALP_${scalpStrategyId}`,
    pair,
    action: result.signal.action,
    entry: levels.entry,
    stop_loss: levels.sl,
    target1: levels.tp1,
    target2: levels.tp2
  });
  const tradeId = Number(tradeInsert?.lastInsertRowid || 0);

  if (tradeId <= 0) {
    console.log(`⚠️ VIP received signal but trade DB insert was blocked/failed | ${pair} | ${scalpStrategyId}`);
    return false;
  }

  // Only a successfully delivered + recorded signal participates in duplicate suppression.
  lastSignals[signalKey] = {
    direction: currentDirection,
    mode: currentMode,
    entry: currentEntry,
    atr: currentAtr,
    time: now
  };

  try {
    const power = evaluatePowerTrade({ tradeId, pair, action: result.signal.action, result });
    if (power.qualified) console.log(`⚡ POWER TRADE ${power.grade} | ${pair} | Score ${power.powerScore}/100 | Trade #${tradeId}`);
  } catch (error) {
    console.log('Power Trade classification error:', error.message);
  }
  try {
    saveTradeFeatures({ tradeId, pair, action: result.signal.action, indicators: result.indicators || {}, scalpMeta: result.scalpMeta || {} });
    console.log(`🧠 Adaptive snapshot saved | Trade ${tradeId}`);
  } catch (error) {
    console.log('⚠️ Adaptive snapshot save failed:', error.message);
  }

  const users = allUsers();
  let freePublicSent = false;
  const freeEligible = !isProStrategy && pair === 'XAUUSD' && result.scalpMeta?.ready === true && Number(result.scalpMeta?.score || 0) >= 80 && canSendFreeSignal(24);
  if (freeEligible && config.mainGroupId) {
    try {
      const freeMessage = `🆓 صفقة مجانية من FOREX AI\n━━━━━━━━━━━━━━━━━━\n\n${message}\n\n💎 أعضاء VIP يحصلون على جميع الفرص والتحديثات بشكل مستمر.\n\n⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
      await bot.telegram.sendMessage(config.mainGroupId, freeMessage);
      markTradeAsFree(tradeId);
      markFreeSignalSent();
      freePublicSent = true;
      console.log(`🆓 FREE SIGNAL SENT | Trade ${tradeId}`);
    } catch (e) {
      console.log('Free signal send error:', e.message);
    }
  }

  if (!freePublicSent) {
    try {
      if (isProStrategy) {
        console.log(`🕶️ Hidden public signal skipped for Pro Strategy trade ${tradeId}: RSI-managed exit has no fixed TP targets`);
      } else {
        await publishHiddenSignal(bot, {
          tradeId, pair, action: result.signal.action, entry: levels.entry,
          stopLoss: levels.sl, target1: levels.tp1, target2: levels.tp2,
          aiScore: Number(result.scalpMeta?.score ?? result.signal?.confidence ?? 0)
        });
      }
    } catch (error) {
      console.log('Hidden signal publish failed:', error.message);
    }
  }

  for (const adminId of config.adminIds) {
    const exists = users.find(u => String(u.telegram_id) === String(adminId));
    if (!exists) {
      try { await bot.telegram.sendMessage(adminId, message); }
      catch (e) { console.log(`Admin send failed ${adminId}:`, e.message); }
    }
  }

  if (pair === 'XAUUSD' && result.scalpMeta?.ready && typeof result.scalpMeta.markSent === 'function') {
    result.scalpMeta.markSent();
  }
  console.log(`✅ LIVE SIGNAL COMMITTED | ${pair} | ${scalpStrategyId} | Trade #${tradeId}`);
  return true;
}

async function scanMarket(bot) {
  if (!getBoolSetting('auto_signals_enabled', true)) {
    console.log('⏸️ Auto Signals disabled from Admin Control Center');
    return;
  }

  await scanGoldH4MeanReversion(bot);
  const scanStart = Date.now();
  console.log('🚀 SCAN START:', new Date(scanStart).toLocaleTimeString());
  console.log('🚨 AUTO SIGNALS FILE IS RUNNING');
  console.log('🔍 Scanning Market...');

  for (const pair of PAIRS) {
    try {
      let result;
      if (pair === 'XAUUSD') {
        const baseAnalysis = await analyzePair(pair);
        result = await buildGoldScalpResult(baseAnalysis);
      } else {
        result = await analyzePair(pair);
      }

      if (!result?.signal) continue;
      await processSignalResult(bot, pair, result);
    } catch (error) {
      console.log(`❌ Auto signal scan error ${pair}:`, error.message);
    }
  }

  console.log(`✅ Auto Signals finished in ${Date.now() - scanStart}ms`);
}

module.exports = {
  scanMarket,
  processSignalResult
};
