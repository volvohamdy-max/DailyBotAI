const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { mainKeyboard } = require('../keyboards/main');
const { analyzePair } = require('../services/analysisService');
const { scanMarkets } = require('../services/smartScanner');
const {
  getBestTrade,
  getLastRejectedCandidates
} = require('../services/bestTrade');
const { scanTrends } = require('../services/trendHunter');
const { buildMarketMap } = require('../services/marketMap');
const { getEconomicCalendar, isHighImpact } = (() => {
  const news = require('../services/newsService');
  let high = null;
  try {
    high = require('../services/newsProviders').isHighImpact;
  } catch (_) {}
  return {
    getEconomicCalendar: news.getEconomicCalendar,
    isHighImpact: high || (() => true)
  };
})();

const PAIRS = ['XAUUSD','BTCUSD','EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY'];

function lang(ctx) {
  return findUser(ctx.from.id)?.language === 'en' ? 'en' : 'ar';
}

function isEn(ctx) {
  return lang(ctx) === 'en';
}

function fmt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : '—';
}

function menu(ctx) {
  return mainKeyboard(lang(ctx));
}

function parsePair(ctx) {
  const text = String(ctx.message?.text || '');
  const parts = text.trim().split(/\s+/);
  const pair = String(parts[1] || '').toUpperCase();
  return PAIRS.includes(pair) ? pair : null;
}

function analysisText(ctx, pair, result) {
  const en = isEn(ctx);
  const i = result?.indicators || {};
  const ema20 = Number(i.ema20);
  const ema50 = Number(i.ema50);
  const rsi = Number(i.rsi);
  const adx = Number(i.adx);
  const bullish = Number.isFinite(ema20) && Number.isFinite(ema50) && ema20 > ema50;

  if (en) {
    return `📊 ${pair} ANALYSIS
━━━━━━━━━━━━━━━━━━

💰 Price: ${fmt(i.lastPrice)}
📈 Trend: ${bullish ? '🟢 Bullish' : '🔴 Bearish'}
📊 RSI: ${Number.isFinite(rsi) ? rsi.toFixed(1) : '—'}
💪 ADX: ${Number.isFinite(adx) ? adx.toFixed(1) : '—'}
🤖 AI: ${result?.signal?.confidence ? `${result.signal.confidence}%` : 'N/A'}

⚠️ Analytical information only.`;
  }

  return `📊 تحليل ${pair}
━━━━━━━━━━━━━━━━━━

💰 السعر: ${fmt(i.lastPrice)}
📈 الاتجاه: ${bullish ? '🟢 صاعد' : '🔴 هابط'}
📊 RSI: ${Number.isFinite(rsi) ? rsi.toFixed(1) : '—'}
💪 ADX: ${Number.isFinite(adx) ? adx.toFixed(1) : '—'}
🤖 AI: ${result?.signal?.confidence ? `${result.signal.confidence}%` : 'غير متاح'}

⚠️ معلومات تحليلية وليست ضمانًا للربح.`;
}

function noTradeDiagnosticsText(ctx) {
  const en = isEn(ctx);
  const rejected = getLastRejectedCandidates(2);

  const rows = rejected.map((item, index) => {
    let reason;

    if (item.reason === 'AI_MISSING') {
      reason = en
        ? '❌ AI confirmation unavailable'
        : '❌ تأكيد AI غير متاح';
    } else if (item.reason === 'AI_MISMATCH') {
      reason = en
        ? '❌ AI direction mismatch'
        : '❌ اتجاه AI مختلف عن الماسح';
    } else {
      reason = en
        ? `❌ AI ${item.aiConfidence}% — minimum 60%`
        : `❌ AI ${item.aiConfidence}% — الحد الأدنى 60%`;
    }

    return `${index === 0 ? '🥇' : '🥈'} ${item.pair} — ${item.action}
⭐ Smart Score: ${item.smartScore}/100
${reason}`;
  }).join('\n\n');

  if (en) {
    return `🔍 No high-quality trade is available right now.

${rows ? `Closest opportunities:\n\n${rows}\n\n` : ''}🛡️ The bot prefers no trade over an unconfirmed setup.`;
  }

  return `🔍 لا توجد صفقة قوية مناسبة حاليًا.

${rows ? `أقرب الفرص:\n\n${rows}\n\n` : ''}🛡️ البوت يفضّل عدم الدخول بدل إرسال صفقة غير مؤكدة.`;
}

