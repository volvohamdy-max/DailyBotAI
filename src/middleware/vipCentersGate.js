const config = require('../config');
const { findUser } = require('../database/users');
const { vipKeyboard } = require('../keyboards/main');

const VIP_CENTER_TOOLS = new Set([
  // Gold Center — premium execution / decision tools.
  '🎯 خطة الذهب اليومية', '🎯 Daily Gold Plan',
  '🚨 رادار مناطق الذهب', '🚨 Gold Zone Radar',
  '🥇 تحليل الذهب', '🥇 Gold Analysis',
  '💰 صفقات الذهب المتاحة', '💰 Available Gold Trades',
  '🧱 دعم ومقاومة الذهب', '🧱 Gold Support & Resistance',
  '⭐ أفضل صفقة ذهب الآن', '⭐ Best Gold Trade Now',
  '🥇 اختبر صفقتك', '🥇 Check Your Trade',
  '🤖 راقب صفقتي', '🤖 Monitor My Trade',

  // Trading Center — premium opportunity tools.
  '⚡ صفقة الآن', '⚡ Trade Now',
  '🏆 أفضل فرصة', '🏆 Best Opportunity',
  '🏆 أفضل صفقة', '🏆 Best Trade'
]);

function activeVip(user) {
  if (!user || Number(user.is_vip) !== 1) return false;
  if (!user.vip_expires_at) return true;
  const expiry = new Date(user.vip_expires_at).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

function isVipOrAdmin(ctx) {
  const user = findUser(ctx.from?.id);
  const isAdmin = (config.adminIds || []).map(String).includes(String(ctx.from?.id));
  return isAdmin || activeVip(user);
}

function lockedText(en, tool) {
  if (en) return `🔒 VIP FEATURE\n━━━━━━━━━━━━━━━━━━\n\n${tool || 'This tool'} is part of FOREX AI VIP.\n\n💎 VIP unlocks the premium Gold and trading decision tools, including Gold Zone Radar, Best Gold Trade, multi-timeframe Check Your Trade, Trade Copilot and advanced opportunity tools.\n\nYour subscription must be active to use premium tools.\n\n👇 Choose a VIP plan:`;

  return `🔒 ميزة VIP\n━━━━━━━━━━━━━━━━━━\n\n${tool || 'الأداة دي'} ضمن باقة FOREX AI VIP.\n\n💎 اشتراك VIP بيفتح أدوات الذهب والتداول الاحترافية، ومنها رادار مناطق الذهب، أفضل صفقة ذهب، اختبر صفقتك على عدة فريمات، Trade Copilot وأدوات الفرص المتقدمة.\n\nلازم يكون اشتراكك مفعل وساري علشان تستخدم الأدوات المدفوعة.\n\n👇 اختر باقة VIP:`;
}

module.exports = function vipCentersGate() {
  return async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();

    // Browsing the centers stays free. Only premium actions are gated.
    if (!VIP_CENTER_TOOLS.has(text) || isVipOrAdmin(ctx)) return next();

    const en = findUser(ctx.from?.id)?.language === 'en';
    return ctx.reply(lockedText(en, text), vipKeyboard());
  };
};
