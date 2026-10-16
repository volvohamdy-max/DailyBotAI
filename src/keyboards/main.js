const { Markup } = require('telegraf');
const { tByLang } = require('../utils/i18n');

const mainKeyboard = (language = 'ar', isAdmin = false, isVip = false) => {
  const rows = [
    [language === 'en' ? '🥇 Gold Center' : '🥇 مركز الذهب', language === 'en' ? '⚡ Trading Center' : '⚡ مركز التداول'],
    [language === 'en' ? '📊 Market Center' : '📊 مركز السوق', language === 'en' ? '🔔 Alerts Center' : '🔔 مركز التنبيهات'],
    [language === 'en' ? '🎓 Trading Academy' : '🎓 أكاديمية التداول'],
    [language === 'en' ? '👤 Account Center' : '👤 مركز الحساب']
  ];
  if (isAdmin) rows.push(['🎛️ لوحة الأدمن']);
  return Markup.keyboard(rows).resize();
};

const goldCenterKeyboard = (language = 'ar') => Markup.keyboard([
  [language === 'en' ? '🎯 Daily Gold Plan' : '🎯 خطة الذهب اليومية'],
  [language === 'en' ? '🚨 Gold Zone Radar' : '🚨 رادار مناطق الذهب'],
  [language === 'en' ? '🥇 Gold Analysis' : '🥇 تحليل الذهب', language === 'en' ? '💰 Available Gold Trades' : '💰 صفقات الذهب المتاحة'],
  [language === 'en' ? '🧱 Gold Support & Resistance' : '🧱 دعم ومقاومة الذهب', language === 'en' ? '⭐ Best Gold Trade Now' : '⭐ أفضل صفقة ذهب الآن'],
  [language === 'en' ? '🥇 Check Your Trade' : '🥇 اختبر صفقتك', language === 'en' ? '🤖 Monitor My Trade' : '🤖 راقب صفقتي'],
  [language === 'en' ? '🔙 Back' : '🔙 رجوع']
]).resize();

const tradingCenterKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);
  return Markup.keyboard([
    [buttons.tradeNow, buttons.bestOpportunity],
    [language === 'en' ? '🔙 Back' : '🔙 رجوع']
  ]).resize();
};

const marketKeyboard = (language = 'ar', isAdmin = false, isVip = false) => {
  const { buttons } = tByLang(language);
  const rows = [
    [buttons.scanner, buttons.marketMap],
    [buttons.trendHunter, buttons.analysis],
    [language === 'en' ? '📡 Opportunity Radar' : '📡 رادار الفرص'],
    [language === 'en' ? '🧠 Advanced Tools' : '🧠 أدوات متقدمة'],
    [buttons.back]
  ];
  if (isVip || isAdmin) rows.splice(3, 0, [language === 'en' ? '🧠 Market Intelligence' : '🧠 مركز ذكاء السوق']);
  if (isAdmin) rows.unshift([language === 'en' ? '📊 Bot Results' : '📊 نتائج البوت']);
  return Markup.keyboard(rows).resize();
};

const advancedToolsKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);
  return Markup.keyboard([
    [language === 'en' ? '🧪 My Strategy' : '🧪 استراتيجيتي', buttons.signalLab],
    [language === 'en' ? '🧠 Adaptive Intelligence' : '🧠 الذكاء المتكيف'],
    [language === 'en' ? '🔙 Back to Market' : '🔙 رجوع للسوق']
  ]).resize();
};

const alertsKeyboard = (language = 'ar') => { const { buttons } = tByLang(language); return Markup.keyboard([[buttons.alerts],[buttons.back]]).resize(); };
const accountKeyboard = (language = 'ar') => { const { buttons } = tByLang(language); return Markup.keyboard([[buttons.account, buttons.vip],[buttons.referral, buttons.language],[buttons.settings, buttons.support],[buttons.back]]).resize(); };
const moreKeyboard = accountKeyboard;
const settingsKeyboard = (language = 'ar') => { const { buttons } = tByLang(language); return Markup.keyboard([[buttons.language],[buttons.back]]).resize(); };
const vipKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('💎 $29.99 — شهر / 30 Days', 'vip_monthly')],
  [Markup.button.callback('💎 $74.99 — 3 شهور / 90 Days', 'vip_quarterly')],
  [Markup.button.callback('💎 $249.99 — سنة / 365 Days', 'vip_yearly')],
  [Markup.button.url('💬 مساعدة الاشتراك / Subscription Help', 'https://t.me/Axiomiexfx_support')]
]);

module.exports = { mainKeyboard, goldCenterKeyboard, tradingCenterKeyboard, marketKeyboard, advancedToolsKeyboard, alertsKeyboard, accountKeyboard, moreKeyboard, settingsKeyboard, vipKeyboard };
