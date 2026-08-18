const { Markup } = require('telegraf');
const { tByLang } = require('../utils/i18n');

const mainKeyboard = (
  language = 'ar',
  isAdmin = false,
  isVip = false
) => {
  const { buttons } = tByLang(language);

  const rows = [
    [
      language === 'en'
        ? '🥇 Check Your Trade'
        : '🥇 اختبر صفقتك'
    ],
    [
      language === 'en'
        ? '🤖 Monitor My Trade'
        : '🤖 راقب صفقتي'
    ],
    [buttons.tradeNow, buttons.bestOpportunity],
    [buttons.marketCenter, buttons.alertsCenter],
    [buttons.accountCenter, buttons.more]
  ];
if (isAdmin) {
    rows.push(['🎛️ لوحة الأدمن']);
  }

  return Markup.keyboard(rows).resize();
};

const marketKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);

  return Markup.keyboard([
    [buttons.scanner, buttons.marketMap],
    [language === 'en' ? '🧪 My Strategy' : '🧪 استراتيجيتي'],
    [buttons.trendHunter, buttons.analysis],
    [
      language === 'en'
        ? '📡 Opportunity Radar'
        : '📡 رادار الفرص'
    ],
    [
      language === 'en'
        ? '🧠 Adaptive Intelligence'
        : '🧠 الذكاء المتكيف'
    ],
    [buttons.signalLab],
    [buttons.back]
  ]).resize();
};

const alertsKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);

  return Markup.keyboard([
    [buttons.alerts],
    [buttons.back]
  ]).resize();
};

const accountKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);

  return Markup.keyboard([
    [buttons.account, buttons.vip],
    [buttons.referral, buttons.language],
    [buttons.back]
  ]).resize();
};

const moreKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);

  return Markup.keyboard([
    [buttons.support, buttons.settings],
    [buttons.back]
  ]).resize();
};

const settingsKeyboard = (language = 'ar') => {
  const { buttons } = tByLang(language);

  return Markup.keyboard([
    [buttons.language],
    [buttons.back]
  ]).resize();
};

const vipKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Monthly - 30 days / شهري', 'vip_monthly')],
    [Markup.button.callback('Quarterly - 90 days / ثلاثي', 'vip_quarterly')],
    [Markup.button.callback('Yearly - 365 days / سنوي', 'vip_yearly')]
  ]);

module.exports = {
  mainKeyboard,
  marketKeyboard,
  alertsKeyboard,
  accountKeyboard,
  moreKeyboard,
  settingsKeyboard,
  vipKeyboard
};
