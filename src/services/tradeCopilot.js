const { scanGoldScalp } = require('./goldScalper');
const { getPrice } = require('./marketService');

const {
  getActiveCopilotTrades,
  updateCopilotHealth,
  stopCopilotTrade
} = require('../database/copilotTrades');


// =====================================================
// SHARED COPILOT MARKET SNAPSHOT
// One market analysis is shared between all users.
// =====================================================

const COPILOT_SNAPSHOT_TTL_MS =
  Number(process.env.COPILOT_SNAPSHOT_TTL_MS) ||
  25 * 1000;

let copilotSnapshot = null;
let copilotSnapshotPromise = null;

async function getCopilotMarketSnapshot(force = false) {
  const now = Date.now();

  if (
    !force &&
    copilotSnapshot &&
    now - copilotSnapshot.createdAt <
      COPILOT_SNAPSHOT_TTL_MS
  ) {
    return copilotSnapshot;
  }

  // Prevent 200 simultaneous users from starting
  // 200 identical market requests.
  if (copilotSnapshotPromise) {
    return copilotSnapshotPromise;
  }

  copilotSnapshotPromise = (async () => {
    console.log(
      '🧠 Building shared Copilot market snapshot...'
    );

    const scalp = await scanGoldScalp();

    let currentPrice = null;

    try {
      currentPrice = finite(
        await getPrice('XAUUSD')
      );
    } catch (error) {
      console.log(
        '⚠️ Copilot snapshot price fallback:',
        error.message
      );
    }

    if (currentPrice == null) {
      currentPrice = finite(scalp.entry);
    }

    if (currentPrice == null) {
      throw new Error(
        'Copilot cannot determine XAUUSD price'
      );
    }

    const snapshot = {
      scalp,
      currentPrice,
      createdAt: Date.now()
    };

    copilotSnapshot = snapshot;

    console.log(
      `✅ Shared Copilot snapshot ready | price=${currentPrice}`
    );

    return snapshot;
  })();

  try {
    return await copilotSnapshotPromise;
  } finally {
    copilotSnapshotPromise = null;
  }
}


// =====================================================
// COPILOT NOTIFICATION ANTI-SPAM
// =====================================================

const COPILOT_ALERT_COOLDOWN_MS =
  Number(process.env.COPILOT_ALERT_COOLDOWN_MS) ||
  5 * 60 * 1000;

const copilotAlertState = new Map();

function shouldSendCopilotAlert(
  trade,
  result,
  previousStatus
) {
  const key = String(trade.id);

  const previous =
    String(previousStatus || 'NEW');

  const current =
    String(result.healthStatus || 'UNKNOWN');

  const terminal =
    result.terminal || null;

  const now = Date.now();

  const state =
    copilotAlertState.get(key) || {
      lastSentAt: 0,
      lastStatus: previous,
      lastTerminal: null
    };

  // TP / SL events should never be hidden
  // by the normal notification cooldown.
  if (
    terminal &&
    terminal !== state.lastTerminal
  ) {
    copilotAlertState.set(key, {
      lastSentAt: now,
      lastStatus: current,
      lastTerminal: terminal
    });

    return {
      send: true,
      reason: 'TERMINAL'
    };
  }

  // Main rule:
  // alert immediately when health changes.
  if (
    previous !== 'NEW' &&
    current !== previous
  ) {
    copilotAlertState.set(key, {
      lastSentAt: now,
      lastStatus: current,
      lastTerminal:
        state.lastTerminal
    });

    return {
      send: true,
      reason: 'STATUS_CHANGED'
    };
  }

  // Same status = no repeated message.
  return {
    send: false,
    reason: 'NO_IMPORTANT_CHANGE'
  };
}

function clearCopilotAlertState(tradeId) {
  copilotAlertState.delete(
    String(tradeId)
  );
}


function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function directionEmoji(action) {
  return action === 'BUY' ? '📈' : '📉';
}

