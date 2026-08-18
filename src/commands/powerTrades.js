const {
  getPowerStats
} = require('../database/powerTrades');


function pct(a, b) {
  return b
    ? ((a / b) * 100).toFixed(1)
    : '0.0';
}


function signed(v) {
  const n = Number(v || 0);

  return (
    (n > 0 ? '+' : '') +
    n.toFixed(2)
  );
}


function buildPowerReport(days = 30) {

  const s =
    getPowerStats(days);


  if (!s.total) {
    return `⚡ المضاعفات — POWER TRADES
━━━━━━━━━━━━━━━━━━

🧪 الوضع الحالي:
SHADOW VALIDATION

لا توجد صفقات Power مسجلة حتى الآن.

البوت يراقب الصفقات ذات التأكيد الاستثنائي
ويقارن نتائجها بالصفقات العادية.

⚠️ لا يتم رفع المخاطرة الحقيقية حاليًا.`;
  }


  return `⚡ المضاعفات — POWER TRADES
━━━━━━━━━━━━━━━━━━

🧪 MODE:
SHADOW VALIDATION

📊 آخر ${days} يوم

⚡ Power Trades:
${s.total}

✅ مغلقة:
${s.closed}

🟢 مفتوحة:
${s.open}

━━━━━━━━━━━━━━━━━━

🎯 TP1:
${s.tp1} (${pct(s.tp1, s.closed)}%)

🏆 TP2:
${s.tp2} (${pct(s.tp2, s.closed)}%)

🛑 SL قبل TP1:
${s.pureSl}

🟡 TP1 → SL:
${s.tp1ThenSl}

━━━━━━━━━━━━━━━━━━

⚖️ Average R:
${signed(s.avgR)}R

📈 Total R:
${signed(s.totalR)}R

━━━━━━━━━━━━━━━━━━

🔬 VALIDATION STATUS:

${
  s.closed < 20
    ? `🟡 عينة أولية
${s.closed}/20 صفقة مغلقة`
    : s.closed < 50
      ? `🟠 جاري التحقق
${s.closed}/50 صفقة`
      : `🟢 عينة قابلة للتقييم
${s.closed} صفقة مغلقة`
}

⚠️ Power Trades حاليًا تصنيف إحصائي فقط.
لا يتم مضاعفة اللوت أو المخاطرة تلقائيًا.`;
}


function registerPowerTrades(bot) {

  bot.command(
    'power',
    async ctx => {

      try {
        return ctx.reply(
          buildPowerReport(30)
        );

      } catch (error) {

        console.log(
          '/power error:',
          error.stack ||
          error.message
        );

        return ctx.reply(
          '❌ تعذر تحميل بيانات المضاعفات.'
        );
      }
    }
  );


  bot.hears(
    [
      '⚡ المضاعفات',
      '⚡ Power Trades'
    ],
    async ctx => {

      return ctx.reply(
        buildPowerReport(30)
      );
    }
  );
}


module.exports =
  registerPowerTrades;
