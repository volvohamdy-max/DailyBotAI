const config = require('../config');
const { findUser } = require('../database/users');
const { vipKeyboard } = require('../keyboards/main');
const { consumeFeature } = require('../services/dailyUsageGate');

// Premium tools that stay VIP-only. These are the strongest conversion/value
// features and should not be consumed by the free preview gate.
const VIP_ONLY_TOOLS = new Set([
  '🚨 رادار مناطق الذهب', '🚨 Gold Zone Radar',
  '⭐ أفضل صفقة ذهب الآن', '⭐ Best Gold Trade Now',
  '🥇 اختبر صفقتك', '🥇 Check Your Trade',
  '🤖 راقب صفقتي', '🤖 Monitor My Trade',
  '⚡ صفقة الآن', '⚡ Trade Now',
  '🏆 أفضل فرصة', '🏆 Best Opportunity',
  '🏆 أفضل صفقة', '🏆 Best Trade'
]);

// Selected premium tools get one FREE use per day per feature. This lets new
// users experience real bot value without giving away the core VIP product.
const DAILY_PREVIEW_TOOLS = new Map([
  ['🎯 خطة الذهب اليومية', 'gold_daily_plan'],
  ['🎯 Daily Gold Plan', 'gold_daily_plan'],
  ['🥇 تحليل الذهب', 'gold_analysis'],
  ['🥇 Gold Analysis', 'gold_analysis'],
  ['💰 صفقات الذهب المتاحة', 'gold_available_trades'],
  ['💰 Available Gold Trades', 'gold_available_trades'],
  ['🧱 دعم ومقاومة الذهب', 'gold_levels'],
  ['🧱 Gold Support & Resistance', 'gold_levels']
]);

function activeVip(user) {
  if (!user || Number(user.is_vip) !== 1) return false;
  const expiry = user.vip_expires_at || user.vip_expire || null;
  if (!expiry) return true;
  const date = new Date(expiry);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function isVipOrAdmin(ctx) {
  const user = findUser(ctx.from?.id);
  const isAdmin = (config.adminIds || []).map(String).includes(String(ctx.from?.id));
  return isAdmin || activeVip(user);
}

function upgradeMessage(en, dailyPreview = false) {
  if (dailyPreview) {
    return en
      ? `🔒 FREE DAILY PREVIEW USED\n━━━━━━━━━━━━━━━━━━\n\nYou already used today's free preview for this tool.\n\n⏰ Your free use resets on the next Cairo day.\n💎 VIP unlocks unlimited use plus Gold Zone Radar, Best Gold Trade Now, Check Your Trade, Trade Copilot and VIP opportunity alerts.\n\n👇 Upgrade to VIP for full access.`
      : `🔒 استخدمت التجربة المجانية لليوم\n━━━━━━━━━━━━━━━━━━\n\nاستخدمت الاستخدام المجاني اليومي للأداة دي بالفعل.\n\n⏰ الاستخدام المجاني بيتجدد مع اليوم الجديد بتوقيت القاهرة.\n💎 VIP يفتح استخدام غير محدود + رادار مناطق الذهب + أفضل صفقة ذهب + اختبر صفقتك + Trade Copilot + تنبيهات فرص VIP.\n\n👇 اشترك VIP للوصول الكامل.`;
  }

  return en
    ? `💎 VIP FEATURE\n━━━━━━━━━━━━━━━━━━\n\nThis is one of the core VIP tools.\n\nVIP unlocks Gold Zone Radar, Best Gold Trade Now, Check Your Trade, Trade Copilot, premium trade tools and VIP opportunity alerts.\n\n👇 Choose a VIP plan to unlock it.`
    : `💎 ميزة VIP\n━━━━━━━━━━━━━━━━━━\n\nدي من الأدوات الأساسية المخصصة لمشتركي VIP.\n\nVIP يفتح رادار مناطق الذهب + أفضل صفقة ذهب + اختبر صفقتك + Trade Copilot + أدوات التداول الاحترافية + تنبيهات فرص VIP.\n\n👇 اختر باقة VIP لفتح الميزة.`;
}

module.exports = function vipCentersGate() {
  return async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();
    if (!text || isVipOrAdmin(ctx)) return next();

    const en = findUser(ctx.from?.id)?.language === 'en';

    if (VIP_ONLY_TOOLS.has(text)) {
      return ctx.reply(upgradeMessage(en, false), vipKeyboard());
    }

    const feature = DAILY_PREVIEW_TOOLS.get(text);
    if (!feature) return next();

    const result = consumeFeature(ctx.from?.id, feature);
    if (result.allowed) {
      if (!ctx.state) ctx.state = {};
      ctx.state.freePreviewFeature = feature;
      return next();
    }

    return ctx.reply(upgradeMessage(en, true), vipKeyboard());
  };
};
