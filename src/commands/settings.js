const { findUser, setLanguage } = require('../database/users');
const { mainKeyboard, settingsKeyboard } = require('../keyboards/main');
const languageKeyboard = require('../keyboards/language');
const { tByLang } = require('../utils/i18n');

function registerSettings(bot) {
  bot.hears(['⚙️ الإعدادات', '⚙️ Settings'], (ctx) => {
    const user = findUser(ctx.from.id);
    const language = user && user.language === 'en' ? 'en' : 'ar';
    const text = tByLang(language);

    return ctx.reply(
      `${text.settingsTitle}\n\n${text.settingsBody}`,
      settingsKeyboard(language)
    );
  });

  bot.hears(['🌐 اللغة', '🌐 Language'], (ctx) => {
    return ctx.reply(
      '🌐 اختر لغتك\nChoose your language',
      languageKeyboard()
    );
  });

  bot.hears(['🔙 رجوع', '🔙 Back'], (ctx) => {
    const user = findUser(ctx.from.id);
    const language = user && user.language === 'en' ? 'en' : 'ar';
    const text = tByLang(language);

    return ctx.reply(text.menuPrompt, mainKeyboard(language));
  });

  bot.action('lang_ar', async (ctx) => {
    await ctx.answerCbQuery();
    setLanguage(ctx.from.id, 'ar');
    await ctx.editMessageText('✅ تم تغيير اللغة إلى العربية.');
    return ctx.reply('📋 القائمة الرئيسية:', mainKeyboard('ar'));
  });

  bot.action('lang_en', async (ctx) => {
    await ctx.answerCbQuery();
    setLanguage(ctx.from.id, 'en');
    await ctx.editMessageText('✅ Language changed to English.');
    return ctx.reply('📋 Main menu:', mainKeyboard('en'));
  });
}

module.exports = registerSettings;
