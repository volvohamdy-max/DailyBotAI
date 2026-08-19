const { scanMarkets } = require('./smartScannerShared');
const {
  getEligibleAlertUsers,
  canSendAlert,
  recordAlert
} = require('../database/alertPreferences');

const MIN_SMART_SCORE = 70;
const COOLDOWN_MINUTES = 30;

function buildMessage(opportunity, language) {
  const en = language === 'en';
  const directionEmoji = opportunity.action === 'BUY' ? '🟢' : '🔴';
  const confidence = Number(opportunity.confidence);

  if (en) {
    return `🚨 SMART MARKET ALERT
━━━━━━━━━━━━━━━━━━

💱 ${opportunity.pair}
${directionEmoji} ${opportunity.action}

⭐ Smart Score: ${Number(opportunity.score) || 0}/100
🤖 AI Confidence: ${Number.isFinite(confidence) ? `${confidence}%` : 'N/A'}

🔥 A market opportunity matched your alert settings.

━━━━━━━━━━━━━━━━━━
⚠️ Automated analysis reflects current conditions and does not guarantee profit.`;
  }

  return `🚨 تنبيه فرصة تداول
━━━━━━━━━━━━━━━━━━

💱 ${opportunity.pair}
${directionEmoji} ${opportunity.action}

⭐ Smart Score: ${Number(opportunity.score) || 0}/100
🤖 ثقة AI: ${Number.isFinite(confidence) ? `${confidence}%` : 'غير متاح'}

🔥 تم رصد فرصة مطابقة لإعدادات التنبيهات الخاصة بك.

━━━━━━━━━━━━━━━━━━
⚠️ التحليل آلي ويعكس حالة السوق الحالية ولا يضمن الربح.`;
}

async function runPersonalizedAlerts(bot) {
  const users = getEligibleAlertUsers().filter(
    (user) => user.enabled && user.pairs.length > 0
  );

  if (!users.length) {
    console.log('🔕 No eligible users have alerts enabled');
    return;
  }

  const results = await scanMarkets();

  if (!Array.isArray(results) || results.length === 0) {
    console.log('⚠️ Personalized alerts: scanner returned no results');
    return;
  }

  const opportunities = results.filter((item) =>
    item.freshThisCycle === true &&
    (item.action === 'BUY' || item.action === 'SELL') &&
    Number(item.score) >= MIN_SMART_SCORE &&
    Number.isFinite(Number(item.confidence))
  );

  if (!opportunities.length) {
    console.log('🟡 Personalized alerts: no qualifying fresh opportunities');
    return;
  }

  let sent = 0;

  for (const user of users) {
    for (const opportunity of opportunities) {
      if (!user.pairs.includes(opportunity.pair)) continue;

      const confidence = Number(opportunity.confidence);
      if (confidence < Number(user.min_confidence)) continue;

      if (!canSendAlert(
        user.telegram_id,
        opportunity.pair,
        opportunity.action,
        COOLDOWN_MINUTES
      )) {
        continue;
      }

      try {
        await bot.telegram.sendMessage(
          user.telegram_id,
          buildMessage(opportunity, user.language)
        );

        recordAlert(
          user.telegram_id,
          opportunity.pair,
          opportunity.action,
          opportunity.score,
          confidence
        );

        sent++;
      } catch (error) {
        console.log(
          `❌ Personalized alert failed ${user.telegram_id}:`,
          error.message
        );
      }
    }
  }

  console.log(`✅ Personalized alerts sent: ${sent}`);
}

module.exports = {
  runPersonalizedAlerts
};
