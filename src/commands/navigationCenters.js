const config = require('../config');
const { findUser } = require('../database/users');
const {
  mainKeyboard,
  goldCenterKeyboard,
  tradingCenterKeyboard,
  marketKeyboard,
  advancedToolsKeyboard,
  alertsKeyboard,
  accountKeyboard
} = require('../keyboards/main');

function lang(ctx) {
  const user = findUser(ctx.from?.id);
  return user?.language === 'en' ? 'en' : 'ar';
}

function flags(ctx) {
  const user = findUser(ctx.from?.id);
  const isAdmin = (config.adminIds || []).map(String).includes(String(ctx.from?.id));
  return { isAdmin, isVip: Boolean(user?.is_vip) };
}

function registerNavigationCenters(bot) {
  bot.hears(['🥇 مركز الذهب', '🥇 Gold Center'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '🥇 Gold Center\nChoose a gold tool:' : '🥇 مركز الذهب\nاختر الخدمة المطلوبة:', goldCenterKeyboard(l));
  });

  bot.hears(['⚡ مركز التداول', '⚡ Trading Center'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '⚡ Trading Center\nChoose a trading tool:' : '⚡ مركز التداول\nاختر أداة التداول:', tradingCenterKeyboard(l));
  });

  bot.hears(['📊 مركز السوق', '📊 Market Center', '📊 السوق', '📊 Markets'], ctx => {
    const l = lang(ctx);
    const { isAdmin, isVip } = flags(ctx);
    return ctx.reply(l === 'en' ? '📊 Market Center' : '📊 مركز السوق', marketKeyboard(l, isAdmin, isVip));
  });

  bot.hears(['🧠 أدوات متقدمة', '🧠 Advanced Tools'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '🧠 Advanced Tools' : '🧠 الأدوات المتقدمة', advancedToolsKeyboard(l));
  });

  bot.hears(['🔙 رجوع للسوق', '🔙 Back to Market'], ctx => {
    const l = lang(ctx);
    const { isAdmin, isVip } = flags(ctx);
    return ctx.reply(l === 'en' ? '📊 Market Center' : '📊 مركز السوق', marketKeyboard(l, isAdmin, isVip));
  });

  // Center labels are deliberately different from the actual Alerts action
  // so the navigation handler does not swallow the inner button.
  bot.hears(['🔔 مركز التنبيهات', '🔔 Alerts Center'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '🔔 Alerts Center' : '🔔 مركز التنبيهات', alertsKeyboard(l));
  });

  // Center labels are deliberately different from the actual account details
  // button (👤 حسابي / 👤 My Account) to avoid a handler collision.
  bot.hears(['👤 مركز الحساب', '👤 Account Center'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '👤 Account Center' : '👤 مركز الحساب', accountKeyboard(l));
  });

  // Backward compatibility with keyboards already visible on Telegram.
  // Old main-menu labels still open their centers until the next keyboard refresh.
  bot.hears(['👤 حسابي', '👤 My Account'], ctx => {
    const l = lang(ctx);
    return ctx.reply(l === 'en' ? '👤 Account Center' : '👤 مركز الحساب', accountKeyboard(l));
  });

  bot.hears(['🔙 رجوع', '🔙 Back'], ctx => {
    const l = lang(ctx);
    const { isAdmin, isVip } = flags(ctx);
    return ctx.reply(l === 'en' ? '📋 Main menu' : '📋 القائمة الرئيسية', mainKeyboard(l, isAdmin, isVip));
  });
}

module.exports = registerNavigationCenters;
