const os = require('os');
const db = require('../database/db');
const { requireAdmin } = require('../utils/auth');
const config = require('../config');
const {
  getStats: getPerformanceStats
} = require('../database/performance');
const {
  getOpenTrades
} = require('../database/trades');
const {
  getLastRejectedCandidates
} = require('../services/bestTrade');
const {
  getAllSettings,
  getNumberSetting,
  setSetting,
  toggleSetting
} = require('../database/adminControl');
const {
  adminV2Keyboard,
  controlsKeyboard
} = require('../keyboards/adminV2');

function safeCount(sql, params = []) {
  try {
    const row = db.prepare(sql).get(...params);
    return Number(row?.count || row?.total || 0);
  } catch {
    return 0;
  }
}

function fmt(n, digits = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : 'N/A';
}

function uptimeText() {
  const sec = Math.floor(process.uptime());
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function dashboardText() {
  const totalUsers = safeCount(
    'SELECT COUNT(*) AS count FROM users'
  );

  const vipUsers = safeCount(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE is_vip = 1
      AND (
        vip_expires_at IS NULL
        OR vip_expires_at > datetime('now')
      )
  `);

  const openTrades = safeCount(`
    SELECT COUNT(*) AS count
    FROM trades
    WHERE status IN ('open', 'target1')
  `);

  const signalsToday = safeCount(`
    SELECT COUNT(*) AS count
    FROM trade_performance
    WHERE opened_at >= datetime('now', '-1 day')
  `);

  const p7 = getPerformanceStats(7);

  return `🎛️ FOREX AI — Admin Control Center
━━━━━━━━━━━━━━━━━━

🤖 حالة البوت: 🟢 Online
⏱️ Uptime: ${uptimeText()}

👥 المستخدمون: ${totalUsers}
💎 VIP: ${vipUsers}

📈 صفقات نشطة: ${openTrades}
⚡ صفقات/إشارات متتبعة 24h: ${signalsToday}

📊 أداء 7 أيام
🎯 TP1: ${p7.tp1} (${fmt(p7.tp1Rate)}%)
🏆 TP2: ${p7.tp2} (${fmt(p7.tp2Rate)}%)
🛑 SL: ${p7.sl} (${fmt(p7.slRate)}%)
📈 Total R: ${p7.totalR == null ? 'N/A' : fmt(p7.totalR, 2)}

اختر القسم المطلوب 👇`;
}

function liveTradesText() {
  let trades = [];

  try {
    trades = getOpenTrades();
  } catch (error) {
    return `📈 الصفقات الحية

❌ تعذر قراءة الصفقات:
${error.message}`;
  }

  if (!trades.length) {
    return `📈 الصفقات الحية
━━━━━━━━━━━━━━━━━━

لا توجد صفقات نشطة حاليًا.`;
  }

  const rows = trades.slice(0, 10).map((t) => {
    return `#${t.id} ${t.pair} ${t.action}
Status: ${t.status}
Entry: ${t.entry}
TP1: ${t.target1}
TP2: ${t.target2}
SL: ${t.stop_loss}`;
  });

  return `📈 الصفقات الحية
━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}`;
}

function performanceText() {
  const p7 = getPerformanceStats(7);
  const p30 = getPerformanceStats(30);
  const p90 = getPerformanceStats(90);

  const row = (p) =>
    `${p.days}d | Trades ${p.total} | TP1 ${fmt(p.tp1Rate)}% | TP2 ${fmt(p.tp2Rate)}% | SL ${fmt(p.slRate)}% | R ${p.totalR == null ? 'N/A' : fmt(p.totalR, 2)}`;

  return `📉 Performance Analytics
━━━━━━━━━━━━━━━━━━

${row(p7)}
${row(p30)}
${row(p90)}

🎯 TP1 waiting TP2 (7d): ${p7.waitingTp2 || 0}
⚡ Reached R (7d): ${p7.reachedR == null ? 'N/A' : fmt(p7.reachedR, 2)}

📌 استخدم /performance للتقرير التفصيلي.`;
}

function decisionsText() {
  let rejected = [];

  try {
    rejected = getLastRejectedCandidates(8);
  } catch {
    rejected = [];
  }

  if (!rejected.length) {
    return `🧠 قرارات الإشارات
━━━━━━━━━━━━━━━━━━

لا توجد Near-Miss decisions محفوظة في الذاكرة حاليًا.

📌 ستظهر هنا آخر الفرص التي رفضها Best Trade بسبب:
• AI Missing
• AI Mismatch
• Confidence منخفض`;
  }

  const rows = rejected.map((x, i) =>
    `${i + 1}. ${x.pair} ${x.action}
Smart: ${x.smartScore}/100
AI: ${x.aiConfidence}%
Reason: ${x.reason}`
  );

  return `🧠 آخر الفرص المرفوضة
━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}`;
}

function usersText() {
  const total = safeCount(
    'SELECT COUNT(*) AS count FROM users'
  );

  const vip = safeCount(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE is_vip = 1
      AND (
        vip_expires_at IS NULL
        OR vip_expires_at > datetime('now')
      )
  `);

  const active24 = safeCount(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE updated_at >= datetime('now', '-1 day')
  `);

  let recent = [];

  try {
    recent = db.prepare(`
      SELECT telegram_id, first_name, username, is_vip, points
      FROM users
      ORDER BY updated_at DESC
      LIMIT 8
    `).all();
  } catch {}

  const rows = recent.map((u) =>
    `${u.is_vip ? '💎' : '👤'} ${u.first_name || u.username || u.telegram_id}
ID: ${u.telegram_id} | Points: ${u.points || 0}`
  );

  return `👥 Users & VIP
━━━━━━━━━━━━━━━━━━

👥 إجمالي: ${total}
💎 VIP: ${vip}
🟢 Active 24h: ${active24}

آخر المستخدمين:
${rows.join('\n\n') || '—'}

أوامر الإدارة:
/addvip ID days
/removevip ID
/addpoints ID points`;
}

function newsText() {
  const count24 = safeCount(`
    SELECT COUNT(*) AS count
    FROM news_alerts
    WHERE created_at >= datetime('now', '-1 day')
  `);

  let recent = [];

  try {
    recent = db.prepare(`
      SELECT news_id, created_at
      FROM news_alerts
      ORDER BY id DESC
      LIMIT 10
    `).all();
  } catch {}

  const rows = recent.map((n) =>
    `• ${String(n.news_id).slice(0, 55)}
  ${n.created_at}`
  );

  return `📰 News Center
━━━━━━━━━━━━━━━━━━

🚨 Alerts recorded 24h: ${count24}

آخر الأحداث:
${rows.join('\n') || '—'}

المصادر الأساسية:
🏛️ BLS
🏛️ BEA
🏛️ Federal Reserve
🟥 Breaking Multi-Feed`;
}

function controlsText() {
  const s = getAllSettings();

  return `🎛️ Bot Controls
━━━━━━━━━━━━━━━━━━

${s.auto_signals_enabled === '1' ? '🟢' : '🔴'} Auto Signals
${s.breaking_news_enabled === '1' ? '🟢' : '🔴'} Breaking News

🤖 Minimum AI: ${s.min_ai_confidence || '60'}%
🥇 Gold Max Risk: ${s.gold_max_risk_pct || '0.35'}%

${s.maintenance_mode === '1' ? '🟠' : '⚪'} Maintenance Mode

⚠️ تغييرات الإعدادات تؤثر على التشغيل الفعلي.`;
}

function healthText() {
  let dbOk = false;

  try {
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {}

  const mem = process.memoryUsage();

  const env = {
    TELEGRAM: Boolean(config.botToken || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN),
    TWELVEDATA: Boolean(config.twelveDataKey || process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_API_KEY),
    EODHD: Boolean(process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN),
    FINNHUB: Boolean(process.env.FINNHUB_API_KEY)
  };

  return `🩺 System Health
━━━━━━━━━━━━━━━━━━

🤖 Bot Process: 🟢 Running
🗄️ Database: ${dbOk ? '🟢 OK' : '🔴 ERROR'}
⏱️ Uptime: ${uptimeText()}

🧠 Memory RSS: ${fmt(mem.rss / 1024 / 1024, 1)} MB
📦 Heap Used: ${fmt(mem.heapUsed / 1024 / 1024, 1)} MB
🖥️ Node: ${process.version}
📱 Platform: ${process.platform}

API Keys:
${env.TELEGRAM ? '🟢' : '🔴'} Telegram
${env.TWELVEDATA ? '🟢' : '🔴'} TwelveData
${env.EODHD ? '🟡' : '⚪'} EODHD
${env.FINNHUB ? '🟡' : '⚪'} Finnhub

📌 EODHD/Finnhub قد يكونان معطلين عمدًا بسبب 402/403.`;
}

async function replyOrEdit(ctx, text, keyboard) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery().catch(() => null);
      return await ctx.editMessageText(text, keyboard);
    }
  } catch {}

  return ctx.reply(text, keyboard);
}

function registerAdminControlCenterV2(bot) {
  bot.action('adminv2_dashboard', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, dashboardText(), adminV2Keyboard());
  });

  bot.action('adminv2_live', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, liveTradesText(), adminV2Keyboard());
  });

  bot.action('adminv2_performance', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, performanceText(), adminV2Keyboard());
  });

  bot.action('adminv2_decisions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, decisionsText(), adminV2Keyboard());
  });

  bot.action('adminv2_users', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, usersText(), adminV2Keyboard());
  });

  bot.action('adminv2_news', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, newsText(), adminV2Keyboard());
  });

  bot.action('adminv2_controls', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const settings = getAllSettings();
    return replyOrEdit(ctx, controlsText(), controlsKeyboard(settings));
  });

  bot.action('adminv2_health', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, healthText(), adminV2Keyboard());
  });

  bot.action('adminv2_toggle_auto', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    toggleSetting('auto_signals_enabled', true);
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_toggle_breaking', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    toggleSetting('breaking_news_enabled', true);
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_toggle_maintenance', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    toggleSetting('maintenance_mode', false);
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_ai_up', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const current = getNumberSetting('min_ai_confidence', 60);
    setSetting('min_ai_confidence', Math.min(95, current + 5));
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_ai_down', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const current = getNumberSetting('min_ai_confidence', 60);
    setSetting('min_ai_confidence', Math.max(50, current - 5));
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_risk_up', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const current = getNumberSetting('gold_max_risk_pct', 0.35);
    setSetting(
      'gold_max_risk_pct',
      Math.min(1.00, current + 0.05).toFixed(2)
    );
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });

  bot.action('adminv2_risk_down', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const current = getNumberSetting('gold_max_risk_pct', 0.35);
    setSetting(
      'gold_max_risk_pct',
      Math.max(0.10, current - 0.05).toFixed(2)
    );
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsKeyboard(getAllSettings())
    );
  });
}

module.exports = registerAdminControlCenterV2;
