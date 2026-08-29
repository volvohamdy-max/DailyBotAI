const { Markup } = require('telegraf');
const config = require('../config');
const { findUser } = require('../database/users');
const { getTradingCommandCenterSnapshot, renderVipCommandCenter, renderAdminCommandCenter } = require('../services/tradingCommandCenter');

function isAdmin(ctx) { return (config.adminIds || []).map(String).includes(String(ctx.from?.id)); }
function languageOf(ctx) { return findUser(ctx.from?.id)?.language === 'en' ? 'en' : 'ar'; }
function isVip(ctx) { return isAdmin(ctx) || Boolean(findUser(ctx.from?.id)?.is_vip); }

function vipKeyboard(language) {
  return Markup.inlineKeyboard([[Markup.button.callback(language === 'en' ? '🔄 Refresh' : '🔄 تحديث مباشر', 'command_center_vip_refresh')]]);
}
function adminKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث مباشر', 'command_center_admin_refresh')]]);
}

async function sendVip(ctx, edit = false) {
  const language = languageOf(ctx);
  if (!isVip(ctx)) return ctx.reply(language === 'en' ? '💎 This feature is available to VIP members.' : '💎 مركز ذكاء السوق متاح لأعضاء VIP.');
  const snapshot = await getTradingCommandCenterSnapshot();
  const text = renderVipCommandCenter(snapshot, language);
  if (edit) return ctx.editMessageText(text, vipKeyboard(language)).catch(() => ctx.reply(text, vipKeyboard(language)));
  return ctx.reply(text, vipKeyboard(language));
}

async function sendAdmin(ctx, edit = false) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('غير مصرح').catch(() => null);
  const snapshot = await getTradingCommandCenterSnapshot();
  const text = renderAdminCommandCenter(snapshot);
  if (edit) return ctx.editMessageText(text, adminKeyboard()).catch(() => ctx.reply(text, adminKeyboard()));
  return ctx.reply(text, adminKeyboard());
}

function registerTradingCommandCenter(bot) {
  bot.command('center', ctx => sendVip(ctx));
  bot.hears(['🧠 مركز ذكاء السوق', '🧠 Market Intelligence'], ctx => sendVip(ctx));
  bot.action('command_center_vip_refresh', async ctx => { await ctx.answerCbQuery('🔄').catch(() => null); return sendVip(ctx, true); });
  bot.action('admin_command_center', async ctx => { await ctx.answerCbQuery().catch(() => null); return sendAdmin(ctx); });
  bot.action('command_center_admin_refresh', async ctx => { await ctx.answerCbQuery('🔄').catch(() => null); return sendAdmin(ctx, true); });
}

module.exports = registerTradingCommandCenter;
