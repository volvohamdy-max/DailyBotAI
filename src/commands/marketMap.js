const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { mainKeyboard } = require('../keyboards/main');
const { buildMarketMap } = require('../services/marketMap');
const { consumeFeature, limitMessage } = require('../services/dailyUsageGate');

function en(ctx) {
  return findUser(ctx.from.id)?.language === 'en';
}

function directionLabel(direction) {
  if (direction === 'BUY') return '🟢 BUY';
  if (direction === 'SELL') return '🔴 SELL';
  return '⚪ WAIT';
}

function statusLabel(status, english) {
  const labels = {
    ENTRY_READY: english ? '🔥 Entry Ready' : '🔥 دخول جاهز',
    WAIT_PULLBACK: english ? '🟡 Wait Pullback' : '🟡 انتظر تصحيح',
    TREND_FOUND: english ? '📈 Trend' : '📈 ترند',
    NO_TREND: english ? '⚪ No Setup' : '⚪ لا دخول',
    NO_DATA: english ? '⚪ No Data' : '⚪ لا بيانات',
    ERROR: english ? '⚪ Error' : '⚪ خطأ'
  };
  return labels[status] || status;
}

function summaryText(data, english) {
  const rows = data.ranked.map((item, index) => {
    return `${index + 1}. ${item.pair}
${directionLabel(item.direction)} | ⭐ ${item.marketScore}/100
${statusLabel(item.status, english)}`;
  }).join('\n\n');

  if (english) {
    return `🧭 MARKET MAP
━━━━━━━━━━━━━━━━━━

🕐 Session: ${data.session.en}

${rows}

━━━━━━━━━━━━━━━━━━
Tap “Best Opportunity Now” to compare the strongest current setup.

⚠️ Scores are analytical rankings, not profit guarantees.`;
  }

  return `🧭 خريطة السوق
━━━━━━━━━━━━━━━━━━

🕐 الجلسة الحالية: ${data.session.ar}

${rows}

━━━━━━━━━━━━━━━━━━
اضغط “أفضل فرصة الآن” لمقارنة أقوى فرصة حالية.

⚠️ التقييمات ترتيب تحليلي وليست ضمانًا للربح.`;
}

function bestOpportunityText(data, english) {
  const candidates = data.ranked.filter((x) =>
    ['ENTRY_READY', 'WAIT_PULLBACK', 'TREND_FOUND'].includes(x.status)
  );

  const top = candidates[0];

  if (!top) {
    return english
      ? '🔍 No strong opportunity is available right now.'
      : '🔍 لا توجد فرصة قوية مناسبة حاليًا.';
  }

  const reasons = [];
  if (top.status === 'ENTRY_READY') {
    reasons.push(english ? 'Entry conditions aligned' : 'شروط الدخول متوافقة');
  }
  if (Number(top.adx) >= 25) {
    reasons.push(
      english
        ? `ADX supports trend (${Number(top.adx).toFixed(1)})`
        : `ADX يدعم قوة الترند (${Number(top.adx).toFixed(1)})`
    );
  }
  if (Number(top.aiConfidence) >= 70) {
    reasons.push(
      english
        ? `AI confirmation ${top.aiConfidence}%`
        : `تأكيد AI بنسبة ${top.aiConfidence}%`
    );
  }

  if (english) {
    return `🎯 BEST OPPORTUNITY NOW
━━━━━━━━━━━━━━━━━━

🥇 ${top.pair}
${directionLabel(top.direction)}

⭐ Market Score: ${top.marketScore}/100
📊 Trend Score: ${top.score}/100
🤖 AI Confidence: ${top.aiConfidence || 0}%
💪 ADX: ${Number.isFinite(Number(top.adx)) ? Number(top.adx).toFixed(1) : '—'}

🕐 Session: ${data.session.en}

Why it ranks first:
${reasons.length ? reasons.map((r) => `• ${r}`).join('\n') : '• Strongest relative setup in the current scan'}

📌 Current state:
${statusLabel(top.status, true)}

⚠️ This is a ranking decision, not a guarantee of profit.`;
  }

  return `🎯 أفضل فرصة الآن
━━━━━━━━━━━━━━━━━━

🥇 ${top.pair}
${directionLabel(top.direction)}

⭐ تقييم السوق: ${top.marketScore}/100
📊 قوة الترند: ${top.score}/100
🤖 ثقة AI: ${top.aiConfidence || 0}%
💪 ADX: ${Number.isFinite(Number(top.adx)) ? Number(top.adx).toFixed(1) : '—'}

🕐 الجلسة: ${data.session.ar}

لماذا هي الأولى:
${reasons.length ? reasons.map((r) => `• ${r}`).join('\n') : '• أقوى فرصة نسبيًا في الفحص الحالي'}

📌 الحالة الحالية:
${statusLabel(top.status, false)}

⚠️ هذا ترتيب تحليلي وليس ضمانًا للربح.`;
}

