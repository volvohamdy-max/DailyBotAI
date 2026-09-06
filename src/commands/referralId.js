const config = require('../config');
const { findUser } = require('../database/users');

function registerReferralId(bot) {
  function sendReferral(ctx) {
    const user = findUser(ctx.from.id);

    if (!user) {
      return ctx.reply('اكتب /start أولاً\nSend /start first.');
    }

    const isEnglish = user.language === 'en';
    const link = `https://t.me/${config.botUsername}?start=${user.referral_code}`;
    const telegramId = ctx.from.id;

    return ctx.reply(
      isEnglish
        ? `🔗 Your referral link:\n${link}\n\n🆔 Your ID:\n${telegramId}\n\nKeep your ID. You may need it when contacting support or receiving gifts and rewards.`
        : `🔗 رابط إحالتك:\n${link}\n\n🆔 ID حسابك:\n${telegramId}\n\nاحتفظ بالـ ID الخاص بك، فقد تحتاجه عند التواصل مع الدعم أو استلام الهدايا والمكافآت.`
    );
  }

  // Register before the legacy user handlers so referral output includes the Telegram ID.
  bot.command('ref', sendReferral);
  bot.hears('🔗 الإحالة', sendReferral);
  bot.hears('🔗 Referral', sendReferral);
}

module.exports = registerReferralId;
