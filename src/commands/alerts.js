const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const {
  DEFAULT_PAIRS,
  getPreference,
  setEnabled,
  setMinConfidence,
  togglePair,
  setAllPairs
} = require('../database/alertPreferences');

function lang(ctx) {
  const user = findUser(ctx.from.id);
  return user && user.language === 'en' ? 'en' : 'ar';
}

function isVip(user) {
  if (!user || Number(user.is_vip) !== 1) return false;
  if (!user.vip_expires_at) return true;
  return new Date(user.vip_expires_at).getTime() > Date.now();
}

function statusText(ctx, pref) {
  const en = lang(ctx) === 'en';
  const user = findUser(ctx.from.id);
  const activePairs = pref.pairs.length
    ? pref.pairs.join(', ')
    : (en ? 'None' : 'لا يوجد');

  if (en) {
    return `🔔 ALERT SETTINGS

Status: ${pref.enabled ? '🟢 ON' : '🔴 OFF'}
VIP access: ${isVip(user) ? '✅ Active' : '❌ Required'}
Minimum AI confidence: ${pref.min_confidence}%
Selected pairs:
${activePairs}

━━━━━━━━━━━━━━━━━━
Alerts are checked automatically every 5 minutes.
A 30-minute cooldown prevents repeating the same pair/direction alert.

⚠️ Confidence is an analytical score, not a guarantee of profit.`;
  }

  return `🔔 إعدادات التنبيهات

الحالة: ${pref.enabled ? '🟢 مفعلة' : '🔴 متوقفة'}
صلاحية VIP: ${isVip(user) ? '✅ مفعلة' : '❌ مطلوبة'}
الحد الأدنى لثقة AI: ${pref.min_confidence}%
الأزواج المختارة:
${activePairs}

━━━━━━━━━━━━━━━━━━
يتم فحص التنبيهات تلقائيًا كل 5 دقائق.
يوجد انتظار 30 دقيقة لمنع تكرار نفس تنبيه الزوج والاتجاه.

⚠️ نسبة الثقة تقييم تحليلي وليست ضمانًا للربح.`;
}

function mainKeyboard(ctx, pref) {
  const en = lang(ctx) === 'en';

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        pref.enabled
          ? (en ? '🔴 Turn alerts off' : '🔴 إيقاف التنبيهات')
          : (en ? '🟢 Turn alerts on' : '🟢 تشغيل التنبيهات'),
        'alerts_toggle'
      )
    ],
    [
      Markup.button.callback(
        en ? '💱 Choose pairs' : '💱 اختيار الأزواج',
        'alerts_pairs'
      ),
      Markup.button.callback(
        en ? '🎯 Min confidence' : '🎯 الحد الأدنى للثقة',
        'alerts_conf'
      )
    ],
    [
      Markup.button.callback(
        en ? '🔄 Refresh' : '🔄 تحديث',
        'alerts_refresh'
      )
    ]
  ]);
}

function pairsKeyboard(ctx, pref) {
  const en = lang(ctx) === 'en';
  const rows = [];

  for (let i = 0; i < DEFAULT_PAIRS.length; i += 2) {
    const row = DEFAULT_PAIRS.slice(i, i + 2).map((pair) =>
      Markup.button.callback(
        `${pref.pairs.includes(pair) ? '✅' : '⬜'} ${pair}`,
        `alerts_pair_${pair}`
      )
    );
    rows.push(row);
  }

  rows.push([
    Markup.button.callback(en ? '✅ Select all' : '✅ تحديد الكل', 'alerts_pairs_all'),
    Markup.button.callback(en ? '🗑 Clear all' : '🗑 إلغاء الكل', 'alerts_pairs_none')
  ]);

  rows.push([
    Markup.button.callback(en ? '🔙 Back' : '🔙 رجوع', 'alerts_home')
  ]);

  return Markup.inlineKeyboard(rows);
}

function confidenceKeyboard(ctx, pref) {
  const en = lang(ctx) === 'en';
  const values = [70, 75, 80, 85, 90, 95];
  const rows = [];

  for (let i = 0; i < values.length; i += 3) {
    rows.push(values.slice(i, i + 3).map((value) =>
      Markup.button.callback(
        `${pref.min_confidence === value ? '✅ ' : ''}${value}%`,
        `alerts_conf_${value}`
      )
    ));
  }

  rows.push([
    Markup.button.callback(en ? '🔙 Back' : '🔙 رجوع', 'alerts_home')
  ]);

  return Markup.inlineKeyboard(rows);
}