function tradeText(ctx, trade) {
  const en = isEn(ctx);
  if (!trade) {
    return en
      ? '🔍 No high-quality trade is available right now.'
      : '🔍 لا توجد صفقة قوية مناسبة حاليًا.';
  }

  const side = trade.action === 'BUY' ? '🟢 BUY' : '🔴 SELL';

  if (en) {
    return `⚡ BEST TRADE NOW
━━━━━━━━━━━━━━━━━━

💱 ${trade.pair} ${side}
⭐ Final Score: ${trade.finalScore ?? '—'}/100
🤖 AI Confidence: ${trade.confidence ?? '—'}%

💰 Entry: ${fmt(trade.entry)}
🛑 SL: ${fmt(trade.sl)}
🎯 TP1: ${fmt(trade.tp1)}
🏆 TP2: ${fmt(trade.tp2)}

⚠️ Analytical setup, not a profit guarantee.`;
  }

  return `⚡ أفضل صفقة الآن
━━━━━━━━━━━━━━━━━━

💱 ${trade.pair} ${side}
⭐ التقييم النهائي: ${trade.finalScore ?? '—'}/100
🤖 ثقة AI: ${trade.confidence ?? '—'}%

💰 الدخول: ${fmt(trade.entry)}
🛑 وقف الخسارة: ${fmt(trade.sl)}
🎯 TP1: ${fmt(trade.tp1)}
🏆 TP2: ${fmt(trade.tp2)}

⚠️ إعداد تحليلي وليس ضمانًا للربح.`;
}

function scannerText(ctx, rows) {
  const en = isEn(ctx);
  if (!rows?.length) {
    return en ? '🔍 No scanner opportunities right now.' : '🔍 لا توجد فرص مناسبة حاليًا.';
  }

  const top = rows.slice(0, 5).map((x, i) =>
    `${i + 1}. ${x.pair} | ${x.action || 'WAIT'} | ⭐ ${x.score ?? 0}/100`
  ).join('\n');

  return `${en ? '🔎 SMART SCANNER' : '🔎 الماسح الذكي'}
━━━━━━━━━━━━━━━━━━

${top}`;
}

function trendText(ctx, rows) {
  const en = isEn(ctx);
  const top = (rows || []).slice(0, 8).map((x, i) =>
    `${i + 1}. ${x.pair} | ${x.direction || 'WAIT'} | ⭐ ${x.score ?? 0}/100 | ${x.status}`
  ).join('\n');

  return `${en ? '📡 TREND HUNTER' : '📡 صياد الترند'}
━━━━━━━━━━━━━━━━━━

${top || (en ? 'No data.' : 'لا توجد بيانات.')}`;
}

function mapText(ctx, data) {
  const en = isEn(ctx);
  const rows = (data?.ranked || []).slice(0, 8).map((x, i) =>
    `${i + 1}. ${x.pair} | ${x.direction || 'WAIT'} | ⭐ ${x.marketScore ?? x.score ?? 0}/100 | ${x.status}`
  ).join('\n');

  return `${en ? '🧭 MARKET MAP' : '🧭 خريطة السوق'}
━━━━━━━━━━━━━━━━━━

${rows || (en ? 'No data.' : 'لا توجد بيانات.')}`;
}

function upcomingNewsText(ctx, events) {
  const en = isEn(ctx);
  const now = Date.now();

  const rows = (events || [])
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return Number.isFinite(t) && t >= now;
    })
    .filter((e) => {
      try { return isHighImpact(e); } catch (_) { return true; }
    })
    .sort((a,b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  if (!rows.length) {
    return en
      ? '📰 No upcoming high-impact events found in the current calendar.'
      : '📰 لا توجد أخبار عالية التأثير قادمة في التقويم الحالي.';
  }

  const body = rows.map((e, i) => {
    const time = new Date(e.date).toLocaleString(
      en ? 'en-GB' : 'ar-EG',
      { timeZone: process.env.NEWS_TIMEZONE || 'Africa/Cairo' }
    );
    return `${i + 1}. ${e.currency || '-'} — ${e.title}\n⏰ ${time}`;
  }).join('\n\n');

  return `${en ? '📰 UPCOMING HIGH-IMPACT NEWS' : '📰 الأخبار القوية القادمة'}
━━━━━━━━━━━━━━━━━━

${body}`;
}

function helpText(ctx) {
  const en = isEn(ctx);

  if (en) {
    return `ℹ️ BOT COMMANDS

/start — Start the bot
/menu — Main menu
/trade — Best trade now
/scanner — Smart Scanner
/trend — Trend Hunter
/map — Market Map
/analysis XAUUSD — Analyze an asset
/gold — Direct XAUUSD analysis
/news — Upcoming high-impact news
/alerts — Open alert controls
/status — My account
/ref — Referral
/vip — VIP
/help — This help

Supported assets:
${PAIRS.join(', ')}`;
  }

  return `ℹ️ أوامر البوت

/start — تشغيل البوت
/menu — القائمة الرئيسية
/trade — أفضل صفقة الآن
/scanner — الماسح الذكي
/trend — صياد الترند
/map — خريطة السوق
/analysis XAUUSD — تحليل أصل محدد
/gold — تحليل الذهب مباشرة
/news — الأخبار القوية القادمة
/alerts — إعدادات التنبيهات
/status — حسابي
/ref — الإحالة
/vip — VIP
/help — المساعدة

الأصول المدعومة:
${PAIRS.join(', ')}`;
}

const {
  consumeFeature,
  limitMessage
} = require('../services/dailyUsageGate');


async function checkDailySlashLimit(ctx, feature) {
  const result =
    consumeFeature(
      ctx.from?.id,
      feature
    );

  if (result.allowed) {
    return true;
  }

  return ctx.reply(
    limitMessage(
      feature,
      isEn(ctx)
    ),
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                isEn(ctx)
                  ? '💎 Upgrade to VIP'
                  : '💎 اشترك VIP',
              callback_data:
                'vip_monthly'
            }
          ]
        ]
      }
    }
  ).then(() => false);
}

