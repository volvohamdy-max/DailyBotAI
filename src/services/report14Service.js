const db = require('../database/db');

const {
  getStats
} = require('../database/performance');

const {
  getShadowStats
} = require('../database/shadowTrades');

const {
  getRecentHiddenSignals
} = require('../database/hiddenSignals');

const {
  getAdaptiveModel
} = require('./adaptiveIntelligence');


function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}


function pct(a, b) {
  if (!b) return 0;
  return (a / b) * 100;
}


function signed(v, digits = 1) {
  const x = n(v);

  return (
    (x > 0 ? '+' : '') +
    x.toFixed(digits)
  );
}


function maxDrawdownR(days = 14) {
  const cutoff =
    new Date(
      Date.now() -
      days * 24 * 60 * 60 * 1000
    ).toISOString();

  const rows = db.prepare(`
    SELECT realized_r
    FROM trade_performance
    WHERE opened_at >= ?
      AND closed_at IS NOT NULL
      AND realized_r IS NOT NULL
    ORDER BY closed_at ASC
  `).all(cutoff);

  let equity = 0;
  let peak = 0;
  let maxDd = 0;

  for (const row of rows) {
    equity += n(row.realized_r);

    if (equity > peak) {
      peak = equity;
    }

    const dd =
      peak - equity;

    if (dd > maxDd) {
      maxDd = dd;
    }
  }

  return maxDd;
}


function verdict(stats) {
  /*
   * Conservative launch verdict.
   * Not a profit guarantee.
   */

  if (stats.closed < 20) {
    return {
      icon: '🟡',
      title: 'NEEDS MORE DATA',
      reason:
        'العينة ما زالت صغيرة للحكم النهائي.'
    };
  }

  if (
    n(stats.totalR) > 0 &&
    n(stats.totalPips) > 0 &&
    stats.tp1Rate >= 45
  ) {
    return {
      icon: '🟢',
      title: 'PROMISING',
      reason:
        'الأداء موجب حتى الآن، لكن يفضل استمرار الاختبار قبل التوسع.'
    };
  }

  return {
    icon: '🟠',
    title: 'NEEDS REVIEW',
    reason:
      'النتائج تحتاج مراجعة قبل بدء التسويق المدفوع.'
  };
}


function buildReport14() {
  const days = 14;

  const stats =
    getStats(days);

  const shadow =
    getShadowStats(days);

  let hidden = [];

  try {
    hidden =
      getRecentHiddenSignals(days);
  } catch (_) {
    hidden = [];
  }

  const adaptive =
    getAdaptiveModel('XAUUSD');

  const hiddenTp1 =
    hidden.filter(
      x => Number(x.tp1_hit) === 1
    ).length;

  const hiddenTp2 =
    hidden.filter(
      x => Number(x.tp2_hit) === 1
    ).length;

  const hiddenSl =
    hidden.filter(
      x => Number(x.sl_hit) === 1
    ).length;

  const closedForWinRate =
    Math.max(
      0,
      Number(stats.closed || 0)
    );

  const positiveTrades =
    Number(
      stats.winningPipTrades || 0
    );

  const winRate =
    pct(
      positiveTrades,
      closedForWinRate
    );

  const maxDd =
    maxDrawdownR(days);

  const v =
    verdict(stats);


  return `📊 FOREX AI — 14 DAY TEST
━━━━━━━━━━━━━━━━━━

📌 CORE PERFORMANCE

📈 Tracked Trades: ${stats.total}
✅ Closed: ${stats.closed}
🟢 Open: ${stats.open}

🎯 TP1 Hit:
${stats.tp1} (${stats.tp1Rate.toFixed(1)}%)

🏆 TP2 Hit:
${stats.tp2} (${stats.tp2Rate.toFixed(1)}%)

🛑 Pure SL:
${stats.pureSl ?? stats.sl}

🟡 TP1 → SL:
${stats.tp1ThenSl || 0}

━━━━━━━━━━━━━━━━━━
💰 PERFORMANCE

📊 Positive Trades:
${positiveTrades}

🔴 Negative Trades:
${stats.losingPipTrades || 0}

⚪ Breakeven:
${stats.breakevenPipTrades || 0}

📈 Win Rate:
${winRate.toFixed(1)}%

📍 Total Pips:
${signed(stats.totalPips)} Pips

📊 Average / Trade:
${signed(stats.avgPips)} Pips

⚖️ Total R:
${signed(stats.totalR, 2)}R

📉 Max Drawdown:
-${maxDd.toFixed(2)}R

${
  stats.bestPipTrade
    ? `🏆 Best Trade:
#${stats.bestPipTrade.tradeId} | ${signed(stats.bestPipTrade.pips)} Pips`
    : ''
}

${
  stats.worstPipTrade
    ? `🛑 Worst Trade:
#${stats.worstPipTrade.tradeId} | ${signed(stats.worstPipTrade.pips)} Pips`
    : ''
}

━━━━━━━━━━━━━━━━━━
👻 SHADOW INTELLIGENCE

Observed: ${shadow.total}
Closed: ${shadow.closed}
🎯 TP1: ${shadow.tp1}
🏆 TP2: ${shadow.tp2}
🛑 SL: ${shadow.sl}

Shadow TP2 Rate:
${shadow.closed
  ? pct(shadow.tp2, shadow.closed).toFixed(1)
  : '0.0'}%

━━━━━━━━━━━━━━━━━━
🔐 HIDDEN SIGNALS

Signals: ${hidden.length}
🎯 TP1: ${hiddenTp1}
🏆 TP2: ${hiddenTp2}
🛑 SL Recorded: ${hiddenSl}

ℹ️ SL may be silent publicly but remains recorded internally.

━━━━━━━━━━━━━━━━━━
🧠 ADAPTIVE INTELLIGENCE

Mode: ${adaptive.mode}
Samples: ${adaptive.samples}/${adaptive.targetSamples}
Learning: ${adaptive.learningProgress}%
Model Confidence: ${adaptive.modelConfidence}%

━━━━━━━━━━━━━━━━━━
🤖 TEST VERDICT

${v.icon} ${v.title}

${v.reason}

⚠️ التقرير يقيس النتائج المسجلة في النظام ولا يضمن نتائج مستقبلية.`;
}


module.exports = {
  buildReport14,
  maxDrawdownR
};