async function editHome(ctx) {
  const pref = getPreference(ctx.from.id);

  try {
    return await ctx.editMessageText(
      statusText(ctx, pref),
      mainKeyboard(ctx, pref)
    );
  } catch (error) {
    const message =
      String(
        error?.response?.description ||
        error?.message ||
        ''
      );

    if (
      message.includes(
        'message is not modified'
      )
    ) {
      console.log(
        'ℹ️ Alerts message unchanged — edit skipped'
      );

      return;
    }

    throw error;
  }
}

function registerAlerts(bot) {
  bot.hears(['🔔 التنبيهات', '🔔 Alerts'], async (ctx) => {
    const pref = getPreference(ctx.from.id);
    return ctx.reply(statusText(ctx, pref), mainKeyboard(ctx, pref));
  });

  bot.action('alerts_toggle', async (ctx) => {
    await ctx.answerCbQuery();
    const current = getPreference(ctx.from.id);
    setEnabled(ctx.from.id, !current.enabled);
    return editHome(ctx);
  });

  bot.action('alerts_refresh', async (ctx) => {
    await ctx.answerCbQuery();
    return editHome(ctx);
  });

  bot.action('alerts_home', async (ctx) => {
    await ctx.answerCbQuery();
    return editHome(ctx);
  });

  bot.action('alerts_pairs', async (ctx) => {
    await ctx.answerCbQuery();
    const pref = getPreference(ctx.from.id);
    const en = lang(ctx) === 'en';

    return ctx.editMessageText(
      en
        ? '💱 Choose the pairs you want to receive alerts for:'
        : '💱 اختر الأزواج التي تريد استقبال تنبيهاتها:',
      pairsKeyboard(ctx, pref)
    );
  });

  bot.action(/^alerts_pair_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const pair = ctx.match[1];
    const pref = togglePair(ctx.from.id, pair);
    const en = lang(ctx) === 'en';

    return ctx.editMessageText(
      en
        ? '💱 Choose the pairs you want to receive alerts for:'
        : '💱 اختر الأزواج التي تريد استقبال تنبيهاتها:',
      pairsKeyboard(ctx, pref)
    );
  });

  bot.action('alerts_pairs_all', async (ctx) => {
    await ctx.answerCbQuery();
    const pref = setAllPairs(ctx.from.id, true);
    const en = lang(ctx) === 'en';

    return ctx.editMessageText(
      en
        ? '💱 Choose the pairs you want to receive alerts for:'
        : '💱 اختر الأزواج التي تريد استقبال تنبيهاتها:',
      pairsKeyboard(ctx, pref)
    );
  });

  bot.action('alerts_pairs_none', async (ctx) => {
    await ctx.answerCbQuery();
    const pref = setAllPairs(ctx.from.id, false);
    const en = lang(ctx) === 'en';

    return ctx.editMessageText(
      en
        ? '💱 Choose the pairs you want to receive alerts for:'
        : '💱 اختر الأزواج التي تريد استقبال تنبيهاتها:',
      pairsKeyboard(ctx, pref)
    );
  });

  bot.action('alerts_conf', async (ctx) => {
    await ctx.answerCbQuery();
    const pref = getPreference(ctx.from.id);
    const en = lang(ctx) === 'en';

    return ctx.editMessageText(
      en
        ? `🎯 Minimum AI confidence\n\nCurrent: ${pref.min_confidence}%\nChoose the minimum confidence required for an alert:`
        : `🎯 الحد الأدنى لثقة AI\n\nالحالي: ${pref.min_confidence}%\nاختر أقل نسبة ثقة مطلوبة لإرسال التنبيه:`,
      confidenceKeyboard(ctx, pref)
    );
  });

  bot.action(/^alerts_conf_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    setMinConfidence(ctx.from.id, Number(ctx.match[1]));
    return editHome(ctx);
  });
}

module.exports = registerAlerts;