function registerSlashCommands(bot) {
  bot.command('gold', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'analysis'))) return;

    try {
      await ctx.reply(isEn(ctx) ? '🥇 Analyzing XAUUSD...' : '🥇 جاري تحليل الذهب XAUUSD...');
      const result = await analyzePair('XAUUSD');
      return ctx.reply(analysisText(ctx, 'XAUUSD', result), menu(ctx));
    } catch (error) {
      console.log('/gold error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ Gold analysis failed.' : '❌ تعذر تحليل الذهب.');
    }
  });

  bot.command('analysis', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'analysis'))) return;

    const pair = parsePair(ctx);

    if (!pair) {
      return ctx.reply(
        isEn(ctx)
          ? `Usage: /analysis XAUUSD\nSupported: ${PAIRS.join(', ')}`
          : `الاستخدام: /analysis XAUUSD\nالمتاح: ${PAIRS.join(', ')}`
      );
    }

    try {
      await ctx.reply(isEn(ctx) ? `🔎 Analyzing ${pair}...` : `🔎 جاري تحليل ${pair}...`);
      const result = await analyzePair(pair);
      return ctx.reply(analysisText(ctx, pair, result), menu(ctx));
    } catch (error) {
      console.log('/analysis error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ Analysis failed.' : '❌ تعذر إكمال التحليل.');
    }
  });

  bot.command('trade', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'trade_now'))) return;

    try {
      await ctx.reply(isEn(ctx) ? '⚡ Searching for the best trade...' : '⚡ جاري البحث عن أفضل صفقة...');
      const trade = await getBestTrade();

      if (!trade) {
        return ctx.reply(
          noTradeDiagnosticsText(ctx),
          menu(ctx)
        );
      }

      return ctx.reply(tradeText(ctx, trade), menu(ctx));
    } catch (error) {
      console.log('/trade error:', error.stack || error);
      return ctx.reply(isEn(ctx) ? '❌ Trade search failed.' : '❌ تعذر البحث عن الصفقة.');
    }
  });

  bot.command('scanner', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'scanner'))) return;

    try {
      await ctx.reply(isEn(ctx) ? '🔎 Scanning markets...' : '🔎 جاري فحص الأسواق...');
      const rows = await scanMarkets();
      return ctx.reply(scannerText(ctx, rows), menu(ctx));
    } catch (error) {
      console.log('/scanner error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ Scanner failed.' : '❌ تعذر تشغيل الماسح.');
    }
  });

  bot.command('trend', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'trend_hunter'))) return;

    try {
      await ctx.reply(isEn(ctx) ? '📡 Scanning trends...' : '📡 جاري فحص الترندات...');
      const rows = await scanTrends();
      return ctx.reply(trendText(ctx, rows), menu(ctx));
    } catch (error) {
      console.log('/trend error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ Trend scan failed.' : '❌ تعذر فحص الترند.');
    }
  });

  bot.command('map', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'market_map'))) return;

    try {
      await ctx.reply(isEn(ctx) ? '🧭 Building Market Map...' : '🧭 جاري بناء خريطة السوق...');
      const data = await buildMarketMap();
      return ctx.reply(mapText(ctx, data), menu(ctx));
    } catch (error) {
      console.log('/map error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ Market Map failed.' : '❌ تعذر بناء خريطة السوق.');
    }
  });

  bot.command('news', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'news'))) return;

    try {
      const events = await getEconomicCalendar();
      return ctx.reply(upcomingNewsText(ctx, events), menu(ctx));
    } catch (error) {
      console.log('/news error:', error.message);
      return ctx.reply(isEn(ctx) ? '❌ News calendar unavailable.' : '❌ تقويم الأخبار غير متاح حاليًا.');
    }
  });

  bot.command('alerts', async (ctx) => {
    if (!(await checkDailySlashLimit(ctx, 'alerts'))) return;

    return ctx.reply(
      isEn(ctx)
        ? '🔔 Open “Alerts” from the keyboard below to manage pairs and confidence settings.'
        : '🔔 افتح “التنبيهات” من لوحة الأزرار بالأسفل للتحكم في الأزواج ونسبة الثقة.',
      menu(ctx)
    );
  });

  bot.command('help', (ctx) => ctx.reply(helpText(ctx), menu(ctx)));
}

module.exports = registerSlashCommands;
