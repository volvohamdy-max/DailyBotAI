const { buildGoldRegimeResult } = require('./goldRegimeStrategy');
const {
  addTrade,
  getOpenTrades,
  updateTradeStatus
} = require('../database/trades');
const { saveTradeFeatures } = require('../database/adaptiveIntelligence');
const config = require('../config');
const { setLatestRegimeDiagnostics } = require('./regimeDiagnosticsCache');

async function scanGoldRegimeSignals(bot) {
  try {
    const result = await buildGoldRegimeResult();
    setLatestRegimeDiagnostics(result);

    if (!result?.signal || !result?.regimeMeta?.ready) {
      return result;
    }

    const meta = result.regimeMeta;

    const existing = getOpenTrades().find(
      (trade) => String(trade.telegram_id || '').toUpperCase() === 'VIP_REGIME'
    );

    if (existing) {
      console.log(`🔒 GOLD REGIME blocked: Trade #${existing.id} still open`);
      return result;
    }

    if (!config.vipChannelId) {
      console.log('❌ GOLD REGIME not sent: VIP_CHANNEL_ID missing');
      return result;
    }

    const insert = addTrade({
      telegram_id: 'VIP_REGIME',
      pair: 'XAUUSD',
      action: result.signal.action,
      entry: meta.entry,
      stop_loss: meta.stopLoss,
      target1: meta.tp1,
      target2: meta.tp2
    });

    const tradeId = Number(insert?.lastInsertRowid || 0);
    if (!tradeId) {
      throw new Error('Failed to save GOLD REGIME trade');
    }

    try {
      saveTradeFeatures({
        tradeId,
        pair: 'XAUUSD',
        action: result.signal.action,
        indicators: result.indicators || {},
        scalpMeta: meta || {}
      });
      console.log(`🧠 Adaptive snapshot saved | GOLD REGIME Trade ${tradeId}`);
    } catch (adaptiveError) {
      console.log('⚠️ GOLD REGIME adaptive snapshot failed:', adaptiveError.message);
    }

    const aiText = Number(meta.aiConfidence) > 0
      ? `${Math.round(Number(meta.aiConfidence))}%`
      : 'غير متاحة';

    const msg = `🧭 إشارة GOLD REGIME
━━━━━━━━━━━━━━━━━━

🥇 الزوج: XAUUSD
${meta.direction === 'BUY' ? '📈' : '📉'} الاتجاه: ${meta.direction}

📍 الدخول
${Number(meta.entry).toFixed(2)}

🛑 وقف الخسارة
${Number(meta.stopLoss).toFixed(2)}

🎯 الهدف الأول
${Number(meta.tp1).toFixed(2)}

🏆 الهدف الثاني
${Number(meta.tp2).toFixed(2)}

🧭 الاستراتيجية
H1 + 15M Regime / 5M Pullback

⭐ Setup Score
${Number(meta.score || 0)}/100

🤖 ثقة التحليل AI
${aiText}

📊 ADX 15M
${Number(meta.adx15).toFixed(2)}

⚖️ العائد للمخاطرة
TP1 → 1:${Number(meta.rrTp1).toFixed(2)}
TP2 → 1:${Number(meta.rrTp2).toFixed(2)}

💎 النوع: GOLD REGIME — مستقل عن السكالب`;

    try {
      await bot.telegram.sendMessage(config.vipChannelId, msg);
    } catch (sendError) {
      try {
        updateTradeStatus(tradeId, 'closed');
      } catch (rollbackError) {
        console.log(
          `❌ GOLD REGIME rollback failed for Trade #${tradeId}:`,
          rollbackError.message
        );
      }

      console.log(
        `❌ GOLD REGIME VIP send failed | Trade #${tradeId} closed to prevent orphan result:`,
        sendError.message
      );
      throw sendError;
    }

    if (typeof meta.markSent === 'function') {
      meta.markSent();
    }

    console.log(
      `🧭 GOLD REGIME SENT | ${meta.direction} | Score ${meta.score}/100 | Trade #${tradeId}`
    );

    return { ...result, sent: true, tradeId };
  } catch (error) {
    console.log('❌ GOLD REGIME scan error:', error.message);
    const fallback = {
      pair: 'XAUUSD',
      signal: null,
      regimeMeta: {
        ready: false,
        status: 'REGIME_SEND_ERROR',
        error: error.message
      }
    };
    setLatestRegimeDiagnostics(fallback);
    return fallback;
  }
}

module.exports = { scanGoldRegimeSignals };
