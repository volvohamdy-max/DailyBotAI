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
    timeZone:
      process.env.NEWS_TIMEZONE ||
      'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function isAdmin(id) {
  return (config.adminIds || [])
    .map(String)
    .includes(String(id));
}

function isVip(id) {
  const user = findUser(id);

  if (!user) return false;

  const vip =
    Number(user.is_vip) === 1 ||
    user.is_vip === true;

  if (!vip) return false;

  const expiry =
    user.vip_expires_at ||
    user.vip_expire ||
    null;

  if (!expiry) return true;

  const date = new Date(expiry);

  if (Number.isNaN(date.getTime())) {
    return true;
  }

  return date.getTime() > Date.now();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function featureFromContext(ctx) {
  const text =
    normalizeText(ctx.message?.text);

  if (!text) return null;

  // =========================
  // Slash Commands
  // =========================

  if (text.startsWith('/trade')) {
    return 'trade_now';
  }

  if (
    text.startsWith('/analysis') ||
    text.startsWith('/gold')
  ) {
    return 'analysis';
  }

  if (text.startsWith('/scanner')) {
    return 'scanner';
  }

  if (text.startsWith('/trend')) {
    return 'trend_hunter';
  }

  if (text.startsWith('/map')) {
    return 'market_map';
  }

  if (text.startsWith('/news')) {
    return 'news';
  }

  if (text.startsWith('/alerts')) {
    return 'alerts';
  }

  // =========================
  // Keyboard Features
  // =========================

  if (
    text.includes('صفقة الآن') ||
    text.includes('trade now')
  ) {
    return 'trade_now';
  }

  if (
    text.includes('أفضل صفقة') ||
    text.includes('أفضل فرصة') ||
    text.includes('best trade') ||
    text.includes('best opportunity')
  ) {
    return 'best_opportunity';
  }

  if (
    text.includes('smart scanner')
  ) {
    return 'scanner';
  }

  if (
    text === '📈 تحليل' ||
    text === '📈 analysis' ||
    text === 'analysis'
  ) {
    return 'analysis';
  }

  if (
    text.includes('signal lab')
  ) {
    return 'signal_lab';
  }

  if (
    text.includes('trend hunter') ||
    text.includes('صياد الترند')
  ) {
    return 'trend_hunter';
  }

  if (
    text.includes('market map') ||
    text.includes('خريطة السوق')
  ) {
    return 'market_map';
  }

  if (
    text === '🔔 التنبيهات' ||
    text === '🔔 alerts'
  ) {
    return 'alerts';
  }

  return null;
}

function featureArabic(feature) {
  const map = {
    trade_now: '⚡ صفقة الآن',
    best_opportunity: '🏆 أفضل فرصة',
    scanner: '🔎 Smart Scanner',
    analysis: '📈 التحليل',
    signal_lab: '🧪 AI Signal Lab',
    trend_hunter: '🔥 Trend Hunter',
    market_map: '🗺️ Market Map',
    news: '📰 الأخبار',
    alerts: '🔔 التنبيهات'
  };

  return map[feature] || feature;
}

function consumeFeature(userId, feature) {
  ensureTable();

  if (isAdmin(userId)) {
    return {
      allowed: true,
      unlimited: true,
      reason: 'ADMIN'
    };
  }

  if (isVip(userId)) {
    return {
      allowed: true,
      unlimited: true,
      reason: 'VIP'
    };
  }

  // Market Map is a one-time lifetime preview for FREE users.
  // It is intentionally independent from the daily free-limit switch.
  if (String(feature) === 'market_map') {
    const result = db.prepare(`
      INSERT OR IGNORE INTO one_time_feature_usage
        (telegram_id, feature)
      VALUES (?, ?)
    `).run(
      String(userId),
      'market_map'
    );

    if (Number(result.changes) === 1) {
      return {
        allowed: true,
        unlimited: false,
        firstUse: true,
        oneTime: true
      };
    }

    return {
      allowed: false,
      unlimited: false,
      reason: 'ONE_TIME_LIMIT'
    };
  }

  if (
    !getBoolSetting(
      'free_daily_limit_enabled',
      false
    )
  ) {
    return {
      allowed: true,
      unlimited: true,
      reason: 'LIMIT_DISABLED'
    };
  }

  const day = todayKey();

  const result = db.prepare(`
    INSERT OR IGNORE INTO daily_feature_usage
      (telegram_id, feature, usage_date)
    VALUES (?, ?, ?)
  `).run(
    String(userId),
    String(feature),
    day
  );

  if (Number(result.changes) === 1) {
    return {
      allowed: true,
      unlimited: false,
      firstUse: true
    };
  }

  return {
    allowed: false,
    unlimited: false,
    reason: 'DAILY_LIMIT'
  };
}

function limitMessage(feature, en = false) {
  const name =
    featureArabic(feature);

  if (String(feature) === 'market_map') {
    if (en) {
      return `🔒 Free Market Map preview used\n\nYou have already used your one free ${name} preview.\n\n💎 VIP members have unlimited access to Market Map and all trading and analysis tools.\n\nUpgrade to VIP to use Market Map again.`;
    }

    return `🔒 تم استخدام تجربة خريطة السوق المجانية\n\nلقد استخدمت ${name} المجانية مرة واحدة بالفعل.\n\n💎 مشتركو VIP يمكنهم استخدام خريطة السوق وجميع أدوات التداول والتحليل بدون حدود.\n\nاشترك VIP لاستخدام خريطة السوق مرة أخرى.`;
  }

  if (en) {
    return `🔒 Free daily limit reached\n\nYou already used ${name} today.\n\n💎 VIP members have unlimited access to all trading and analysis tools.\n\nUpgrade to VIP to continue using this feature today.`;
  }

  return `🔒 تم استهلاك الاستخدام المجاني اليومي\n\nلقد استخدمت:\n${name}\n\nمرة بالفعل اليوم.\n\n💎 مشتركو VIP يمكنهم استخدام جميع أدوات التداول والتحليل بدون حدود.\n\nاشترك VIP لاستخدام الميزة مرة أخرى اليوم.`;
}

function dailyUsageMiddleware() {
  return async (ctx, next) => {
    try {
      // Prevent double counting if registered
      // from more than one command module.
      if (ctx.state?.dailyUsageChecked) {
        return next();
      }

      const feature =
        featureFromContext(ctx);

      if (!feature) {
        return next();
      }

      if (!ctx.state) {
        ctx.state = {};
      }

      ctx.state.dailyUsageChecked = true;

      const result =
        consumeFeature(
          ctx.from?.id,
          feature
        );

      if (result.allowed) {
        return next();
      }

      const user =
        findUser(ctx.from?.id);

      const en =
        user?.language === 'en';

      return ctx.reply(
        limitMessage(feature, en),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    en
                      ? '💎 Upgrade to VIP'
                      : '💎 اشترك VIP',
                  callback_data:
                    'vip_monthly'
                }
              ]
            ]
          }
        }
      );

    } catch (error) {
      console.log(
        '⚠️ Daily Usage Gate:',
        error.message
      );

      // Never crash the bot because of the gate.
      return next();
    }
  };
}

module.exports = {
  ensureTable,
  consumeFeature,
  dailyUsageMiddleware,
  featureFromContext,
  limitMessage
};
