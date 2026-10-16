const cron = require('node-cron');
const config = require('../config');
const dailyBrief = require('./dailyNewsBriefService');

const TZ = 'Africa/Cairo';
const originalStart = dailyBrief.startDailyNewsBrief;

function cairoHour() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

function todayLabel() {
  return new Date().toLocaleDateString('ar-EG', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

async function ensureTodayBrief(bot) {
  const target = config.mainGroupId != null && String(config.mainGroupId).trim()
    ? String(config.mainGroupId).trim()
    : null;
  if (!target || cairoHour() < 8) return false;

  try {
    const chat = await bot.telegram.getChat(target);
    const pinned = chat?.pinned_message;
    const text = String(pinned?.text || pinned?.caption || '');
    const isDailyBrief = text.includes('أهم الأخبار الاقتصادية اليوم');
    const isToday = text.includes(todayLabel());

    if (pinned?.message_id && isDailyBrief && isToday) return true;

    console.log('🛠️ Daily brief watchdog: today brief missing/not pinned; rebuilding now');
    await dailyBrief.sendDailyNewsBrief(bot, { force: true });

    const verify = await bot.telegram.getChat(target);
    const verifyText = String(verify?.pinned_message?.text || verify?.pinned_message?.caption || '');
    const ok = verifyText.includes('أهم الأخبار الاقتصادية اليوم') && verifyText.includes(todayLabel());
    console.log(ok ? '✅ Daily brief watchdog restored today pinned brief' : '⚠️ Daily brief watchdog sent brief but pin verification failed');
    return ok;
  } catch (error) {
    console.log('❌ Daily brief watchdog error:', error.message);
    return false;
  }
}

dailyBrief.startDailyNewsBrief = function reliableDailyNewsBrief(bot) {
  originalStart(bot);

  // Re-check every 5 minutes after 08:00. This repairs cases where the 08:00
  // cron was missed, the DB says "sent" but the message disappeared, or a
  // different message replaced the daily brief as the current pin.
  cron.schedule('*/5 8-23 * * *', () => {
    ensureTodayBrief(bot).catch((error) =>
      console.log('❌ Daily brief watchdog cycle error:', error.message)
    );
  }, { timezone: TZ });

  // Also repair immediately after a restart/deploy that happens after 08:00.
  setTimeout(() => {
    ensureTodayBrief(bot).catch((error) =>
      console.log('❌ Daily brief startup repair error:', error.message)
    );
  }, 20000);

  console.log('🛡️ Daily economic brief watchdog READY | verify pin every 5m after 08:00 Cairo');
};

module.exports = dailyBrief;
