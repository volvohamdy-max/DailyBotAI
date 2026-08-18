const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { mainKeyboard } = require('../keyboards/main');
const { scanTrends, analyzeTrend, PAIRS } = require('../services/trendHunter');
const {
  isWatching,
  toggleWatch,
  removeWatch,
  allWatches
} = require('../database/trendWatch');

function en(ctx) {
  return findUser(ctx.from.id)?.language === 'en';
}

function dir(d) {
  return d === 'BUY' ? '🟢 BUY' : d === 'SELL' ? '🔴 SELL' : '⚪ WAIT';
}

function status(s, e) {
  const m = {
    ENTRY_READY: e ? '🔥 ENTRY READY' : '🔥 دخول جاهز',
    WAIT_PULLBACK: e ? '🟡 WAIT PULLBACK' : '🟡 انتظر تصحيح',
    TREND_FOUND: e ? '📈 TREND FOUND' : '📈 ترند واضح',
    NO_TREND: e ? '⚪ NO TREND' : '⚪ لا يوجد ترند',
    NO_DATA: e ? '⚪ NO DATA' : '⚪ لا توجد بيانات',
    ERROR: e ? '⚪ ERROR' : '⚪ خطأ'
  };
  return m[s] || s;
}

function yn(v, ok, bad) {
  return `${v ? '✅' : '❌'} ${v ? ok : bad}`;
}

function rsiAssessment(x, e) {
  const rsi = Number(x.rsi);

  if (!Number.isFinite(rsi)) {
    return e ? '❌ RSI unavailable' : '❌ RSI غير متاح';
  }

  if (x.direction === 'SELL' && rsi <= 30) {
    return e
      ? `⚠️ RSI oversold (${rsi.toFixed(1)}) — do not chase the sell; wait for a pullback`
      : `⚠️ RSI تشبع بيعي (${rsi.toFixed(1)}) — لا تطارد الهبوط وانتظر Pullback`;
  }

  if (x.direction === 'BUY' && rsi >= 70) {
    return e
      ? `⚠️ RSI overbought (${rsi.toFixed(1)}) — do not chase the buy; wait for a pullback`
      : `⚠️ RSI تشبع شرائي (${rsi.toFixed(1)}) — لا تطارد الصعود وانتظر Pullback`;
  }

  if (x.evidence?.rsiReady) {
    return e
      ? `✅ RSI in entry zone (${rsi.toFixed(1)})`
      : `✅ RSI في منطقة الدخول (${rsi.toFixed(1)})`;
  }

  return e
    ? `❌ RSI outside entry zone (${rsi.toFixed(1)})`
    : `❌ RSI خارج منطقة الدخول (${rsi.toFixed(1)})`;
}

