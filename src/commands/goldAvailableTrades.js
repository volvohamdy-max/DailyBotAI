const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { getGoldTrade, getBestGoldTrade, formatGoldTrade } = require('../services/goldAvailableTrades');

function lang(ctx){const u=findUser(ctx.from?.id);return u?.language==='en'?'en':'ar';}
function menu(language='ar'){
  const en=language==='en';
  return Markup.inlineKeyboard([
    [Markup.button.callback(en?'⚡ Scalping':'⚡ سكالبينج','goldavail_scalp'),Markup.button.callback(en?'📊 Intraday':'📊 تداول يومي','goldavail_intraday')],
    [Markup.button.callback(en?'📈 Swing':'📈 سوينج','goldavail_swing'),Markup.button.callback(en?'🧭 Trend':'🧭 مع الاتجاه','goldavail_trend')],
    [Markup.button.callback(en?'🔄 Reversal':'🔄 انعكاس','goldavail_reversal')],
    [Markup.button.callback(en?'⭐ Best Gold Trade Now':'⭐ أفضل صفقة ذهب الآن','goldavail_best')]
  ]);
}
async function runType(ctx,type){
  const l=lang(ctx),en=l==='en';
  await ctx.answerCbQuery().catch(()=>null);
  await ctx.reply(en?'🔍 Analyzing gold now...':'🔍 جاري تحليل الذهب لحظيًا...');
  try{const result=await getGoldTrade(type);return ctx.reply(formatGoldTrade(result,l),menu(l));}
  catch(e){console.log(`❌ Available gold ${type}:`,e.message);return ctx.reply(en?'❌ Gold analysis is temporarily unavailable. Try again shortly.':'❌ تعذر تحليل الذهب مؤقتًا. جرّب مرة أخرى بعد قليل.',menu(l));}
}
module.exports=function registerGoldAvailableTrades(bot){
  bot.hears(['💰 صفقات الذهب المتاحة','💰 Available Gold Trades'],ctx=>{
    const l=lang(ctx);return ctx.reply(l==='en'?'🥇 AVAILABLE GOLD TRADES\n\nChoose the trade style you want, or let the bot select the strongest current setup.':'🥇 صفقات الذهب المتاحة\n\nاختار نوع الصفقة اللي عايزها، أو خلّي البوت يختار أقوى فرصة موجودة حاليًا.',menu(l));
  });
  for(const type of ['scalp','intraday','swing','trend','reversal'])bot.action(`goldavail_${type}`,ctx=>runType(ctx,type));
  bot.action('goldavail_best',async ctx=>{
    const l=lang(ctx),en=l==='en';await ctx.answerCbQuery().catch(()=>null);await ctx.reply(en?'⭐ Comparing all gold trade styles...':'⭐ جاري مقارنة كل أنواع صفقات الذهب...');
    try{const {best}=await getBestGoldTrade();if(!best)return ctx.reply(en?'🔍 No gold setup currently meets the required entry quality.\n\n⏳ No forced trade.':'🔍 لا توجد صفقة ذهب حاليًا تستوفي جودة الدخول المطلوبة.\n\n⏳ لن يتم إجبار صفقة.',menu(l));return ctx.reply((en?'⭐ BEST GOLD TRADE NOW\n\n':'⭐ أفضل صفقة ذهب الآن\n\n')+formatGoldTrade(best,l),menu(l));}
    catch(e){console.log('❌ Best available gold:',e.message);return ctx.reply(en?'❌ Unable to compare gold trades right now.':'❌ تعذر مقارنة صفقات الذهب حاليًا.',menu(l));}
  });
};