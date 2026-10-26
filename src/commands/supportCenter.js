const { Markup } = require('telegraf');
const { findUser } = require('../database/users');

const SUPPORT_URL = 'https://t.me/Forexai_support';
const MAIN_GROUP_URL = 'https://t.me/forexaichannel';

function isEnglish(ctx) {
  return findUser(ctx.from?.id)?.language === 'en';
}

module.exports = function registerSupportCenter(bot) {
  bot.hears(['🎧 الدعم', '🎧 Support'], (ctx) => {
    const en = isEnglish(ctx);
    return ctx.reply(
      en
        ? '🎧 FOREX AI SUPPORT\n\nChoose how you would like to continue:'
        : '🎧 دعم FOREX AI\n\nاختر وسيلة التواصل:',
      Markup.inlineKeyboard([
        [Markup.button.url(en ? '💬 Technical Support' : '💬 الدعم الفني', SUPPORT_URL)],
        [Markup.button.url(en ? '👥 Main Group' : '👥 الجروب الرئيسي', MAIN_GROUP_URL)]
      ])
    );
  });
};
