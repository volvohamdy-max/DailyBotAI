const {
  getStats
} = require('../database/virtualPortfolio');

function money(n) {
  return Number(n || 0).toFixed(2);
}

function signedMoney(n) {
  const x = Number(n || 0);
  return `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(2)}`;
}

function signedPercent(n) {
  const x = Number(n || 0);
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
}

function signedR(n) {
  const x = Number(n || 0);
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}R`;
}

function strategySection(rows, current) {
  const filtered = (rows || []).filter(x => Boolean(x.current) === current);

  if (!filtered.length) {
    return current
      ? 'لا توجد صفقات للاستراتيجيات الحالية حتى الآن.'
      : 'لا توجد صفقات Legacy / Other.';
  }

  return filtered.map(x => {
    const icon = Number(x.profit) > 0
      ? '🟢'
      : Number(x.profit) < 0
        ? '🔴'
        : '⚪';

    return `${icon} ${x.label}\n` +
      `صفقات: ${x.total} | W ${x.wins} / L ${x.losses} / BE ${x.breakeven}\n` +
      `Win Rate: ${Number(x.winRate).toFixed(1)}%\n` +
      `Net: ${signedR(x.netR)} | ${signedMoney(x.profit)}\n` +
      `Max DD: -${Number(x.maxDrawdownR || 0).toFixed(2)}R`;
  }).join('\n\n');
}

function portfolioText() {
  const s = getStats();

  const recent =
    s.recent.length
      ? s.recent.map(x => {
          const icon =
            Number(x.profit_loss) > 0
              ? '🟢'
              : Number(x.profit_loss) < 0
                ? '🔴'
                : '⚪';

          return (
            `${icon} #${x.trade_id} ${x.pair} ` +
            `${Number(x.realized_r).toFixed(2)}R | ` +
            `${signedMoney(x.profit_loss)}`
          );
        }).join('\n')
      : 'لا توجد صفقات مغلقة في المحفظة حتى الآن.';

  const currentStrategies = strategySection(s.by_strategy, true);
  const legacyStrategies = strategySection(s.by_strategy, false);

  return `💼 FOREX AI — VIRTUAL PORTFOLIO
━━━━━━━━━━━━━━━━━━

💰 رأس المال الابتدائي:
$${money(s.starting_balance)}

💵 الرصيد الحالي:
$${money(s.balance)}

📈 صافي الربح:
${signedMoney(s.net_profit)}

📊 العائد:
${signedPercent(s.return_percent)}

⚖️ المخاطرة لكل صفقة:
${money(s.risk_percent)}%

📉 أقصى تراجع للمحفظة:
-${money(s.max_drawdown_percent)}%

━━━━━━━━━━━━━━━━━━
📊 الصفقات المغلقة: ${s.total_closed}

🟢 رابحة: ${s.winning_trades}
🔴 خاسرة: ${s.losing_trades}
⚪ تعادل: ${s.breakeven_trades}

━━━━━━━━━━━━━━━━━━
🚀 CURRENT STRATEGIES

${currentStrategies}

━━━━━━━━━━━━━━━━━━
🗃️ LEGACY / OTHER

${legacyStrategies}

━━━━━━━━━━━━━━━━━━
🕘 آخر الصفقات

${recent}

━━━━━━━━━━━━━━━━━━
ℹ️ Current = الاستراتيجيات الحالية المعروفة في البوت.
Legacy / Other = مصادر قديمة أو عامة لا ننسبها لاستراتيجية حالية.
Max DD لكل استراتيجية معروض بوحدة R لتجنب خلطه بتأثير الـcompounding العام.

🧪 محفظة تداول افتراضية.
لا تمثل أموالًا حقيقية أو ضمانًا لنتائج التداول الفعلي.`;
}

function registerVirtualPortfolio(bot) {
  bot.command(
    'portfolio',
    async ctx => {
      try {
        return ctx.reply(
          portfolioText()
        );
      } catch (error) {
        console.error(
          'Virtual Portfolio command error:',
          error.stack || error
        );

        return ctx.reply(
          '❌ تعذر تحميل المحفظة الافتراضية.'
        );
      }
    }
  );

  bot.hears(
    ['💼 المحفظة الافتراضية', '💼 Virtual Portfolio'],
    async ctx => {
      try {
        return ctx.reply(
          portfolioText()
        );
      } catch (error) {
        console.error(
          'Virtual Portfolio button error:',
          error.stack || error
        );

        return ctx.reply(
          '❌ تعذر تحميل المحفظة الافتراضية.'
        );
      }
    }
  );
}

module.exports =
  registerVirtualPortfolio;
