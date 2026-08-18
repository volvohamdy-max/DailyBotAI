const { Markup } = require('telegraf');

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇪🇬 العربية', 'lang_ar'),
      Markup.button.callback('🇬🇧 English', 'lang_en')
    ]
  ]);
}

module.exports = languageKeyboard;
