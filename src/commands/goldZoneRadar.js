const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { buildRadar, formatRadar } = require('../services/goldZoneRadar');

function isVipOrAdmin(ctx) {
  const user = findUser(ctx.from?.id);
  const config = require('../config');
  return Boolean(user && Number(user.is_vip) === 1 && (!user.vip_expires_at || new Date(user.vip_expires_at).getTime() > Date.now()))
    || (config.adminIds || []).map(String).includes(String(ctx.from?.id));
}
function menu(en = false) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(en ? '🔄 Refresh radar' : '🔄 تحديث الرادار', 'goldzone_refresh')]
  ]);
}
function registerGoldZoneRadar(bot) {
  bot.hears(['🚨 رادار مناطق الذهب', '🚨 Gold Zone Radar'], async ctx => {
    const en = ctx.state?.language === 'en';
    if (!isVipOrAdmin(ctx)) {
      return ctx.reply(en ? '💎 This radar is available to VIP members only. Choose a plan to subscribe.' : '💎 رادار مناطق الذهب متاح لأعضاء VIP فقط. اختار باقة للاشتراك.', require('../keyboards/main').vipKeyboard());
    }
    await ctx.reply(en ? '🔍 Scanning gold zones on M5, M15 and H1...' : '🔍 جاري فحص مناطق الذهب على M5 وM15 وH1...');
    try {
      const result = await buildRadar();
      return ctx.reply(en ? formatRadar(result).replace('🚨 رادار مناطق الذهب الذكي — XAUUSD','🚨 GOLD ZONE RADAR — XAUUSD').replace('السعر اللحظي','Live price').replace('الاتجاه العام','Overall direction').replace('أقرب المناطق القوية','Nearest strong zones').replace('لا توجد منطقة قريبة كفاية','No sufficiently close zone').replace('دعم:','Support:').replace('مقاومة:','Resistance:').replace('لا يوجد دخول مؤكد الآن','No confirmed entry now').replace('توافق الفريمات','Timeframe alignment').replace('صاعد','Bullish').replace('هابط','Bearish').replace('محايد','Neutral') : formatRadar(result), menu(en));
    } catch (error) {
      console.log('❌ GOLD ZONE RADAR:', error.message);
      return ctx.reply(en ? '❌ Gold zone radar is temporarily unavailable. Try again shortly.' : '❌ تعذر فحص مناطق الذهب مؤقتًا. جرّب مرة أخرى بعد قليل.');
    }
  });
  bot.action('goldzone_refresh', async ctx => {
    await ctx.answerCbQuery();
    if (!isVipOrAdmin(ctx)) return ctx.reply('💎 الرادار متاح لأعضاء VIP فقط.', require('../keyboards/main').vipKeyboard());
    try {
      const result = await buildRadar();
      return ctx.editMessageText(formatRadar(result), menu(false)).catch(error => {
        if (String(error?.response?.description || error?.message || '').includes('message is not modified')) return;
        throw error;
      });
    } catch (error) {
      console.log('❌ GOLD ZONE RADAR REFRESH:', error.message);
      return ctx.reply('❌ تعذر تحديث الرادار مؤقتًا.');
    }
  });
}
module.exports = registerGoldZoneRadar;
