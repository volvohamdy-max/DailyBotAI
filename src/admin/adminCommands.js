const { adminV21Keyboard } = require('../keyboards/adminV21');
const { requireAdmin } = require('../utils/auth');
const { funnelText } = require('../services/promoAnalytics');
const {
    countUsers,
    allUsers,
    addVip,
    removeVip,
    addPoints,
    findUser,
    getStats
} = require('../database/users');
const config = require('../config');
async function sendToAll(ctx, message, vipOnly = false) {
  const users = allUsers({ vipOnly });
  let sent = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.telegram_id, message);
      sent += 1;
    } catch (error) {
      console.error(`Send failed to ${user.telegram_id}:`, error.message);
    }
  }
  return sent;
}

function registerAdminCommands(bot) {
  bot.command('admin', (ctx) => {
    if (!requireAdmin(ctx)) return;
    return ctx.reply('🎛️ FOREX AI — Admin Control Center V2.1', adminV21Keyboard());
  });
bot.action('admin_stats', (ctx) => {

    if(!requireAdmin(ctx)) return;

    const s = getStats();

    return ctx.reply(
`📊 إحصائيات البوت

👥 إجمالي المستخدمين: ${s.total}

💎 مشتركي VIP: ${s.vip}

🎁 مجموع النقاط: ${s.points}`
    );

});

  bot.command('promo', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const days = Number(String(ctx.message?.text || '').split(' ')[1]) || 30;
    return ctx.reply(funnelText(days));
  });

  bot.action('admin_promo_stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCbQuery().catch(() => null);
    return ctx.reply(funnelText(30));
  });

  bot.action('admin_broadcast_help', (ctx) => requireAdmin(ctx) && ctx.reply('استخدم: /broadcast نص الرسالة'));
  bot.action('admin_signal_help', (ctx) => requireAdmin(ctx) && ctx.reply('استخدم: /signal نص الإشارة'));

bot.command('addvip', async (ctx) => {
  if (!requireAdmin(ctx)) return;

  const [, telegramId, days = 30] = ctx.message.text.split(' ');

  if (!telegramId)
    return ctx.reply('استخدم: /addvip <telegram_id> <days>');

  const expires = addVip(telegramId, days);

  try {
    await ctx.telegram.sendMessage(
      telegramId,
      `🎉 تم تفعيل اشتراك VIP الخاص بك بنجاح.\n\n⏳ مدة الاشتراك: ${days} يوم.\n\nشكراً لاشتراكك ونتمنى لك تداولاً موفقاً. 🚀`
    );
  } catch (e) {
    console.log(e.message);
  }

  return ctx.reply(`✅ تم تفعيل VIP حتى ${expires}`);
});
  bot.command('removevip', (ctx) => {
    if (!requireAdmin(ctx)) return;
    const [, telegramId] = ctx.message.text.split(' ');
    if (!telegramId) return ctx.reply('استخدم: /removevip <telegram_id>');
    removeVip(telegramId);
    return ctx.reply('تم حذف VIP.');
  });

  bot.command('broadcast', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const message = ctx.message.text.replace('/broadcast', '').trim();
    if (!message) return ctx.reply('استخدم: /broadcast نص الرسالة');
    const sent = await sendToAll(ctx, message);
    return ctx.reply(`تم الإرسال إلى ${sent} مستخدم.`);
  });

bot.command('signal', async (ctx) => {

    if(!requireAdmin(ctx)) return;

    const text = ctx.message.text.replace('/signal', '').trim();

    if(!text){
        return ctx.reply(
            '❌ اكتب الرسالة بعد الأمر\n\nمثال:\n/signal 🚨 إشارة ذهب XAUUSD'
        );
    }


    const message = `\n${text}\n\n🤖 Telegram Forex AI\n`;


    if (!config.vipChannelId) {
        return ctx.reply(
            '❌ VIP_CHANNEL_ID غير مضبوط — لم يتم إرسال الإشارة لأي مكان'
        );
    }

    try {
        await ctx.telegram.sendMessage(
            config.vipChannelId,
            message
        );

        console.log("✅ Signal sent to VIP channel");

    } catch(e){
        console.log("VIP signal error:", e.message);
        return ctx.reply(
            `❌ فشل إرسال الإشارة للـ VIP\n${e.message}`
        );
    }

    return ctx.reply(
        '✅ تم إرسال الإشارة لقناة VIP فقط'
    );


});

bot.action('admin_vip', (ctx) => {
    if(!requireAdmin(ctx)) return;

    return ctx.reply(
`💎 إدارة VIP\n\n/addvip ID الأيام\n\n/removevip ID`
    );
});


bot.action('admin_points', (ctx) => {
    if(!requireAdmin(ctx)) return;

    return ctx.reply(
`🎁 إدارة النقاط\n\n/addpoints ID النقاط`
    );
});


bot.action('admin_refresh', (ctx) => {
    if(!requireAdmin(ctx)) return;

    return ctx.reply('🔄 تم تحديث لوحة الأدمن');
});

bot.command('addpoints', async (ctx) => {

    if (!requireAdmin(ctx)) return;


    const [, telegramId, points] = ctx.message.text.split(' ');


    if (!telegramId || !points) {
        return ctx.reply(
            'استخدم:\n/addpoints <telegram_id> <points>'
        );
    }


    const user = findUser(telegramId);


    if (!user) {
        return ctx.reply('❌ المستخدم غير موجود');
    }


    const updated = addPoints(
        telegramId,
        points
    );
if (
    updated.is_vip === 1 &&
    Number(updated.points) === 0
) {

    try {

        await ctx.telegram.sendMessage(
            telegramId,
`🎉 مبروك!\n\nلقد جمعت 200 نقطة من نظام الإحالة.\n\n💎 تم تفعيل اشتراك VIP لمدة 14 يوم.\n\nاستمتع بجميع مميزات Forex AI Bot 🚀`
        );

    } catch(e) {

        console.log(e.message);

    }

}

    try {

        await ctx.telegram.sendMessage(
            telegramId,
`🎁 تمت إضافة نقاط إلى حسابك\n\n➕ النقاط المضافة: ${points}\n\n🎯 رصيدك الحالي:\n${updated.points}`
        );

    } catch(e) {

        console.log(e.message);

    }


    return ctx.reply(
`✅ تم إضافة ${points} نقطة للمستخدم\nID: ${telegramId}`
    );

});
} // نهاية registerAdminCommands

module.exports = registerAdminCommands;
