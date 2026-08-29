const config = require('../config');
const {
  createOrUpdateUser,
  checkReferralReward,
  findUser,
  setLanguage
} = require('../database/users');
const { mainKeyboard } = require('../keyboards/main');
const languageKeyboard = require('../keyboards/language');
const { requireAdmin } = require('../utils/auth');
const adminKeyboard = require('../keyboards/admin');
const { tByLang } = require('../utils/i18n');

async function sendWelcome(ctx, user) {
  const language = user.language === 'en' ? 'en' : 'ar';
  const text = tByLang(language);
  const refLink = `https://t.me/${config.botUsername}?start=${user.referral_code}`;
  const isVip = Boolean(user.is_vip) && (!user.vip_expires_at || new Date(user.vip_expires_at).getTime() > Date.now());

  return ctx.reply(
`${text.welcomeTitle(user.first_name)}

${text.welcomeBody}

${text.referralTitle}
${refLink}

━━━━━━━━━━━━━━

${text.chooseService}`,
    mainKeyboard(language, false, isVip)
  );
}

function registerStart(bot) {
  bot.command('start', async (ctx) => {
    let user = createOrUpdateUser(ctx.from, ctx.startPayload);

    if (requireAdmin(ctx, true)) {
      return ctx.reply('👑 لوحة تحكم الأدمن', adminKeyboard());
    }

    const vipReward = checkReferralReward(ctx.from.id);

    if (vipReward) {
      await ctx.reply(`
🎉 مبروك!

لقد جمعت 200 نقطة من نظام الإحالات.

💎 تم تفعيل اشتراك VIP لمدة 14 يومًا مجانًا.
`);
      user = findUser(ctx.from.id) || user;
    }

    if (!user.language) {
      return ctx.reply(
        '🌐 اختر لغتك\nChoose your language',
        languageKeyboard()
      );
    }

    return sendWelcome(ctx, user);
  });

  bot.action('lang_ar', async (ctx) => {
    await ctx.answerCbQuery();
    const user = setLanguage(ctx.from.id, 'ar');
    await ctx.editMessageText('✅ تم اختيار العربية.');
    return sendWelcome(ctx, user);
  });

  bot.action('lang_en', async (ctx) => {
    await ctx.answerCbQuery();
    const user = setLanguage(ctx.from.id, 'en');
    await ctx.editMessageText('✅ English selected.');
    return sendWelcome(ctx, user);
  });
}

module.exports = registerStart;