function decisionText(x, e) {
  const rsi = Number(x.rsi);
  const oversoldSell = x.direction === 'SELL' && Number.isFinite(rsi) && rsi <= 30;
  const overboughtBuy = x.direction === 'BUY' && Number.isFinite(rsi) && rsi >= 70;

  if (x.status === 'ENTRY_READY') {
    return e
      ? `🎯 Decision: ENTRY READY

📌 Scenario:
Trend, momentum and AI confirmation are aligned.
Use the displayed risk levels and avoid increasing risk beyond your plan.`
      : `🎯 القرار: الدخول جاهز

📌 السيناريو:
الاتجاه والزخم وتأكيد AI متوافقون.
التزم بمستويات المخاطرة المحددة ولا ترفع المخاطرة عن خطتك.`;
  }

  if (oversoldSell) {
    return e
      ? `🎯 Decision: DO NOT SELL NOW

Main reason:
Price is extended lower and RSI is deeply oversold.

📌 Better scenario:
Wait for a pullback, then require fresh SELL confirmation.`
      : `🎯 القرار: لا تدخل SELL الآن

السبب الرئيسي:
السعر ممتد هبوطًا وRSI في تشبع بيعي شديد.

📌 السيناريو الأفضل:
انتظر Pullback ثم اطلب تأكيد SELL جديد.`;
  }

  if (overboughtBuy) {
    return e
      ? `🎯 Decision: DO NOT BUY NOW

Main reason:
Price is extended higher and RSI is overbought.

📌 Better scenario:
Wait for a pullback, then require fresh BUY confirmation.`
      : `🎯 القرار: لا تدخل BUY الآن

السبب الرئيسي:
السعر ممتد صعودًا وRSI في تشبع شرائي.

📌 السيناريو الأفضل:
انتظر Pullback ثم اطلب تأكيد BUY جديد.`;
  }

  if (x.status === 'WAIT_PULLBACK') {
    return e
      ? `🎯 Decision: WAIT FOR PULLBACK

📌 Better scenario:
Let price retrace, then re-check trend strength, RSI and AI direction.`
      : `🎯 القرار: انتظر التصحيح

📌 السيناريو الأفضل:
انتظر رجوع السعر ثم أعد فحص قوة الترند وRSI واتجاه AI.`;
  }

  const blockers = x.blockers || [];
  const first = blockers[0] || 'confirmation';

  return e
    ? `🎯 Decision: WAIT

Main blocker:
${first}

📌 Better scenario:
Wait until the missing confirmation improves before entering.`
    : `🎯 القرار: انتظار

المانع الرئيسي:
${first}

📌 السيناريو الأفضل:
انتظر تحسن التأكيد الناقص قبل الدخول.`;
}

function detail(x, e) {
  const ev = x.evidence || {};
  const b = x.blockers || [];

  if (e) {
    return `🔍 ${x.pair} — ${dir(x.direction)}
${status(x.status, true)} | ⭐ ${x.score}/100

${yn(ev.emaAligned, 'EMA aligned', 'EMA not aligned')}
${yn(ev.macdAligned, 'MACD aligned', 'MACD not aligned')}
${yn(ev.adxReady, `ADX strong (${Number.isFinite(x.adx) ? x.adx.toFixed(1) : '—'})`, `ADX weak (${Number.isFinite(x.adx) ? x.adx.toFixed(1) : '—'})`)}
${rsiAssessment(x, true)}
${yn(ev.aiReady, `AI confirms ${x.direction} (${x.aiConfidence}%)`, `AI confirmation missing (${x.aiConfidence}%)`)}

🚧 Blocking: ${b.length ? b.join(', ') : 'None'}

${decisionText(x, true)}

⚠️ Analytical conditions, not a profit guarantee.`;
  }

  return `🔍 ${x.pair} — ${dir(x.direction)}
${status(x.status, false)} | ⭐ ${x.score}/100

${yn(ev.emaAligned, 'EMA يؤكد الاتجاه', 'EMA غير متوافق')}
${yn(ev.macdAligned, 'MACD يؤكد الاتجاه', 'MACD غير متوافق')}
${yn(ev.adxReady, `ADX قوي (${Number.isFinite(x.adx) ? x.adx.toFixed(1) : '—'})`, `ADX ضعيف (${Number.isFinite(x.adx) ? x.adx.toFixed(1) : '—'})`)}
${rsiAssessment(x, false)}
${yn(ev.aiReady, `AI يؤكد ${x.direction} (${x.aiConfidence}%)`, `تأكيد AI غير مكتمل (${x.aiConfidence}%)`)}

🚧 المانع الحالي: ${b.length ? b.join(', ') : 'لا يوجد'}

${decisionText(x, false)}

⚠️ هذه شروط تحليلية وليست ضمانًا للربح.`;
}

function buttons(pair, e, watching) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        e ? '🔍 Detailed analysis' : '🔍 تحليل تفصيلي',
        `th_detail_${pair}`
      )
    ],
    [
      Markup.button.callback(
        watching
          ? (e ? '🔕 Stop watching' : '🔕 إلغاء المراقبة')
          : (e ? '🔔 Watch this asset' : '🔔 راقب هذا الأصل'),
        `th_watch_${pair}`
      )
    ]
  ]);
}

