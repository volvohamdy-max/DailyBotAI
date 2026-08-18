const {
  getStats
} = require('../database/performance');

const {
  findUser
} = require('../database/users');


function isEnglish(ctx) {
  return (
    findUser(ctx.from.id)?.language === 'en'
  );
}


function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}


function pipText(value, withPlus = false) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 'N/A';
  }

  const sign =
    withPlus && n > 0
      ? '+'
      : '';

  return (
    sign +
    n.toLocaleString(
      'en-US',
      {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }
    )
  );
}


function formatStats(stats, en) {

  if (!stats.total) {
    return en
      ? `📊 PERFORMANCE — ${stats.days} DAYS

No tracked trades yet.

The tracker starts collecting verified results from this version onward.`

      : `📊 أداء البوت — آخر ${stats.days} يوم

لا توجد صفقات مسجلة في التتبع حتى الآن.

سيبدأ النظام في تجميع النتائج الموثقة من هذه النسخة فصاعدًا.`;
  }


  const strategyNames = en
    ? { SCALP: '⚡ Scalp V3', REGIME: '🧭 Regime', POWER: '🏆 Power', OTHER: 'Other' }
    : { SCALP: '⚡ سكالب V3', REGIME: '🧭 Regime', POWER: '🏆 Power', OTHER: 'أخرى' };

  const strategyRows = Object.entries(stats.byStrategy || {})
    .filter(([, x]) => x.total > 0)
    .map(([key, x]) =>
      `${strategyNames[key] || key}: ${x.closed}/${x.total} ${en ? 'closed' : 'مغلقة'} | TP2 ${x.tp2} | SL ${x.sl} | Net ${Number(x.netR || 0).toFixed(2)}R`
    )
    .join('\n');

  const pairRows =
    Object.entries(stats.byPair)
      .sort(
        (a, b) =>
          b[1].total - a[1].total
      )
      .slice(0, 5)
      .map(([pair, s]) => {

        if (!s.closed) {
          return (
            `${pair}: ${s.total} ` +
            (en ? 'tracked' : 'متابعة')
          );
        }

        return (
          `${pair}: ${s.closed} ` +
          `${en ? 'closed' : 'مغلقة'} | ` +
          `TP1 ${s.tp1} | ` +
          `TP2 ${s.tp2} | ` +
          `SL ${s.sl}`
        );
      })
      .join('\n');


  const best =
    stats.bestPipTrade;

  const worst =
    stats.worstPipTrade;


  if (en) {

    return `📊 BOT PERFORMANCE — ${stats.days} DAYS
━━━━━━━━━━━━━━━━━━

📌 Tracked trades: ${stats.total}
🟢 Open: ${stats.open}
✅ Closed: ${stats.closed}

🎯 TP1 hit: ${stats.tp1} (${pct(stats.tp1Rate)})
🏆 TP2 hit: ${stats.tp2} (${pct(stats.tp2Rate)})
🛑 SL before TP1: ${stats.pureSl ?? stats.sl}
🟡 TP1 then SL: ${stats.tp1ThenSl || 0}

💰 PERFORMANCE IN PIPS
━━━━━━━━━━━━━━━━━━

📈 Total Pips:
${pipText(stats.totalPips, true)}

📊 Average / trade:
${pipText(stats.avgPips, true)} Pips

🟢 Positive trades: ${stats.winningPipTrades ?? 0}
🔴 Negative trades: ${stats.losingPipTrades ?? 0}
⚪ Breakeven: ${stats.breakevenPipTrades ?? 0}

🏆 Best trade:
${best
  ? `#${best.tradeId} | ${pipText(best.pips, true)} Pips`
  : 'N/A'}

🛑 Worst trade:
${worst
  ? `#${worst.tradeId} | ${pipText(worst.pips)} Pips`
  : 'N/A'}

By strategy:
${strategyRows || '—'}

By asset:
${pairRows || '—'}

ℹ️ XAUUSD calculation uses 0.01 price movement = 1 pip.
⚠️ Historical performance does not guarantee future results.`;
  }


  return `📊 أداء البوت — آخر ${stats.days} يوم
━━━━━━━━━━━━━━━━━━

📌 الصفقات المتابعة: ${stats.total}
🟢 مفتوحة: ${stats.open}
✅ مغلقة: ${stats.closed}

🎯 حققت TP1: ${stats.tp1} (${pct(stats.tp1Rate)})
🏆 حققت TP2: ${stats.tp2} (${pct(stats.tp2Rate)})
🛑 SL قبل TP1: ${stats.pureSl ?? stats.sl}
🟡 TP1 ثم SL: ${stats.tp1ThenSl || 0}

💰 الأداء بالنقاط
━━━━━━━━━━━━━━━━━━

📈 إجمالي Pips:
${pipText(stats.totalPips, true)}

📊 متوسط الصفقة:
${pipText(stats.avgPips, true)} Pips

🟢 صفقات موجبة: ${stats.winningPipTrades ?? 0}
🔴 صفقات سالبة: ${stats.losingPipTrades ?? 0}
⚪ تعادل: ${stats.breakevenPipTrades ?? 0}

🏆 أفضل صفقة:
${best
  ? `#${best.tradeId} | ${pipText(best.pips, true)} Pips`
  : 'غير متاح'}

🛑 أسوأ صفقة:
${worst
  ? `#${worst.tradeId} | ${pipText(worst.pips)} Pips`
  : 'غير متاح'}

حسب الاستراتيجية:
${strategyRows || '—'}

حسب الأصل:
${pairRows || '—'}

ℹ️ في XAUUSD يتم اعتبار حركة 0.01 = نقطة واحدة Pip.
⚠️ الأداء السابق لا يضمن نتائج مستقبلية.`;
}


function registerPerformance(bot) {

  bot.command(
    'performance',
    async (ctx) => {

      try {

        const en =
          isEnglish(ctx);

        const s7 =
          getStats(7);

        const s30 =
          getStats(30);

        await ctx.reply(
          formatStats(
            s7,
            en
          )
        );

        return ctx.reply(
          formatStats(
            s30,
            en
          )
        );

      } catch (error) {

        console.log(
          '/performance error:',
          error.message
        );

        return ctx.reply(
          isEnglish(ctx)
            ? '❌ Performance statistics are temporarily unavailable.'
            : '❌ إحصائيات الأداء غير متاحة مؤقتًا.'
        );
      }
    }
  );
}


module.exports =
  registerPerformance;