function statusEmoji(status) {
  if (status === 'STRONG') return '🔥';
  if (status === 'HEALTHY') return '🟢';
  if (status === 'WARNING') return '🟡';
  if (status === 'INVALIDATED') return '🔴';
  return '⚪';
}

function statusArabic(status) {
  return ({
    STRONG: 'قوية',
    HEALTHY: 'سليمة',
    WARNING: 'تحتاج مراقبة',
    INVALIDATED: 'ضعفت فنيًا'
  })[status] || status;
}

async function evaluateCopilotTrade(trade) {
  const action =
    String(trade.action || '')
      .toUpperCase();

  if (
    action !== 'BUY' &&
    action !== 'SELL'
  ) {
    throw new Error(
      'Copilot action must be BUY or SELL'
    );
  }

  // Shared market snapshot:
  // all Copilot users reuse the same XAUUSD analysis.
  const snapshot =
    await getCopilotMarketSnapshot();

  const scalp =
    snapshot.scalp;

  const currentPrice =
    snapshot.currentPrice;

  const entry =
    finite(trade.entry);

  if (entry == null) {
    throw new Error(
      'Invalid Copilot entry price'
    );
  }

  const trend15 =
    scalp.trend15 || 'WAIT';

  const ema9 =
    finite(scalp.ema9);

  const ema20 =
    finite(scalp.ema20);

  const vwap5 =
    finite(scalp.vwap5);

  const rsi5 =
    finite(scalp.rsi5);

  const adx5 =
    finite(scalp.adx5);

  const atr5 =
    finite(scalp.atr5);

  const momentum =
    scalp.momentum || {
      direction: 'WAIT',
      strength: 0
    };

  let score = 50;

  const positives = [];
  const warnings = [];
  const critical = [];

  // ==========================================
  // 15M TREND
  // ==========================================

  if (trend15 === action) {
    score += 18;
    positives.push(
      'اتجاه 15M يدعم الصفقة'
    );
  } else if (
    trend15 !== 'WAIT' &&
    trend15 !== action
  ) {
    score -= 24;
    critical.push(
      'اتجاه 15M عكس الصفقة'
    );
  } else {
    warnings.push(
      'اتجاه 15M غير محسوم'
    );
  }

  // ==========================================
  // EMA STRUCTURE
  // ==========================================

  if (
    ema9 != null &&
    ema20 != null
  ) {
    const emaAligned =
      (
        action === 'BUY' &&
        ema9 > ema20
      ) ||
      (
        action === 'SELL' &&
        ema9 < ema20
      );

    if (emaAligned) {
      score += 14;
      positives.push(
        'ترتيب EMA ما زال داعمًا'
      );
    } else {
      score -= 16;
      warnings.push(
        'ترتيب EMA لم يعد يدعم الاتجاه'
      );
    }
  }

  // ==========================================
  // MOMENTUM
  // ==========================================

  if (
    momentum.direction === action
  ) {
    score +=
      Number(momentum.strength) >= 3
        ? 14
        : 9;

    positives.push(
      'الزخم يدعم الصفقة'
    );

  } else if (
    momentum.direction !== 'WAIT'
  ) {
    score -= 18;

    warnings.push(
      'الزخم تحوّل ضد الصفقة'
    );
  } else {
    score -= 4;

    warnings.push(
      'الزخم الحالي ضعيف'
    );
  }

  // ==========================================
  // VWAP
  // ==========================================

  if (vwap5 != null) {
    const vwapAligned =
      (
        action === 'BUY' &&
        currentPrice >= vwap5
      ) ||
      (
        action === 'SELL' &&
        currentPrice <= vwap5
      );

    if (vwapAligned) {
      score += 10;

      positives.push(
        'السعر في الجانب الصحيح من VWAP'
      );
    } else {
      score -= 14;

      warnings.push(
        'السعر فقد VWAP'
      );
    }
  }

  // ==========================================
  // ADX
  // ==========================================

  if (adx5 != null) {
    if (adx5 >= 25) {
      score += 8;

      positives.push(
        `قوة الاتجاه جيدة ADX ${adx5.toFixed(1)}`
      );

    } else if (adx5 < 18) {
      score -= 8;

      warnings.push(
        `قوة الاتجاه ضعيفة ADX ${adx5.toFixed(1)}`
      );
    }
  }

  // ==========================================
  // RSI
  // ==========================================

  if (rsi5 != null) {
    if (
      action === 'BUY' &&
      rsi5 >= 80
    ) {
      score -= 10;

      warnings.push(
        `RSI مرتفع جدًا (${rsi5.toFixed(1)})`
      );

    } else if (
      action === 'SELL' &&
      rsi5 <= 20
    ) {
      score -= 10;

      warnings.push(
        `RSI منخفض جدًا (${rsi5.toFixed(1)})`
      );

    } else if (
      action === 'BUY' &&
      rsi5 >= 50 &&
      rsi5 < 75
    ) {
      score += 5;

      positives.push(
        'RSI يدعم الشراء'
      );

    } else if (
      action === 'SELL' &&
      rsi5 <= 50 &&
      rsi5 > 25
    ) {
      score += 5;

      positives.push(
        'RSI يدعم البيع'
      );
    }
  }

  // ==========================================
  // USER ENTRY PERFORMANCE
  // ==========================================

  const move =
    action === 'BUY'
      ? currentPrice - entry
      : entry - currentPrice;

  const moveInAtr =
    atr5 && atr5 > 0
      ? move / atr5
      : null;

  if (move > 0) {
    score += 4;

    positives.push(
      `الصفقة حاليًا في الاتجاه الصحيح ${
        move >= 0
          ? '+' + move.toFixed(2)
          : move.toFixed(2)
      }`
    );

  } else if (
    moveInAtr != null &&
    moveInAtr <= -1
  ) {
    score -= 12;

    warnings.push(
      'السعر تحرك أكثر من ATR تقريبًا ضد الدخول'
    );
  }

  // ==========================================
  // USER SL / TP
  // ==========================================

  const stopLoss =
    finite(trade.stop_loss);

  const target1 =
    finite(trade.target1);

  const target2 =
    finite(trade.target2);

  let terminal = null;

  if (action === 'BUY') {
    if (
      stopLoss != null &&
      currentPrice <= stopLoss
    ) {
      terminal = 'SL';
    } else if (
      target2 != null &&
      currentPrice >= target2
    ) {
      terminal = 'TP2';
    } else if (
      target1 != null &&
      currentPrice >= target1
    ) {
      terminal = 'TP1';
    }

  } else {
    if (
      stopLoss != null &&
      currentPrice >= stopLoss
    ) {
      terminal = 'SL';
    } else if (
      target2 != null &&
      currentPrice <= target2
    ) {
      terminal = 'TP2';
    } else if (
      target1 != null &&
      currentPrice <= target1
    ) {
      terminal = 'TP1';
    }
  }

  score =
    clamp(
      Math.round(score),
      0,
      100
    );

  let healthStatus;

  if (
    terminal === 'SL'
  ) {
    healthStatus =
      'INVALIDATED';

    critical.push(
      'السعر وصل إلى وقف الخسارة المحدد'
    );

  } else if (
    critical.length >= 2 ||
    score < 38
  ) {
    healthStatus =
      'INVALIDATED';

  } else if (
    score >= 82 &&
    critical.length === 0
  ) {
    healthStatus =
      'STRONG';

  } else if (
    score >= 64 &&
    critical.length === 0
  ) {
    healthStatus =
      'HEALTHY';

  } else {
    healthStatus =
      'WARNING';
  }

  return {
    pair: 'XAUUSD',

    action,
    entry,
    currentPrice,

    healthStatus,
    score,

    terminal,

    market: {
      trend15,
      ema9,
      ema20,
      vwap5,
      rsi5,
      adx5,
      atr5,
      momentum
    },

    positives,
    warnings,
    critical,

    scalpStatus:
      scalp.status || null,

    scalpDirection:
      scalp.direction || null
  };
}

