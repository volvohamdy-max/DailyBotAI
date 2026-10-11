const config = require('../config');
const { findUser } = require('../database/users');
const { vipKeyboard } = require('../keyboards/main');

const VIP_CENTER_TOOLS = new Set([
  // Gold Center tools
  '🎯 خطة الذهب اليومية', '🎯 Daily Gold Plan',
  '🥇 تحليل الذهب', '🥇 Gold Analysis',
  '💰 صفقات الذهب المتاحة', '💰 Available Gold Trades',
  '🧱 دعم ومقاومة الذهب', '🧱 Gold Support & Resistance',
  '⭐ أفضل صفقة ذهب الآن', '⭐ Best Gold Trade Now',
  '🥇 اختبر صفقتك', '🥇 Check Your Trade',
  '🤖 راقب صفقتي', '🤖 Monitor My Trade',

  // Trading Center tools
  '⚡ صفقة الآن', '⚡ Trade Now',
  '🏆 أفضل فرصة', '🏆 Best Opportunity',
  '🏆 أفضل صفقة', '🏆 Best Trade'
]);

function isVipOrAdmin(ctx) {
  const user = findUser(ctx.from?.id);
  const isVip = Boolean(user && Number(user.is_vip) === 1);
  const isAdmin = (config.adminIds || []).map(String).includes(String(ctx.from?.id));
  return isVip || isAdmin;
}

module.exports = function vipCentersGate() {
  return async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();

    // The center buttons themselves remain open to everyone.
    if (!VIP_CENTER_TOOLS.has(text) || isVipOrAdmin(ctx)) {
      return next();
    }

    const en = findUser(ctx.from?.id)?.language === 'en';
    return ctx.reply(
      en
        ? `💎 VIP FEATURE\n━━━━━━━━━━━━━━━━━━\n\nThis tool is available to VIP members only.\n\nYou can open Gold Center and Trading Center normally, but using their trading and gold-analysis tools requires an active VIP subscription.\n\n👇 Choose a VIP plan to subscribe.`
        : `💎 ميزة VIP\n━━━━━━━━━━━━━━━━━━\n\nالأداة دي متاحة لأعضاء VIP فقط.\n\nتقدر تدخل مركز الذهب ومركز التداول وتشوف الأزرار عادي، لكن تشغيل أدوات الذهب والتداول الموجودة جواهم يحتاج اشتراك VIP مفعل.\n\n👇 اختر باقة VIP للاشتراك.`,
      vipKeyboard()
    );
  };
};
