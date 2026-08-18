const ar = require('../locales/ar');
const en = require('../locales/en');
const { findUser } = require('../database/users');

const locales = { ar, en };

function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'ar';
}

function getLanguage(telegramId) {
  const user = findUser(telegramId);
  return normalizeLanguage(user && user.language);
}

function tByLang(language) {
  return locales[normalizeLanguage(language)];
}

function t(ctx) {
  return tByLang(getLanguage(ctx.from.id));
}

module.exports = {
  getLanguage,
  normalizeLanguage,
  tByLang,
  t
};