function buildCopilotMessage(
  trade,
  result,
  previousStatus = null
) {
  const changed =
    previousStatus &&
    previousStatus !== 'NEW'
      ? `\n🔄 ${statusEmoji(previousStatus)} ${statusArabic(previousStatus)} → ${statusEmoji(result.healthStatus)} ${statusArabic(result.healthStatus)}\n`
      : '';

  const positiveText =
    result.positives
      .slice(0, 4)
      .map(x => `✅ ${x}`)
      .join('\n');

  const warningText =
    result.warnings
      .slice(0, 4)
      .map(x => `⚠️ ${x}`)
      .join('\n');

  const criticalText =
    result.critical
      .slice(0, 3)
      .map(x => `❌ ${x}`)
      .join('\n');

  return `🤖 TRADE COPILOT
━━━━━━━━━━━━━━━━━━

🥇 XAUUSD
${directionEmoji(result.action)} صفقتك: ${result.action}

🎯 دخولك:
${Number(result.entry).toFixed(2)}

💰 السعر الحالي:
${Number(result.currentPrice).toFixed(2)}
${changed}
${statusEmoji(result.healthStatus)} حالة الصفقة:
${statusArabic(result.healthStatus)}

⭐ صحة الصفقة:
${result.score}/100

━━━━━━━━━━━━━━━━━━
📊 قراءة السوق

${positiveText || '—'}

${warningText || ''}

${criticalText || ''}

━━━━━━━━━━━━━━━━━━
👁️ المتابعة الآلية مفعلة

لن يصلك تنبيه إلا عند حدوث تغير مهم في حالة الصفقة.

⚠️ التحليل فني ومعلوماتي ولا يضمن نتيجة التداول.`;
}

