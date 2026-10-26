const config = require('../config');
const PUBLIC_TEASER_COOLDOWN_MS = Number(process.env.PUBLIC_TEASER_COOLDOWN_MS) || 60 * 60 * 1000;
const { buildOpportunityRadar } = require('./opportunityRadar');
const { getState, saveState } = require('../database/opportunityTeaser');

function stateOf(row) {
  if (!row) return 'WEAK';
  if (row.ready || row.passed >= row.total) return 'CONFIRMED';
  if (row.passed === 5) return 'ALMOST_READY';
  if (row.passed === 4) return 'FORMING';
  return 'WEAK';
}

function finiteLevel(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function executionLevels(row) {
  return {
    entry: finiteLevel(row.entry ?? row.signal?.entry ?? row.levels?.entry),
    sl: finiteLevel(row.sl ?? row.stop_loss ?? row.signal?.sl ?? row.levels?.sl ?? row.levels?.stop_loss),
    tp1: finiteLevel(row.tp1 ?? row.target1 ?? row.signal?.tp1 ?? row.levels?.tp1),
    tp2: finiteLevel(row.tp2 ?? row.target2 ?? row.signal?.tp2 ?? row.levels?.tp2)
  };
}

function validExecution(direction, levels) {
  if (!['BUY', 'SELL'].includes(direction)) return false;
  const { entry, sl, tp1, tp2 } = levels;
  if (![entry, sl, tp1, tp2].every(Number.isFinite)) return false;
  if (direction === 'BUY') return sl < entry && tp1 > entry && tp2 > tp1;
  return sl > entry && tp1 < entry && tp2 < tp1;
}

async function runOpportunityTeaser(bot) {
  if (!config.mainGroupId) return;
  const rows = await buildOpportunityRadar();

  for (const row of rows) {
    const pair = String(row.pair).toUpperCase();
    const currentState = stateOf(row);
    const direction = String(row.direction || '').toUpperCase();
    const previous = getState(pair);
    const previousState = String(previous?.last_state || 'NONE');
    const previousDirection = String(previous?.last_direction || '').toUpperCase();

    let effectiveState = currentState;
    const wasDeveloping = previousState === 'FORMING' || previousState === 'ALMOST_READY';
    const directionChanged = previousDirection && direction && previousDirection !== direction;
    if (wasDeveloping && (currentState === 'WEAK' || directionChanged)) effectiveState = 'CANCELLED';

    let message = null;

    if (effectiveState === 'ALMOST_READY' && previousState !== 'ALMOST_READY') {
      console.log(`🔕 PUBLIC 5/6 SUPPRESSED | ${pair}`);
    }

    if (effectiveState === 'CONFIRMED' && previousState !== 'CONFIRMED') {
      const confirmedDirection = String(direction || row.direction || '').toUpperCase();
      const levels = executionLevels(row);
      const hasValidLevels = validExecution(confirmedDirection, levels);
      let vipSent = false;

      if (!hasValidLevels) {
        // Never persist a technical 6/6 as CONFIRMED until executable levels exist.
        // WAIT_EXECUTION_LEVELS also makes the next radar cycle retry automatically.
        effectiveState = 'WAIT_EXECUTION_LEVELS';
        console.log(`⏳ RADAR WAITING FOR VALID EXECUTION LEVELS | ${pair}`, {
          direction: confirmedDirection,
          entry: levels.entry,
          sl: levels.sl,
          tp1: levels.tp1,
          tp2: levels.tp2
        });
      } else if (config.vipChannelId) {
        const { entry, sl, tp1, tp2 } = levels;
        const vipMessage = `🔥 فرصة مكتملة — VIP\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n${confirmedDirection === 'BUY' ? '📈 BUY' : '📉 SELL'}\n\n██████ 6/6\n\n⭐ AI Score:\n${Number(row.score || 0).toFixed(0)}/100\n\n💰 Entry:\n${entry}\n\n🛑 Stop Loss:\n${sl}\n\n🎯 TP1:\n${tp1}\n\n🏆 TP2:\n${tp2}\n\n✅ جميع شروط التأكيد الفني ومستويات التنفيذ اكتملت.\n\n⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
        try {
          await bot.telegram.sendMessage(config.vipChannelId, vipMessage);
          vipSent = true;
          console.log(`💎 VIP RADAR CONFIRMED SENT | ${pair} | ${confirmedDirection}`);
        } catch (error) {
          // Do not mark as CONFIRMED when Telegram delivery failed; retry next cycle.
          effectiveState = 'READY_SEND_RETRY';
          console.log(`❌ VIP Radar send failed ${pair}:`, error.message);
        }
      } else {
        effectiveState = 'READY_SEND_RETRY';
        console.log(`⚠️ VIP CHANNEL NOT CONFIGURED | ${pair} | confirmed opportunity retained for retry`);
      }

      if (vipSent) {
        message = `🔥 فرصة فنية اكتملت الآن\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n██████ 6/6\n\n⭐ AI Score:\n${Number(row.score || 0).toFixed(0)}/100\n\n✅ اكتمل التأكيد الفني.\n\n💎 تم إرسال تفاصيل الفرصة لأعضاء VIP.\n\n🔒 Direction\n🔒 Entry\n🔒 Stop Loss\n🔒 TP1\n🔒 TP2\n\n🚀 /vip\n\n⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
      }
    }

    if (effectiveState === 'CANCELLED' && previousState !== 'CANCELLED') {
      message = null;
      console.log(`🔕 PUBLIC CANCEL SUPPRESSED | ${pair}`);
    }

    if (message) {
      try {
        await bot.telegram.sendMessage(config.mainGroupId, message);
        console.log(`📣 PUBLIC RADAR TEASER | ${pair} | ${effectiveState}`);
      } catch (error) {
        console.log('Opportunity teaser send error:', error.message);
      }
    }

    saveState(pair, effectiveState, direction, row.score, Boolean(message));
  }
}

module.exports = { runOpportunityTeaser };