function marketButtons(english) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        english ? '🎯 Best Opportunity Now' : '🎯 أفضل فرصة الآن',
        'market_best_now'
      )
    ],
    [
      Markup.button.callback(
        english ? '🔄 Refresh Market Map' : '🔄 تحديث خريطة السوق',
        'market_map_refresh'
      )
    ]
  ]);
}

function vipButton(english) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        english ? '💎 Upgrade to VIP' : '💎 اشترك VIP',
        'vip_monthly'
      )
    ]
  ]);
}

async function denyMarketMap(ctx, english) {
  return ctx.reply(
    limitMessage('market_map', english),
    vipButton(english)
  );
}

function consumeMarketMapAccess(ctx) {
  if (ctx.state?.dailyUsageChecked) {
    return { allowed: true, alreadyChecked: true };
  }

  if (!ctx.state) ctx.state = {};
  ctx.state.dailyUsageChecked = true;

  return consumeFeature(ctx.from?.id, 'market_map');
}

const cache = new Map();

function cacheData(userId, data) {
  cache.set(String(userId), { data, time: Date.now() });
}

function getCached(userId) {
  const item = cache.get(String(userId));
  if (!item) return null;
  if (Date.now() - item.time > 2 * 60 * 1000) {
    cache.delete(String(userId));
    return null;
  }
  return item.data;
}

function registerMarketMap(bot) {
  bot.hears(['🧭 خريطة السوق', '🧭 Market Map'], async (ctx) => {
    const english = en(ctx);
    const access = consumeMarketMapAccess(ctx);

    if (!access.allowed) {
      return denyMarketMap(ctx, english);
    }

    await ctx.reply(
      english
        ? '🧭 Building Market Map...\n\nScanning all 8 assets and ranking current conditions.'
        : '🧭 جاري بناء خريطة السوق...\n\nفحص الـ8 أصول وترتيب حالة السوق الحالية.'
    );

    try {
      const data = await buildMarketMap();
      cacheData(ctx.from.id, data);

      return ctx.reply(
        summaryText(data, english),
        marketButtons(english)
      );
    } catch (error) {
      console.log('Market Map command error:', error.stack || error);
      return ctx.reply(
        english
          ? '❌ Market Map could not complete the scan.'
          : '❌ تعذر إكمال خريطة السوق.',
        mainKeyboard(english ? 'en' : 'ar')
      );
    }
  });

  bot.action('market_best_now', async (ctx) => {
    await ctx.answerCbQuery();
    const english = en(ctx);

    let data = getCached(ctx.from.id);

    // Free users may inspect the cached result from their one preview,
    // but rebuilding it later requires VIP/Admin access.
    if (!data) {
      const access = consumeFeature(ctx.from?.id, 'market_map');
      if (!access.allowed) {
        return denyMarketMap(ctx, english);
      }

      data = await buildMarketMap();
      cacheData(ctx.from.id, data);
    }

    return ctx.reply(
      bestOpportunityText(data, english),
      marketButtons(english)
    );
  });

  bot.action('market_map_refresh', async (ctx) => {
    await ctx.answerCbQuery();
    const english = en(ctx);
    const access = consumeFeature(ctx.from?.id, 'market_map');

    // A free user's first open already consumed the one-time preview,
    // so Refresh is naturally VIP/Admin-only after that first view.
    if (!access.allowed) {
      return denyMarketMap(ctx, english);
    }

    const data = await buildMarketMap();
    cacheData(ctx.from.id, data);

    return ctx.editMessageText(
      summaryText(data, english),
      marketButtons(english)
    );
  });
}

module.exports = registerMarketMap;