async function monitorCopilotTrades(bot) {
  const trades =
    getActiveCopilotTrades();

  if (!trades.length) {
    return;
  }

  console.log(
    `🤖 COPILOT: ${trades.length} active trade(s)`
  );

  for (const trade of trades) {
    try {
      const previousStatus =
        String(
          trade.health_status || 'NEW'
        );

      const result =
        await evaluateCopilotTrade(
          trade
        );

      updateCopilotHealth(
        trade.id,
        result.healthStatus,
        result.currentPrice,
        result.score,
        [
          ...result.critical,
          ...result.warnings
        ]
          .slice(0, 3)
          .join(' | ')
      );

      const alertDecision =
        shouldSendCopilotAlert(
          trade,
          result,
          previousStatus
        );

      console.log(
        `🤖 COPILOT ALERT ${trade.id}:`,
        {
          previousStatus,
          currentStatus: result.healthStatus,
          terminal: result.terminal,
          send: alertDecision.send,
          reason: alertDecision.reason
        }
      );

      // Initial state is sent when the trade is created
      // in user.js, so the background monitor should only
      // send genuinely important changes.
      if (
        previousStatus !== 'NEW' &&
        alertDecision.send
      ) {
        await bot.telegram.sendMessage(
          trade.telegram_id,
          buildCopilotMessage(
            trade,
            result,
            previousStatus
          )
        );
      }

      // Terminal SL = stop monitoring.
      if (
        result.terminal === 'SL'
      ) {
        stopCopilotTrade(
          trade.id
        );

        clearCopilotAlertState(
          trade.id
        );
      }

    } catch (error) {
      console.log(
        `❌ Copilot trade ${trade.id}:`,
        error.message
      );
    }
  }
}

module.exports = {
  evaluateCopilotTrade,
  buildCopilotMessage,
  monitorCopilotTrades
};
