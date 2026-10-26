const db = require('../database/db');
const config = require('../config');
const { findUser } = require('../database/users');
const { getBoolSetting } = require('../database/adminControl');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_feature_usage (
      telegram_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (telegram_id, feature, usage_date)
    );

    CREATE TABLE IF NOT EXISTS one_time_feature_usage (
      telegram_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (telegram_id, feature)
    );
  `);
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.NEWS_TIMEZONE || 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function isAdmin(id) {
  return (config.adminIds || []).map(String).includes(String(id));
}

function isVip(id) {
  const user = findUser(id);
  if (!user) return false;
  const vip = Number(user.is_vip) === 1 || user.is_vip === true;
  if (!vip) return false;
  const expiry = user.vip_expires_at || user.vip_expire || null;
  if (!expiry) return true;
  const date = new Date(expiry);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function featureFromContext(ctx) {
  const text = normalizeText(ctx.message?.text);
  if (!text) return null;

  if (text.startsWith('/trade')) return 'trade_now';
  if (text.startsWith('/analysis')) return 'analysis';
  if (text.startsWith('/scanner')) return 'scanner';
  if (text.startsWith('/trend')) return 'trend_hunter';
  if (text.startsWith('/map')) return 'market_map';
  if (text.startsWith('/news')) return 'news';
  if (text.startsWith('/alerts')) return 'alerts';

  // Gold free daily previews — each tool has its own daily allowance.
  if (text.includes('خطة الذهب اليومية') || text.includes('daily gold plan')) return 'gold_daily_plan';
  if (text.includes('تحليل الذهب') || text.includes('gold analysis')) return 'gold_analysis';
  if (text.includes('صفقات الذهب المتاحة') || text.includes('available gold trades')) return 'gold_available_trades';
  if (text.includes('دعم ومقاومة الذهب') || text.includes('gold support & resistance')) return 'gold_support_resistance';

  if (text.includes('صفقة الآن') || text.includes('trade now')) return 'trade_now';
  if (text.includes('أفضل صفقة') || text.includes('أفضل فرصة') || text.includes('best trade') || text.includes('best opportunity')) return 'best_opportunity';
  if (text.includes('smart scanner')) return 'scanner';
  if (text === '📈 تحليل' || text === '📈 analysis' || text === 'analysis') return 'analysis';
  if (text.includes('signal lab')) return 'signal_lab';
  if (text.includes('trend hunter') || text.includes('صياد الترند')) return 'trend_hunter';
  if (text.includes('market map') || text.includes('خريطة السوق')) return 'market_map';
  if (text === '🔔 التنبيهات' || text === '🔔 alerts') return 'alerts';
  return null;
}

function featureArabic(feature) {
  const map = {
    gold_daily_plan: '🎯 خطة الذهب اليومية',
    gold_analysis: '🥇 تحليل الذهب',
    gold_available_trades: '💰 صفقات الذهب المتاحة',
    gold_support_resistance: '🧱 دعم ومقاومة الذهب',
    trade_now: '⚡ صفقة الآن', best_opportunity: '🏆 أفضل فرصة', scanner: '🔎 Smart Scanner',
    analysis: '📈 التحليل', signal_lab: '🧪 AI Signal Lab', trend_hunter: '🔥 Trend Hunter',
    market_map: '🗺️ Market Map', news: '📰 الأخبار', alerts: '🔔 التنبيهات'
  };
  return map[feature] || feature;
}

const ALWAYS_DAILY_FREE = new Set([
  'gold_daily_plan',
  'gold_analysis',
  'gold_available_trades',
  'gold_support_resistance'
]);

function hasDailyUsage(userId, feature) {
  ensureTable();
  const row = db.prepare(`
    SELECT 1 FROM daily_feature_usage
    WHERE telegram_id = ? AND feature = ? AND usage_date = ?
    LIMIT 1
  `).get(String(userId), String(feature), todayKey());
  return Boolean(row);
}

function markDailyUsage(userId, feature) {
  ensureTable();
  db.prepare(`
    INSERT OR IGNORE INTO daily_feature_usage (telegram_id, feature, usage_date)
    VALUES (?, ?, ?)
  `).run(String(userId), String(feature), todayKey());
}

function checkFeature(userId, feature) {
  ensureTable();
  if (isAdmin(userId)) return { allowed: true, unlimited: true, reason: 'ADMIN' };
  if (isVip(userId)) return { allowed: true, unlimited: true, reason: 'VIP' };

  if (String(feature) === 'market_map') {
    const row = db.prepare(`SELECT 1 FROM one_time_feature_usage WHERE telegram_id = ? AND feature = ? LIMIT 1`)
      .get(String(userId), 'market_map');
    return row ? { allowed: false, reason: 'ONE_TIME_LIMIT' } : { allowed: true, oneTime: true };
  }

  const limited = ALWAYS_DAILY_FREE.has(String(feature)) || getBoolSetting('free_daily_limit_enabled', false);
  if (!limited) return { allowed: true, unlimited: true, reason: 'LIMIT_DISABLED' };
  if (hasDailyUsage(userId, feature)) return { allowed: false, unlimited: false, reason: 'DAILY_LIMIT' };
  return { allowed: true, unlimited: false, firstUse: true };
}

function commitFeatureUsage(userId, feature) {
  if (isAdmin(userId) || isVip(userId)) return;
  if (String(feature) === 'market_map') {
    ensureTable();
    db.prepare(`INSERT OR IGNORE INTO one_time_feature_usage (telegram_id, feature) VALUES (?, ?)`)
      .run(String(userId), 'market_map');
    return;
  }
  const limited = ALWAYS_DAILY_FREE.has(String(feature)) || getBoolSetting('free_daily_limit_enabled', false);
  if (limited) markDailyUsage(userId, feature);
}

// Backward-compatible helper for callers that explicitly want check+consume.
function consumeFeature(userId, feature) {
  const result = checkFeature(userId, feature);
  if (result.allowed) commitFeatureUsage(userId, feature);
  return result;
}

function limitMessage(feature, en = false) {
  const name = featureArabic(feature);
  if (String(feature) === 'market_map') {
    return en
      ? `🔒 Free Market Map preview used\n\nYou have already used your one free ${name} preview.\n\n💎 VIP members have unlimited access.`
      : `🔒 تم استخدام تجربة خريطة السوق المجانية\n\nلقد استخدمت ${name} المجانية مرة واحدة بالفعل.\n\n💎 مشتركو VIP لديهم استخدام غير محدود.`;
  }
  return en
    ? `🔒 Free daily use already used\n━━━━━━━━━━━━━━━━━━\n\nYou already used today's free access to ${name}.\n\n⏰ Free access resets with the new day in Cairo time.\n💎 VIP unlocks unlimited access and premium Gold tools.`
    : `🔒 استخدمت التجربة المجانية لليوم\n━━━━━━━━━━━━━━━━━━\n\nاستخدمت الاستخدام المجاني اليومي لأداة ${name} بالفعل.\n\n⏰ الاستخدام المجاني بيتجدد مع اليوم الجديد بتوقيت القاهرة.\n💎 VIP يفتح استخدام غير محدود + رادار مناطق الذهب + أفضل صفقة ذهب + اختبر صفقتك + Trade Copilot + تنبيهات فرص VIP.\n\n👇 اشترك VIP للوصول الكامل.`;
}