function summary(results, e) {
  return `${e ? '📡 TREND HUNTER V2.1' : '📡 صياد الترند V2.1'}
━━━━━━━━━━━━━━━━━━

` + results.map((x, i) => `${i + 1}. ${x.pair} | ${dir(x.direction)}
${status(x.status, e)} | ⭐ ${x.score}/100${x.blockers?.length ? `
🚧 ${e ? 'Waiting for' : 'ينتظر'}: ${x.blockers.slice(0, 3).join(', ')}` : ''}`).join('\n\n');
}

async function watchLoop(bot) {
  const watches = allWatches();

  for (const watch of watches) {
    try {
      const x = await analyzeTrend(watch.pair);

      if (x.status !== 'ENTRY_READY') {
        continue;
      }

      const user = findUser(watch.telegram_id);
      const english = user?.language === 'en';

      await bot.telegram.sendMessage(
        watch.telegram_id,
        (english ? '🔥 WATCH ALERT\n\n' : '🔥 تنبيه المراقبة\n\n') +
        detail(x, english)
      );

      // One-shot watch: remove after an ENTRY_READY alert.
      removeWatch(watch.telegram_id, watch.pair);

      console.log(
        `✅ Trend Watch alert sent: ${watch.telegram_id} ${watch.pair}`
      );
    } catch (err) {
      console.log(
        'Trend watch error:',
        watch.telegram_id,
        watch.pair,
        err.message
      );
    }
  }
}

function register(bot) {
  bot.hears(['📡 صياد الترند', '📡 Trend Hunter'], async (ctx) => {
    const e = en(ctx);

    await ctx.reply(
      e ? '📡 Scanning 8 markets...' : '📡 جاري فحص الـ 8 أسواق...'
    );

    try {
      const results = await scanTrends();

      await ctx.reply(summary(results, e));

      for (const x of results.slice(0, 5)) {
        await ctx.reply(
          `${x.pair} — ${status(x.status, e)}`,
          buttons(x.pair, e, isWatching(ctx.from.id, x.pair))
        );
      }

      return ctx.reply(
        e
          ? 'Choose an asset above for details or persistent monitoring.'
          : 'اختر أصلًا بالأعلى للتحليل أو المراقبة الدائمة.',
        mainKeyboard(e ? 'en' : 'ar')
      );
    } catch (err) {
      console.log('Trend Hunter V2.1:', err.stack || err);

      return ctx.reply(
        e ? '❌ Scan failed.' : '❌ تعذر إكمال الفحص.'
      );
    }
  });

  bot.action(/^th_detail_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const pair = ctx.match[1];
    if (!PAIRS.includes(pair)) return;

    const x = await analyzeTrend(pair);
    const e = en(ctx);

    return ctx.editMessageText(
      detail(x, e),
      buttons(pair, e, isWatching(ctx.from.id, pair))
    );
  });

  bot.action(/^th_watch_(.+)$/, async (ctx) => {
    const pair = ctx.match[1];

    if (!PAIRS.includes(pair)) {
      return ctx.answerCbQuery();
    }

    const watching = toggleWatch(ctx.from.id, pair);
    const e = en(ctx);

    await ctx.answerCbQuery(
      watching
        ? (e ? 'Persistent watch started' : 'تم بدء المراقبة وحفظها')
        : (e ? 'Watching stopped' : 'تم إلغاء المراقبة')
    );

    const x = await analyzeTrend(pair);

    return ctx.editMessageText(
      detail(x, e),
      buttons(pair, e, watching)
    );
  });

  setInterval(
    () => watchLoop(bot).catch((error) =>
      console.log('Trend watch loop:', error.message)
    ),
    5 * 60 * 1000
  );

  console.log('🔔 Persistent Trend Watch scheduled every 5 minutes');
}

module.exports = register;
