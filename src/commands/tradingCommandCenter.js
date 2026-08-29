const { Markup } = require('telegraf');
const config = require('../config');
const { findUser } = require('../database/users');
const { getStats: getPerformanceStats } = require('../database/performance');
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
function publicStatsKeyboard(language) {
  return Markup.inlineKeyboard([[Markup.button.callback(language === 'en' ? '🔄 Refresh results' : '🔄 تحديث النتائج', 'public_bot_stats_refresh')]]);
}

function renderPublicStats(stats, language) {
  const total = Number(stats?.total || 0);
  const open = Number(stats?.open || 0);
  const wins = Number(stats?.winningPipTrades || 0);
  const losses = Number(stats?.losingPipTrades || 0);
  const breakeven = Number(stats?.breakevenPipTrades || 0);
  const closed = wins + losses + breakeven;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  if (language === 'en') return `📊 FOREX AI — BOT RESULTS\n━━━━━━━━━━━━━━━━━━\n🕒 Last 24 hours\n\n🚀 Trades opened: ${total}\n🟢 Winning trades: ${wins}\n🔴 Losing trades: ${losses}\n⚪ Breakeven: ${breakeven}\n⏳ Still open: ${open}\n✅ Closed trades: ${closed}\n\n🏆 Win rate: ${winRate}%\n\n💡 These are automatically recorded results from the bot's trade tracker.`;
  return `📊 FOREX AI — نتائج البوت\n━━━━━━━━━━━━━━━━━━\n🕒 خلال آخر 24 ساعة\n\n🚀 صفقات تم فتحها: ${total}\n🟢 صفقات رابحة: ${wins}\n🔴 صفقات خاسرة: ${losses}\n⚪ صفقات تعادل: ${breakeven}\n⏳ صفقات ما زالت مفتوحة: ${open}\n✅ صفقات مغلقة: ${closed}\n\n🏆 نسبة النجاح: ${winRate}%\n\n💡 النتائج مسجلة تلقائيًا من متابعة صفقات البوت.`;
}

async function sendPublicStats(ctx, edit = false) {
  const language = languageOf(ctx);
  let stats;
  try { stats = getPerformanceStats(1); }
  catch (error) {
    console.log('⚠️ PUBLIC BOT STATS:', error.message);
    const text = language === 'en' ? '⚠️ Results are temporarily unavailable.' : '⚠️ نتائج البوت غير متاحة مؤقتًا.';
    return edit ? ctx.editMessageText(text).catch(() => ctx.reply(text)) : ctx.reply(text);
  }
  const text = renderPublicStats(stats, language);
  if (edit) return ctx.editMessageText(text, publicStatsKeyboard(language)).catch(() => ctx.reply(text, publicStatsKeyboard(language)));
  return ctx.reply(text, publicStatsKeyboard(language));
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
  bot.command('center', ctx => isAdmin(ctx) ? sendAdmin(ctx) : sendVip(ctx));
  bot.hears(['🧠 مركز ذكاء السوق', '🧠 Market Intelligence'], ctx => sendVip(ctx));
  bot.hears(['📊 نتائج البوت', '📊 Bot Results'], ctx => sendPublicStats(ctx));
  bot.action('public_bot_stats_refresh', async ctx => { await ctx.answerCbQuery('🔄').catch(() => null); return sendPublicStats(ctx, true); });
  bot.action('command_center_vip_refresh', async ctx => { await ctx.answerCbQuery('🔄').catch(() => null); return sendVip(ctx, true); });
  bot.action('admin_command_center', async ctx => { await ctx.answerCbQuery().catch(() => null); return sendAdmin(ctx); });
  bot.action('command_center_admin_refresh', async ctx => { await ctx.answerCbQuery('🔄').catch(() => null); return sendAdmin(ctx, true); });
}

module.exports = registerTradingCommandCenter;