function dailyUsageMiddleware() {
  return async (ctx, next) => {
    try {
      if (ctx.state?.dailyUsageChecked) return next();
      const feature = featureFromContext(ctx);
      if (!feature) return next();
      if (!ctx.state) ctx.state = {};
      ctx.state.dailyUsageChecked = true;

      const result = checkFeature(ctx.from?.id, feature);
      if (!result.allowed) {
        const user = findUser(ctx.from?.id);
        const en = user?.language === 'en';
        return ctx.reply(limitMessage(feature, en), {
          reply_markup: { inline_keyboard: [[{
            text: en ? '💎 Upgrade to VIP' : '💎 اشترك VIP',
            callback_data: 'vip_monthly'
          }]] }
        });
      }

      // IMPORTANT: do not burn the free use before the feature handler runs.
      // Handlers can call ctx.state.commitDailyUsage() only after they have
      // successfully produced the requested result. For legacy handlers that
      // do not call it yet, no usage is consumed rather than falsely blocking
      // a user's first attempt.
      ctx.state.dailyUsageFeature = feature;
      ctx.state.commitDailyUsage = () => {
        if (ctx.state.dailyUsageCommitted) return;
        commitFeatureUsage(ctx.from?.id, feature);
        ctx.state.dailyUsageCommitted = true;
      };

      return next();
    } catch (error) {
      console.log('⚠️ Daily Usage Gate:', error.message);
      return next();
    }
  };
}

module.exports = {
  ensureTable,
  consumeFeature,
  checkFeature,
  commitFeatureUsage,
  dailyUsageMiddleware,
  featureFromContext,
  limitMessage
};
