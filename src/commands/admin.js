const config = require('../config');
const { addVip } = require('../database/users');

function registerAdmin(bot) {

  bot.command('approve', async (ctx) => {

    if (!config.adminIds.includes(ctx.from.id)) {
      return;
    }

    const args = ctx.message.text.split(' ');

    if (args.length < 3) {
      return ctx.reply('الاستخدام:\n/approve telegram_id days');
    }

    const telegramId = args[1];
    const days = Number(args[2]);

    addVip(telegramId, days);

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 تم تفعيل اشتراك VIP لمدة ${days} يوم.`
      );
    } catch (e) {}

    return ctx.reply('✅ تم تفعيل الاشتراك.');
  });

}

module.exports = registerAdmin;
