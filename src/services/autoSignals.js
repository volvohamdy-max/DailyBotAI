const { analyzePair } = require('./analysisGate');
const { buildGoldScalpResult } = require('./goldScalper');
const { scanGoldRegimeSignals } = require('./goldRegimeSignals');
const { scanGoldPowerTrade } = require('./goldPowerTrade');
const { allUsers } = require('../database/users');
const {
  addTrade,
  getOpenTrades,
  markTradeAsFree
} = require('../database/trades');

const {
  canSendFreeSignal,
  markFreeSignalSent
} = require('../database/freeSignalState');
const { getLivePrice } = require('./priceService');
const { getCandles } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');
const { saveSignal } = require('./signalCache');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');
const {
  saveTradeFeatures
} = require('../database/adaptiveIntelligence');
const {
  publishHiddenSignal
} = require('./hiddenSignalService');
const {
  evaluatePowerTrade
} = require('./powerTradeEngine');
const config = require('../config');
const {
  getBoolSetting,
  getNumberSetting
} = require('../database/adminControl');
const PAIRS = [
  
  "XAUUSD"
];

let lastSignals = {};

async function scanMarket(bot) {
  if (!getBoolSetting('auto_signals_enabled', true)) {
    console.log('⏸️ Auto Signals disabled from Admin Control Center');
    return;
  }
  const openTrades = getOpenTrades();

  // Independent GOLD REGIME engine; never shares scalp state/cooldown/trade lock.
  await scanGoldRegimeSignals(bot);

  // Independent GOLD POWER engine; existing Gold Scalper remains untouched.
  await scanGoldPowerTrade(bot);

  const scanStart = Date.now();
  console.log("🚀 SCAN START:", new Date().toLocaleTimeString());
console.log("🚨 AUTO SIGNALS FILE IS RUNNING");
  console.log("🔍 Scanning Market...");

  for (const pair of PAIRS) {

    try {

      const result =
        pair === 'XAUUSD'
          ? await buildGoldScalpResult()
          : await analyzePair(pair);

console.log("🧠 SIGNAL DEBUG:", JSON.stringify({
    pair,
    signal: result.signal,
    indicators: result.indicators
}, null, 2));
console.log(
    "🧠 ANALYSIS RESULT:",
    JSON.stringify(result, null, 2)
);

saveSignal(pair, result);
      console.log("AI RESULT:", pair, result);

      if (!result.signal) continue;
if (
  result.signal.action !== "BUY" &&
  result.signal.action !== "SELL"
) continue;
      const confidence = Number(result.signal.confidence);

      if (!Number.isFinite(confidence)) {
        console.log(`❌ Invalid AI confidence: ${pair}`);
        continue;
      }

      const minAiConfidence = getNumberSetting('min_ai_confidence', 60);

      if (
        pair !== 'XAUUSD' &&
        confidence < minAiConfidence
      ) {
        console.log(
          `❌ Auto signal rejected: ${pair} confidence ${confidence}% < ${minAiConfidence}%`
        );
        continue;
      }

      if (
        pair === 'XAUUSD' &&
        !result.scalpMeta?.ready
      ) {
        console.log(
          `🟡 Gold scalp rejected: ${result.scalpMeta?.status || 'NOT_READY'}`
        );
        continue;
      }

      // ==========================================
      // GOLD SCALP QUALITY FILTER
      // Only strong execution grades are broadcast.
      // ==========================================

      if (
        pair === 'XAUUSD' &&
        result.scalpMeta?.ready
      ) {
        const allowedGrades =
          new Set([
            'A+',
            'A',
            'TECH-A',
            'TECH-BREAKOUT'
          ]);

        const grade =
          String(
            result.scalpMeta.grade || ''
          ).toUpperCase();

        const score =
          Number(
            result.scalpMeta.score || 0
          );

        const ai =
          Number(
            result.scalpMeta.aiConfidence || 0
          );

        if (!allowedGrades.has(grade)) {
          console.log(
            `🟡 Gold scalp blocked by grade: ${grade || 'NONE'} | score=${score} | ai=${ai}`
          );

          continue;
        }

        // Extra safety:
        // even allowed grades need minimum technical quality.
        if (score < 72) {
          console.log(
            `🟡 Gold scalp blocked by score: ${score}/100`
          );

          continue;
        }
      }

      let levels;

      // Gold Scalper already calculates dedicated 5M scalp levels.
      if (
        pair === 'XAUUSD' &&
        result.scalpMeta?.ready
      ) {
        const entry = Number(result.scalpMeta.entry);
        const sl = Number(result.scalpMeta.stopLoss);
        const tp1 = Number(result.scalpMeta.tp1);
        const tp2 = Number(result.scalpMeta.tp2);
        const atr = Number(result.scalpMeta.atr5);

        const riskDistance = Math.abs(entry - sl);

        levels = {
          entry,
          sl,
          tp1,
          tp2,
          atr,
          riskDistance,
          riskPct:
            Number.isFinite(entry) && entry > 0
              ? (riskDistance / entry) * 100
              : null,
          rrTp1:
            riskDistance > 0
              ? Math.abs(tp1 - entry) / riskDistance
              : null,
          rrTp2:
            riskDistance > 0
              ? Math.abs(tp2 - entry) / riskDistance
              : null
        };

        console.log('⚡ Using Gold Scalper 5M levels:', {
          entry: levels.entry,
          sl: levels.sl,
          tp1: levels.tp1,
          tp2: levels.tp2,
          riskPct: Number(levels.riskPct).toFixed(3) + '%'
        });

      } else {
        const candles = await getCandles(pair);

        levels = calculateTradeLevels(
          candles,
          result.signal.action,
          pair
        );
      }

      if (!levels) {
        console.log(
          `❌ Auto signal rejected: ${pair} invalid Smart TP/SL levels`
        );
        continue;
      }

      if (
        pair === 'XAUUSD' &&
        Number(levels.riskPct) >
        getNumberSetting('gold_max_risk_pct', 0.35)
      ) {
        console.log(
          `❌ Auto signal rejected: ${pair} stop too wide for scalp (${Number(levels.riskPct).toFixed(3)}%)`
        );
        continue;
      }

      // Absolute stop-distance protection for Gold Scalping
      if (
        pair === 'XAUUSD' &&
        Number.isFinite(Number(levels.riskDistance))
      ) {
        const atr =
          Number(
            result.scalpMeta?.atr5 ||
            result.indicators?.atr ||
            0
          );

        const maxStopDistance =
          Number.isFinite(atr) && atr > 0
            ? Math.max(atr * 1.80, 8.0)
            : 8.0;

        if (
          Number(levels.riskDistance) >
          maxStopDistance
        ) {
          console.log(
            `🟡 Gold scalp blocked: SL distance ${Number(levels.riskDistance).toFixed(2)} > max ${maxStopDistance.toFixed(2)}`
          );

          continue;
        }
      }

      // AUTO SCALP ENTRY
      // XAUUSD already passed the dedicated Gold Scalper Engine.
      let scalpEntry;

      if (
        pair === 'XAUUSD' &&
        result.scalpMeta?.ready
      ) {
        scalpEntry = {
          status: 'ENTRY_READY',
          reason: 'GOLD_SCALPER_APPROVED'
        };

        console.log(
          `⚡ XAUUSD bypassed legacy scalp confirmation: ${result.scalpMeta.grade} / ${result.scalpMeta.score}`
        );

      } else {
        scalpEntry = await evaluateScalpEntry(
          pair,
          result.signal.action,
          result.indicators
        );
      }

      if (scalpEntry.status !== 'ENTRY_READY') {
        console.log(
          `❌ AUTO SCALP ENTRY rejected ${pair}: ${scalpEntry.status} / ${scalpEntry.reason}`
        );
        continue;
      }

      console.log(
        `✅ AUTO SCALP ENTRY READY ${pair} | 5M=${scalpEntry.trigger5m}`
      );

      // ==========================================
      // SMART DUPLICATE / SAME-SETUP PROTECTION
      // ==========================================

      const now = Date.now();

      const currentEntry =
        Number(levels.entry);

      const currentAtr =
        Number(
          result.scalpMeta?.atr5 ||
          levels.atr ||
          result.indicators?.atr ||
          0
        );

      const currentDirection =
        String(result.signal.action);

      const currentMode =
        String(
          result.scalpMeta?.entryMode ||
          'UNKNOWN'
        );

      const scalpStrategyId = String(result.scalpMeta?.strategyId || 'SCALP').toUpperCase();

      const signalKey = `${pair}:${scalpStrategyId}`;

      const previousSignal =
        lastSignals[signalKey];

      if (previousSignal) {
        const sameDirection =
          previousSignal.direction ===
          currentDirection;

        const sameMode =
          previousSignal.mode ===
          currentMode;

        const elapsed =
          now -
          previousSignal.time;

        const priceDistance =
          Math.abs(
            currentEntry -
            previousSignal.entry
          );

        const referenceAtr =
          Math.max(
            currentAtr || 0,
            previousSignal.atr || 0,
            1
          );

        const enoughPriceMovement =
          priceDistance >=
          referenceAtr * 0.80;

        const enoughTime =
          elapsed >=
          20 * 60 * 1000;

        if (
          sameDirection &&
          sameMode &&
          !enoughPriceMovement &&
          !enoughTime
        ) {
          console.log(
            `♻️ DUPLICATE GOLD SETUP SKIPPED | ` +
            `${currentDirection} ${currentMode} | ` +
            `entry=${currentEntry.toFixed(2)} | ` +
            `move=${priceDistance.toFixed(2)} | ` +
            `required=${(referenceAtr * 0.80).toFixed(2)}`
          );

          continue;
        }
      }

      lastSignals[signalKey] = {
        direction: currentDirection,
        mode: currentMode,
        entry: currentEntry,
        atr: currentAtr,
        time: now
      };

      const existingScalpTrade = getOpenTrades().find((trade) => {
        const source = String(trade.telegram_id || '').toUpperCase();
        return source === `VIP_SCALP_${scalpStrategyId}`;
      });

      if (existingScalpTrade) {
        console.log(
          `🔒 ${result.scalpMeta?.strategyLabel || 'GOLD SCALP'} blocked: Trade #${existingScalpTrade.id} still open`
        );
        continue;
      }

      const tradeInsert = addTrade({
        telegram_id: `VIP_SCALP_${scalpStrategyId}`,
        pair: pair,
        action: result.signal.action,
        entry: levels.entry,
        stop_loss: levels.sl,
        target1: levels.tp1,
        target2: levels.tp2
      });

      const tradeId =
        Number(tradeInsert?.lastInsertRowid || 0);

      // ==================================================
      // POWER TRADE SHADOW CLASSIFICATION
      // Does NOT modify trading logic or risk.
      // ==================================================

      if (tradeId > 0) {
        try {

          const power =
            evaluatePowerTrade({
              tradeId,
              pair,
              action:
                result.signal.action,
              result
            });

          if (power.qualified) {
            console.log(
              `⚡ POWER TRADE ${power.grade} | ` +
              `${pair} | ` +
              `Score ${power.powerScore}/100 | ` +
              `Trade #${tradeId}`
            );
          }

        } catch (error) {
          console.log(
            'Power Trade classification error:',
            error.message
          );
        }
      }

      if (tradeId > 0) {
        try {
          saveTradeFeatures({
            tradeId,
            pair,
            action: result.signal.action,
            indicators: result.indicators || {},
            scalpMeta: result.scalpMeta || {}
          });

          console.log(
            `🧠 Adaptive snapshot saved | Trade ${tradeId}`
          );

        } catch (error) {
          console.log(
            '⚠️ Adaptive snapshot save failed:',
            error.message
          );
        }
      }

      const livePrice = Number(levels.entry);

// عرض منطقة الدخول حسب ATR
// قيمة ATR الحالية
const atr = Number(result.indicators.atr || 4);

// منطقة الدخول = 75% من ATR
let zone = atr * 0.75;

// أقل منطقة دخول 2 دولار
if (zone < 2) zone = 2;

// أكبر منطقة دخول 6 دولار
if (zone > 6) zone = 6;

let entryFrom;
let entryTo;

if (result.signal.action === "BUY") {

    entryFrom = livePrice;
    entryTo = livePrice + zone;

} else {

    entryFrom = livePrice - zone;
    entryTo = livePrice;

}
const message = `
⚡ إشارة سكالب — ${result.scalpMeta?.strategyLabel || 'Gold Scalp'}

🥇 الزوج: ${pair}

📈 الاتجاه: ${result.signal.action}

📍 منطقة الدخول

${entryFrom.toFixed(2)} ➜ ${entryTo.toFixed(2)}

🛑 وقف الخسارة
${Number(levels.sl).toFixed(2)}

🎯 الهدف الأول
${Number(levels.tp1).toFixed(2)}

🎯 الهدف الثاني
${Number(levels.tp2).toFixed(2)}

🤖 ثقة التحليل AI
${Number(result.scalpMeta?.aiConfidence) > 0
  ? `${Math.round(Number(result.scalpMeta.aiConfidence))}%`
  : 'غير متاحة'}

${pair === 'XAUUSD' && result.scalpMeta?.ready
  ? (() => {
      const gradeMap = {
        'A+': '🔥 قوية جدًا',
        'A': '✅ قوية',
        'TECH-A': '🧠 فنية مؤكدة',
        'TECH-BREAKOUT': '🚀 اختراق فني قوي'
      };

      const quality =
        gradeMap[result.scalpMeta.grade] ||
        '✅ قوية';

      return `⚡ نوع الإشارة: ${result.scalpMeta?.strategyLabel || 'Gold Scalp'}
🏅 جودة الفرصة: ${quality}
⭐ Scalp Score: ${result.scalpMeta.score}/100
⏱️ الفريم التنفيذي: 5M`;
    })()
  : ''}

📊 ATR
${atr.toFixed(2)}

⚖️ العائد للمخاطرة
TP1 → 1:${Number(levels.rrTp1).toFixed(2)}
TP2 → 1:${Number(levels.rrTp2).toFixed(2)}

📏 مسافة وقف الخسارة
${Number(levels.riskDistance).toFixed(2)}
`;
const users = allUsers();

// ==================================================
// FULL SIGNAL → VIP GROUP ONLY
// ==================================================

if (config.vipChannelId) {
    try {

        await bot.telegram.sendMessage(
            config.vipChannelId,
            message
        );

        console.log(
            `💎 VIP SIGNAL SENT | ${pair} | Trade #${tradeId}`
        );

    } catch (e) {

        console.log(
            `❌ VIP signal send failed ${pair}:`,
            e.message
        );

    }
} else {

    console.log(
        '❌ VIP_CHANNEL_ID is not configured'
    );
}



      // ==================================================
      // FREE PUBLIC SIGNAL — مرة واحدة كل 24 ساعة
      // ==================================================

      let freePublicSent = false;

      const freeEligible =
        pair === 'XAUUSD' &&
        result.scalpMeta?.ready === true &&
        Number(result.scalpMeta?.score || 0) >= 80 &&
        canSendFreeSignal(24);

      if (
        freeEligible &&
        config.mainGroupId
      ) {
        try {
          const freeMessage =
`🆓 صفقة مجانية من FOREX AI
━━━━━━━━━━━━━━━━━━

${message}

💎 أعضاء VIP يحصلون على جميع الفرص والتحديثات بشكل مستمر.

⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;

          await bot.telegram.sendMessage(
            config.mainGroupId,
            freeMessage
          );

          if (tradeId > 0) {
            markTradeAsFree(tradeId);
          }

          markFreeSignalSent();

          freePublicSent = true;

          console.log(
            `🆓 FREE SIGNAL SENT | Trade ${tradeId}`
          );

        } catch (e) {
          console.log(
            'Free signal send error:',
            e.message
          );
        }
      }


      // ==================================================
      // HIDDEN SIGNAL FOR PUBLIC
      // VIP signal that was NOT today's free public signal.
      // ==================================================

      if (
        !freePublicSent &&
        tradeId > 0
      ) {
        try {
          await publishHiddenSignal(
            bot,
            {
              tradeId,
              pair,
              action: result.signal.action,

              entry: levels.entry,
              stopLoss: levels.sl,
              target1: levels.tp1,
              target2: levels.tp2,

              aiScore:
                Number(
                  result.scalpMeta?.score ??
                  result.signal?.confidence ??
                  0
                )
            }
          );

        } catch (error) {
          console.log(
            'Hidden signal publish failed:',
            error.message
          );
        }
      }

// إرسال للأدمن إذا لم يكن موجودًا في قاعدة البيانات
for (const adminId of config.adminIds) {
    const exists = users.find(
        u => String(u.telegram_id) === String(adminId)
    );

    if (!exists) {
        try {
            await bot.telegram.sendMessage(adminId, message);
        } catch (e) {
            console.log(`Admin send failed ${adminId}:`, e.message);
        }
    }
}
              if (
  pair === 'XAUUSD' &&
  result.scalpMeta?.ready &&
  typeof result.scalpMeta.markSent === 'function'
) {
  result.scalpMeta.markSent();
}

console.log("✅ Signal Sent:", pair);

        } catch (e) {
            console.log(pair, e.message);
        }
    }
console.log(
    `⏱️ SCAN DURATION: ${((Date.now() - scanStart) / 1000).toFixed(1)} seconds`
);
    console.log("✅ Market Scan Finished");
}



module.exports = {
  scanMarket
};

