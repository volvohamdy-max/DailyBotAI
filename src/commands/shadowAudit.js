const {
  getShadowStats,
  getClosedShadowTrades
} = require('../database/shadowTrades');


const FEATURES = [
  ['ema_ok', 'EMA'],
  ['rsi_ok', 'RSI'],
  ['adx_ok', 'ADX'],
  ['vwap_ok', 'VWAP'],
  ['momentum_ok', 'Momentum']
];


function pct(a, b) {
  if (!b) return '0.0';

  return (
    (a / b) * 100
  ).toFixed(1);
}


function buildFeatureAudit(rows) {
  return FEATURES.map(
    ([column, label]) => {

      /*
       * We specifically examine trades where
       * this condition was missing.
       */
      const rejected =
        rows.filter(
          row =>
            Number(row[column]) !== 1
        );


      const tp2 =
        rejected.filter(
          row =>
            row.outcome === 'TP2'
        ).length;


      const sl =
        rejected.filter(
          row =>
            row.outcome === 'SL'
        ).length;


      return {
        label,
        total: rejected.length,
        tp2,
        sl,
        successRate:
          rejected.length
            ? (
                tp2 /
                rejected.length
              ) * 100
            : 0
      };
    }
  )
  .sort(
    (a, b) =>
      b.successRate -
      a.successRate
  );
}


function buildReport(days = 30) {
  const stats =
    getShadowStats(days);

  const closed =
    getClosedShadowTrades(days);

  if (!stats.total) {
    return `👻 SHADOW DECISION AUDIT
━━━━━━━━━━━━━━━━━━

📊 لا توجد Shadow Trades مسجلة خلال آخر ${days} يوم.

النظام بدأ الآن في جمع القرارات المرفوضة ومراقبتها في الظل.

كلما زادت العينة، أصبح تحليل الفلاتر أدق.`;
  }


  const audit =
    buildFeatureAudit(closed);


  const featureText =
    audit.map(item => {

      if (!item.total) {
        return `• ${item.label}
لا توجد عينة كافية`;
      }

      return `• ${item.label}
رفض: ${item.total}
🏆 TP2 رغم غياب الشرط: ${item.tp2}
🛑 SL: ${item.sl}
📈 Missed Success: ${item.successRate.toFixed(1)}%`;

    }).join('\n\n');


  const best =
    audit.find(
      x => x.total >= 5
    );


  let discovery =
    '⏳ نحتاج عينة أكبر قبل إصدار استنتاج.';


  if (best) {
    discovery =
`🧠 أعلى فلتر يحتاج للمراجعة حاليًا:
${best.label}

من ${best.total} فرصة كان الشرط فيها غير متحقق،
${best.tp2} وصلت TP2 رغم ذلك.

⚠️ هذه ملاحظة إحصائية فقط، وليست تعديلًا تلقائيًا للاستراتيجية.`;
  }


  return `👻 SHADOW DECISION AUDIT — ${days}D
━━━━━━━━━━━━━━━━━━

📊 Shadow Trades: ${stats.total}
🟢 مفتوحة: ${stats.open}
✅ مغلقة: ${stats.closed}

🎯 وصلت TP1: ${stats.tp1}
🏆 وصلت TP2: ${stats.tp2}
🛑 وصلت SL: ${stats.sl}

📈 TP2 Rate:
${pct(stats.tp2, stats.closed)}%

🛑 SL Rate:
${pct(stats.sl, stats.closed)}%

━━━━━━━━━━━━━━━━━━
🔬 MISSED OPPORTUNITY ANALYSIS

${featureText}

━━━━━━━━━━━━━━━━━━
${discovery}

ℹ️ Shadow Trades افتراضية فقط ولا يتم إرسالها كتوصيات تداول.`;
}


function registerShadowAudit(bot) {

  bot.command(
    'shadow',
    async ctx => {
      try {
        return ctx.reply(
          buildReport(30)
        );

      } catch (error) {
        console.log(
          'Shadow audit error:',
          error.message
        );

        return ctx.reply(
          '❌ تعذر عرض Shadow Decision Audit حاليًا.'
        );
      }
    }
  );

}


module.exports =
  registerShadowAudit;
