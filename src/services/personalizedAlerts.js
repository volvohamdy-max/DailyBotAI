const { scanMarkets } = require('./smartScannerShared');
const {
  getEligibleAlertUsers,
  getRecentAlertCooldownMap,
  recordAlert
} = require('../database/alertPreferences');

const MIN_SMART_SCORE = 70;
const COOLDOWN_MINUTES = 30;
const SEND_CONCURRENCY = Math.max(1, Number(process.env.VIP_ALERT_SEND_CONCURRENCY) || 8);
const SEND_BATCH_PAUSE_MS = Math.max(0, Number(process.env.VIP_ALERT_BATCH_PAUSE_MS) || 250);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function runPool(jobs, worker, concurrency) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      await worker(jobs[index], index);
    }
  });
  await Promise.all(runners);
}

async function runPersonalizedAlerts(bot) {
  const users = getEligibleAlertUsers().filter(
    (user) => user.enabled && user.pairs.length > 0
  );

  if (!users.length) {
    console.log('🔕 No eligible users have alerts enabled');
    return;
  }

  // Market analysis is shared once per cycle regardless of VIP count.
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

  // One DB query for cooldown state instead of N x M lookups.
  const cooldownMap = getRecentAlertCooldownMap(COOLDOWN_MINUTES);
  const jobs = [];

  for (const user of users) {
    for (const opportunity of opportunities) {
      if (!user.pairs.includes(opportunity.pair)) continue;

      const confidence = Number(opportunity.confidence);
      if (confidence < Number(user.min_confidence)) continue;

      const cooldownKey = `${String(user.telegram_id)}|${opportunity.pair}|${opportunity.action}`;
      if (cooldownMap.has(cooldownKey)) continue;

      // Reserve locally so duplicate opportunities in the same cycle cannot double-send.
      cooldownMap.set(cooldownKey, new Date().toISOString());
      jobs.push({ user, opportunity, confidence });
    }
  }

  if (!jobs.length) {
    console.log(`🟡 Personalized alerts: ${users.length} VIP user(s), no deliverable jobs after preferences/cooldowns`);
    return;
  }

  console.log(
    `📨 VIP alert fanout: users=${users.length} | jobs=${jobs.length} | concurrency=${SEND_CONCURRENCY}`
  );

  let sent = 0;
  let failed = 0;

  await runPool(jobs, async ({ user, opportunity, confidence }, index) => {
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
      failed++;
      console.log(
        `❌ Personalized alert failed ${user.telegram_id}:`,
        error.response?.description || error.message
      );
    }

    // Gentle pacing for large fan-outs to avoid Telegram burst pressure.
    if (SEND_BATCH_PAUSE_MS > 0 && (index + 1) % SEND_CONCURRENCY === 0) {
      await sleep(SEND_BATCH_PAUSE_MS);
    }
  }, SEND_CONCURRENCY);

  console.log(
    `✅ Personalized alerts finished: sent=${sent} | failed=${failed} | VIP=${users.length}`
  );
}

module.exports = {
  runPersonalizedAlerts
};
