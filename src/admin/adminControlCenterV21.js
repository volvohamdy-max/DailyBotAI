const os = require('os');
const db = require('../database/db');
const { requireAdmin } = require('../utils/auth');
const config = require('../config');
const { analyzeGoldIntelligence } = require('../services/indicatorIntelligence');
const {
  getStats: getPerformanceStats
} = require('../database/performance');
const {
  getOpenTrades,
  addTrade
} = require('../database/trades');

const { getPrice, getCandles } = require('../services/marketService');
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
  adminV21Keyboard,
  controlsV21Keyboard,
  maintenanceConfirmKeyboard,
  manualSignalTypeKeyboard,
  manualSignalDirectionKeyboard,
  manualSignalSlKeyboard,
  manualSignalConfirmKeyboard
} = require('../keyboards/adminV21');

function safeCount(sql, params = []) {
  try {
    const row = db.prepare(sql).get(...params);
    return Number(row?.count || row?.total || 0);
  } catch {
    return 0;
  }
}

function safeAll(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function fmt(n, digits = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : 'N/A';
}

function pct(n) {
  return `${fmt(n, 1)}%`;
}

function uptimeText() {
  const sec = Math.floor(process.uptime());
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function currentSettings() {
  return getAllSettings();
}

const manualSignalDrafts = new Map();

function calcAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return null;
  }

  const rows = candles.slice(-(period + 1));
  const ranges = [];

  for (let i = 1; i < rows.length; i++) {
    const high = Number(rows[i].high);
    const low = Number(rows[i].low);
    const prevClose = Number(rows[i - 1].close);

    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(prevClose)
    ) {
      continue;
    }

    ranges.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );
  }

  if (!ranges.length) return null;

  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

async function buildManualGoldSignal(type, direction) {
  const pair = 'XAUUSD';

  const isScalp = type === 'SCALP';

  const timeframe = isScalp
    ? '5min'
    : '15min';

  const [priceRaw, candles, intelligence] = await Promise.all([
    getPrice(pair),
    getCandles(pair, timeframe),

    analyzeGoldIntelligence()
      .catch(error => {
        console.log(
          'Market Intelligence error:',
          error.message
        );

        return null;
      })
  ]);

  const entry = Number(priceRaw);
  const atr = calcAtr(candles, 14);

  if (!Number.isFinite(entry)) {
    throw new Error('Invalid XAUUSD price');
  }

  if (!Number.isFinite(atr) || atr <= 0) {
    throw new Error('Invalid XAUUSD ATR');
  }

  // ======================================
  // SCALPING
  // ======================================

  const riskMultiplier = isScalp
    ? 1.20
    : 1.20;

  const minRisk = isScalp
    ? 3.0
    : 3.5;

  const tp1R = isScalp
    ? 1.20
    : 1.50;

  const tp2R = isScalp
    ? 2.00
    : 2.50;

  const atrRisk = Math.max(
    atr * riskMultiplier,
    minRisk
  );

  let risk = atrRisk;

  // ======================================
  // Smart Scalping SL
  // Uses market structure when available
  // ======================================

  if (isScalp && intelligence?.structure) {

    const margin =
      Math.max(
        atr * 0.15,
        0.5
      );

    if (
      direction === 'BUY' &&
      Number.isFinite(
        Number(
          intelligence.structure.lastSwingLow
        )
      )
    ) {

      const swingLow =
        Number(
          intelligence.structure.lastSwingLow
        );

      const swingRisk =
        entry - swingLow + margin;

      if (swingRisk > 0) {
        risk = Math.max(
          risk,
          swingRisk
        );
      }
    }

    if (
      direction === 'SELL' &&
      Number.isFinite(
        Number(
          intelligence.structure.lastSwingHigh
        )
      )
    ) {

      const swingHigh =
        Number(
          intelligence.structure.lastSwingHigh
        );

      const swingRisk =
        swingHigh - entry + margin;

      if (swingRisk > 0) {
        risk = Math.max(
          risk,
          swingRisk
        );
      }
    }

    // Prevent absurdly wide scalp stops
    const maxRisk =
      Math.max(
        atr * 2.20,
        7.5
      );

    risk = Math.min(
      risk,
      maxRisk
    );
  }

  const sl =
    direction === 'BUY'
      ? entry - risk
      : entry + risk;

  const tp1 =
    direction === 'BUY'
      ? entry + risk * tp1R
      : entry - risk * tp1R;

  const tp2 =
    direction === 'BUY'
      ? entry + risk * tp2R
      : entry - risk * tp2R;

  const zone = Math.max(
    isScalp ? 0.5 : 1.0,
    atr * (isScalp ? 0.18 : 0.25)
  );

  return {
    pair,
    type,
    timeframe,
    direction,

    entry,

    entryFrom:
      entry - zone,

    entryTo:
      entry + zone,

    sl,
    tp1,
    tp2,

    atr,

    rrTp1: tp1R,
    rrTp2: tp2R,

    intelligence
  };
}

function marketIntelligenceText(draft) {
  const intel = draft.intelligence;

  if (!intel) {
    return `🧠 تحليل السوق
⚠️ غير متاح حاليًا`;
  }

  const selected =
    draft.direction;

  const marketBias =
    intel.bias || 'NEUTRAL';

  const confidence =
    Number.isFinite(Number(intel.confidence))
      ? Number(intel.confidence)
      : 0;

  const adx =
    intel.adx;

  const structure =
    intel.structure?.structure || 'UNKNOWN';

  const bos =
    intel.bos || 'NONE';

  const choch =
    intel.choch || 'NONE';

  let agreementText = '';

  if (marketBias === 'NEUTRAL') {
    agreementText =
      '⚪ السوق غير حاسم حاليًا';
  } else if (marketBias === selected) {
    agreementText =
      `✅ اختيارك ${selected} متوافق مع تحليل السوق`;
  } else {
    agreementText =
      `⚠️ اختيارك ${selected} عكس ميل السوق ${marketBias}`;
  }

  const adxText =
    adx
      ? `${adx.adx.toFixed(1)} — ${adx.strength} / ${adx.direction}`
      : 'غير متاح';

  const structureArabic = {
    BULLISH: 'صاعد',
    BEARISH: 'هابط',
    MIXED: 'مختلط',
    RANGE: 'عرضي'
  }[structure] || structure;

  return `🧠 Market Intelligence

📊 ميل السوق: ${marketBias}
🔥 الثقة: ${confidence}%

${agreementText}

📈 ADX:
${adxText}

🏗️ هيكل السوق:
${structureArabic}

🔹 BOS: ${bos}
🔸 CHoCH: ${choch}`;
}

function manualSignalPreviewText(draft) {
  const icon =
    draft.direction === 'BUY'
      ? '📈'
      : '📉';

  const typeText =
    draft.type === 'SCALP'
      ? '⚡ SCALPING'
      : '📈 INTRADAY';

  return `📋 معاينة إشارة الذهب

🥇 الزوج: XAUUSD
${icon} الاتجاه: ${draft.direction}

${typeText}
⏱️ الفريم: ${draft.timeframe}

📍 منطقة الدخول
${draft.entryFrom.toFixed(2)} ➜ ${draft.entryTo.toFixed(2)}

🛑 وقف الخسارة
${draft.sl.toFixed(2)}

🎯 الهدف الأول
${draft.tp1.toFixed(2)}

🎯 الهدف الثاني
${draft.tp2.toFixed(2)}

📊 ATR
${draft.atr.toFixed(2)}

⚖️ العائد للمخاطرة
TP1 → 1:${draft.rrTp1.toFixed(2)}
TP2 → 1:${draft.rrTp2.toFixed(2)}

${marketIntelligenceText(draft)}

هل تريد إرسال الإشارة؟`;
}

function manualSignalSendText(draft) {
  const icon =
    draft.direction === 'BUY'
      ? '📈'
      : '📉';

  const typeText =
    draft.type === 'SCALP'
      ? '⚡ SCALPING'
      : '📈 INTRADAY';

  return `🚨 إشارة ذهب جديدة

🥇 الزوج: XAUUSD
${icon} الاتجاه: ${draft.direction}

${typeText}
⏱️ الفريم: ${draft.timeframe}

📍 منطقة الدخول
${draft.entryFrom.toFixed(2)} ➜ ${draft.entryTo.toFixed(2)}

🛑 وقف الخسارة
${draft.sl.toFixed(2)}

🎯 الهدف الأول
${draft.tp1.toFixed(2)}

🎯 الهدف الثاني
${draft.tp2.toFixed(2)}

📊 ATR
${draft.atr.toFixed(2)}

⚖️ العائد للمخاطرة
TP1 → 1:${draft.rrTp1.toFixed(2)}
TP2 → 1:${draft.rrTp2.toFixed(2)}

🤖 Forex AI Bot`;
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

  const active24 = safeCount(`
    SELECT COUNT(*) AS count
    FROM users
    WHERE updated_at >= datetime('now', '-1 day')
  `);

  const openTrades = safeCount(`
    SELECT COUNT(*) AS count
    FROM trades
    WHERE status IN ('open', 'target1')
  `);

  const p7 = getPerformanceStats(7);
  const s = currentSettings();

  return `🎛️ FOREX AI — Admin Control Center V2.1
━━━━━━━━━━━━━━━━━━

🟢 BOT ONLINE
🟢 DATABASE READY
🟢 MARKET ENGINE ACTIVE

👥 Users: ${totalUsers}
🟢 Active 24h: ${active24}
💎 VIP: ${vipUsers}

📈 Live Trades: ${openTrades}
🎯 TP1 Waiting TP2: ${p7.waitingTp2 || 0}

📊 7-Day Performance
🎯 TP1: ${p7.tp1} (${pct(p7.tp1Rate)})
🏆 TP2: ${p7.tp2} (${pct(p7.tp2Rate)})
🛑 SL: ${p7.sl} (${pct(p7.slRate)})
⚡ Reached R: ${p7.reachedR == null ? 'N/A' : fmt(p7.reachedR, 2)}
📈 Final R: ${p7.totalR == null ? 'N/A' : fmt(p7.totalR, 2)}

🧠 Min AI: ${s.min_ai_confidence || '60'}%
🥇 Max Gold Risk: ${s.gold_max_risk_pct || '0.35'}%

اختر القسم المطلوب 👇`;
}

function liveTradesText() {
  const trades = getOpenTrades();

  if (!trades.length) {
    return `📈 Live Trade Center
━━━━━━━━━━━━━━━━━━

لا توجد صفقات نشطة حاليًا.`;
  }

  const rows = trades.slice(0, 10).map((t) => {
    const entry = Number(t.entry);
    const tp1 = Number(t.target1);
    const tp2 = Number(t.target2);
    const sl = Number(t.stop_loss);

    const risk = Number.isFinite(entry) && Number.isFinite(sl)
      ? Math.abs(entry - sl)
      : null;

    const rr1 = risk && Number.isFinite(tp1)
      ? Math.abs(tp1 - entry) / risk
      : null;

    const rr2 = risk && Number.isFinite(tp2)
      ? Math.abs(tp2 - entry) / risk
      : null;

    return `#${t.id} ${t.pair} ${t.action}
📌 Status: ${t.status}
💰 Entry: ${t.entry}
🎯 TP1: ${t.target1}${rr1 ? ` | ${fmt(rr1, 2)}R` : ''}
🏆 TP2: ${t.target2}${rr2 ? ` | ${fmt(rr2, 2)}R` : ''}
🛑 SL: ${t.stop_loss}
🕐 Opened: ${t.created_at}`;
  });

  return `📈 Live Trade Center
━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}`;
}

function performanceText() {
  const p7 = getPerformanceStats(7);
  const p30 = getPerformanceStats(30);
  const p90 = getPerformanceStats(90);

  const row = (p) =>
    `${p.days}d | Trades ${p.total} | TP1 ${pct(p.tp1Rate)} | TP2 ${pct(p.tp2Rate)} | SL ${pct(p.slRate)} | Final R ${p.totalR == null ? 'N/A' : fmt(p.totalR, 2)}`;

  return `📉 Performance Analytics
━━━━━━━━━━━━━━━━━━

${row(p7)}
${row(p30)}
${row(p90)}

🎯 Waiting TP2 (7d): ${p7.waitingTp2 || 0}
⚡ Reached R (7d): ${p7.reachedR == null ? 'N/A' : fmt(p7.reachedR, 2)}

📌 التقرير التفصيلي:
/performance`;
}

function decisionsText() {
  let rejected = [];

  try {
    rejected = getLastRejectedCandidates(10);
  } catch {}

  if (!rejected.length) {
    return `🧠 Signal Decisions
━━━━━━━━━━━━━━━━━━

لا توجد Near-Miss decisions في الذاكرة حاليًا.

سيظهر هنا آخر الفرص التي تم رفضها بسبب:
• AI Missing
• AI Mismatch
• AI Confidence منخفض
• شروط الأمان غير مكتملة`;
  }

  const rows = rejected.map((x, i) =>
    `${i + 1}. ${x.pair} ${x.action}
⭐ Smart: ${x.smartScore}/100
🤖 AI: ${x.aiConfidence}%
❌ Reason: ${x.reason}`
  );

  return `🧠 Signal Decisions
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

  const recent = safeAll(`
    SELECT telegram_id, first_name, username, is_vip, points, updated_at
    FROM users
    ORDER BY updated_at DESC
    LIMIT 8
  `);

  const rows = recent.map((u) =>
    `${u.is_vip ? '💎' : '👤'} ${u.first_name || u.username || u.telegram_id}
ID: ${u.telegram_id}
Points: ${u.points || 0}`
  );

  return `👥 Users & VIP
━━━━━━━━━━━━━━━━━━

👥 Total: ${total}
🟢 Active 24h: ${active24}
💎 VIP: ${vip}

آخر المستخدمين:
${rows.join('\n\n') || '—'}

إدارة مباشرة:
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

  const recent = safeAll(`
    SELECT news_id, created_at
    FROM news_alerts
    ORDER BY id DESC
    LIMIT 8
  `);

  const rows = recent.map((n) =>
    `• ${String(n.news_id).slice(0, 60)}
  ${n.created_at}`
  );

  return `📰 News Center
━━━━━━━━━━━━━━━━━━

🚨 Alerts 24h: ${count24}

آخر الأحداث:
${rows.join('\n') || '—'}

Primary:
🏛️ BLS
🏛️ BEA
🏛️ Federal Reserve

Fallback:
🟥 Breaking Multi-Feed`;
}

function healthText() {
  let dbOk = false;

  try {
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {}

  const mem = process.memoryUsage();

  const openTrades = safeCount(`
    SELECT COUNT(*) AS count
    FROM trades
    WHERE status IN ('open', 'target1')
  `);

  const latestTrade = safeAll(`
    SELECT pair, action, created_at
    FROM trades
    ORDER BY id DESC
    LIMIT 1
  `)[0];

  return `🩺 System Health
━━━━━━━━━━━━━━━━━━

🤖 Bot: 🟢 Running
🗄️ Database: ${dbOk ? '🟢 OK' : '🔴 ERROR'}
⏱️ Uptime: ${uptimeText()}

📈 Active Trades: ${openTrades}
🕐 Last Trade: ${latestTrade ? `${latestTrade.pair} ${latestTrade.action} @ ${latestTrade.created_at}` : 'N/A'}

🧠 Memory RSS: ${fmt(mem.rss / 1024 / 1024, 1)} MB
📦 Heap: ${fmt(mem.heapUsed / 1024 / 1024, 1)} MB
🖥️ Node: ${process.version}
📱 Platform: ${process.platform}

API:
${process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN ? '🟢' : '🟡'} Telegram
${process.env.TWELVE_DATA_KEY || process.env.TWELVEDATA_API_KEY ? '🟢' : '🟡'} TwelveData
${process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN ? '🟡' : '⚪'} EODHD
${process.env.FINNHUB_API_KEY ? '🟡' : '⚪'} Finnhub`;
}

function controlsText() {
  const s = currentSettings();

  return `🎛️ Bot Controls
━━━━━━━━━━━━━━━━━━

${s.auto_signals_enabled === '1' ? '🟢' : '🔴'} Auto Signals
${s.breaking_news_enabled === '1' ? '🟢' : '🔴'} Breaking News

🤖 Minimum AI: ${s.min_ai_confidence || '60'}%
🥇 Gold Max Risk: ${s.gold_max_risk_pct || '0.35'}%

${s.maintenance_mode === '1' ? '🟠 Maintenance ACTIVE' : '⚪ Maintenance OFF'}

⚠️ الإعدادات دي مؤثرة فعليًا على تشغيل البوت.`;
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

function registerAdminV21(bot) {
  bot.action('adminv21_dashboard', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, dashboardText(), adminV21Keyboard());
  });

  bot.action('adminv21_manual_signal', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    return replyOrEdit(
      ctx,
      `📣 إرسال إشارة ذهب

اختر نوع الصفقة:

⚡ Scalping
صفقة سريعة — فريم 5M

📈 Intraday
صفقة أوسع — فريم 15M`,
      manualSignalTypeKeyboard()
    );
  });


  bot.action(
    'adminv21_manual_type_scalp',
    async (ctx) => {

      if (!requireAdmin(ctx)) return;

      return replyOrEdit(
        ctx,
        `⚡ SCALPING

اختر اتجاه الصفقة:`,
        manualSignalDirectionKeyboard('SCALP')
      );
    }
  );


  bot.action(
    'adminv21_manual_type_intraday',
    async (ctx) => {

      if (!requireAdmin(ctx)) return;

      return replyOrEdit(
        ctx,
        `📈 INTRADAY

اختر اتجاه الصفقة:`,
        manualSignalDirectionKeyboard('INTRADAY')
      );
    }
  );


  bot.action(
    /^adminv21_manual_(SCALP|INTRADAY)_(buy|sell)$/,
    async (ctx) => {

      if (!requireAdmin(ctx)) return;

      const type =
        ctx.match[1];

      const direction =
        ctx.match[2].toUpperCase();

      try {

        const draft =
          await buildManualGoldSignal(
            type,
            direction
          );

        manualSignalDrafts.set(
          String(ctx.from.id),
          draft
        );

        return replyOrEdit(
          ctx,
          `🛑 اختر فرق وقف الخسارة

🥇 XAUUSD
${direction === 'BUY' ? '📈 BUY' : '📉 SELL'}

💰 سعر الدخول:
${draft.entry.toFixed(2)}

اختر المسافة بين الدخول ووقف الخسارة:

🤖 Auto = الحساب الذكي الحالي`,
          manualSignalSlKeyboard(
            type,
            direction
          )
        );

      } catch (error) {

        console.log(
          'Manual signal build error:',
          error.message
        );

        return replyOrEdit(
          ctx,
          `❌ تعذر تجهيز الإشارة

${error.message}`,
          adminV21Keyboard()
        );
      }
    }
  );


  bot.action(
    /^adminv21_manual_sl_(SCALP|INTRADAY)_(BUY|SELL)_(3|4|5|6|7\\.5|AUTO)$/,
    async (ctx) => {

      if (!requireAdmin(ctx)) return;

      const type = ctx.match[1];
      const direction = ctx.match[2];
      const slChoice = ctx.match[3];

      const key = String(ctx.from.id);
      const draft = manualSignalDrafts.get(key);

      if (
        !draft ||
        draft.type !== type ||
        draft.direction !== direction
      ) {
        return replyOrEdit(
          ctx,
          '❌ المعاينة انتهت. جهز الإشارة مرة أخرى.',
          adminV21Keyboard()
        );
      }

      // Keep original smart values for AUTO.
      if (slChoice !== 'AUTO') {

        const risk = Number(slChoice);

        if (!Number.isFinite(risk) || risk <= 0) {
          return replyOrEdit(
            ctx,
            '❌ فرق وقف الخسارة غير صالح.',
            adminV21Keyboard()
          );
        }

        draft.risk = risk;

        draft.sl =
          direction === 'BUY'
            ? draft.entry - risk
            : draft.entry + risk;

        // Preserve the existing Manual V21 R ratios.
        const tp1R =
          type === 'SCALP'
            ? 1.20
            : 1.50;

        const tp2R =
          type === 'SCALP'
            ? 2.00
            : 2.50;

        draft.tp1 =
          direction === 'BUY'
            ? draft.entry + (risk * tp1R)
            : draft.entry - (risk * tp1R);

        draft.tp2 =
          direction === 'BUY'
            ? draft.entry + (risk * tp2R)
            : draft.entry - (risk * tp2R);

        draft.rrTp1 = tp1R;
        draft.rrTp2 = tp2R;

        draft.manualSlDistance = risk;

      } else {

        draft.manualSlDistance = null;
      }

      manualSignalDrafts.set(key, draft);

      return replyOrEdit(
        ctx,
        manualSignalPreviewText(draft),
        manualSignalConfirmKeyboard(
          type,
          direction
        )
      );
    }
  );


  bot.action(
    /^adminv21_manual_confirm_(SCALP|INTRADAY)_(BUY|SELL)$/,
    async (ctx) => {

      if (!requireAdmin(ctx)) return;

      const type =
        ctx.match[1];

      const direction =
        ctx.match[2];

      const key =
        String(ctx.from.id);

      const draft =
        manualSignalDrafts.get(key);

      if (
        !draft ||
        draft.type !== type ||
        draft.direction !== direction
      ) {

        return replyOrEdit(
          ctx,
          '❌ المعاينة انتهت. جهز الإشارة مرة أخرى.',
          adminV21Keyboard()
        );
      }


      const message =
        manualSignalSendText(draft);


      let sentVip = false;


      if (config.vipChannelId) {

        try {

          await ctx.telegram.sendMessage(
            config.vipChannelId,
            message
          );

          sentVip = true;

        } catch (error) {

          console.log(
            'Manual signal VIP error:',
            error.message
          );
        }
      } else {
        console.log('Manual signal VIP error: VIP_CHANNEL_ID not configured');
      }


      try {

        const tradeInsert = addTrade({
          telegram_id: 'ADMIN',
          pair: 'XAUUSD',

          action:
            draft.direction,

          entry:
            draft.entry,

          stop_loss:
            draft.sl,

          target1:
            draft.tp1,

          target2:
            draft.tp2
        });

        const tradeId =
          Number(tradeInsert?.lastInsertRowid || 0);

        if (tradeId > 0) {
          console.log(
            `✅ MANUAL TRADE SAVED | ` +
            `Trade #${tradeId} | ` +
            `${draft.direction} XAUUSD | ` +
            `Entry ${draft.entry} | ` +
            `SL ${draft.sl} | ` +
            `TP1 ${draft.tp1} | ` +
            `TP2 ${draft.tp2}`
          );
        } else {
          console.log(
            '⚠️ Manual trade saved but no tradeId returned'
          );
        }

      } catch (error) {

        console.log(
          'Manual trade save error:',
          error.message
        );
      }


      manualSignalDrafts.delete(key);


      return replyOrEdit(
        ctx,
        `✅ تم إرسال الإشارة

${draft.type === 'SCALP'
  ? '⚡ Scalping'
  : '📈 Intraday'}

${draft.direction === 'BUY'
  ? '📈 BUY'
  : '📉 SELL'}

${sentVip
  ? '💎 تم الإرسال لقناة VIP'
  : '⚠️ لم يتم الإرسال لقناة VIP — راجع VIP_CHANNEL_ID'}

📊 الصفقة دخلت Trade Monitor`,
        adminV21Keyboard()
      );
    }
  );


  bot.action('adminv21_live', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, liveTradesText(), adminV21Keyboard());
  });

  bot.action('adminv21_performance', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, performanceText(), adminV21Keyboard());
  });

  bot.action('adminv21_decisions', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, decisionsText(), adminV21Keyboard());
  });

  bot.action('adminv21_users', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, usersText(), adminV21Keyboard());
  });

  bot.action('adminv21_news', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, newsText(), adminV21Keyboard());
  });

  bot.action('adminv21_controls', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_health', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    return replyOrEdit(ctx, healthText(), adminV21Keyboard());
  });

  bot.action('adminv21_toggle_auto', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    toggleSetting('auto_signals_enabled', true);

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_toggle_free_limit', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const enabled =
      toggleSetting(
        'free_daily_limit_enabled',
        false
      );

    console.log(
      `🎟️ Free Daily Limit: ${enabled ? 'ON' : 'OFF'}`
    );

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(
        currentSettings()
      )
    );
  });

  bot.action('adminv21_toggle_breaking', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    toggleSetting('breaking_news_enabled', true);

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_ai_up', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const current = getNumberSetting('min_ai_confidence', 60);
    setSetting(
      'min_ai_confidence',
      Math.min(95, current + 5)
    );

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_ai_down', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const current = getNumberSetting('min_ai_confidence', 60);
    setSetting(
      'min_ai_confidence',
      Math.max(50, current - 5)
    );

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_risk_up', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const current = getNumberSetting('gold_max_risk_pct', 0.35);

    setSetting(
      'gold_max_risk_pct',
      Math.min(1, current + 0.05).toFixed(2)
    );

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_risk_down', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const current = getNumberSetting('gold_max_risk_pct', 0.35);

    setSetting(
      'gold_max_risk_pct',
      Math.max(0.10, current - 0.05).toFixed(2)
    );

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  // IMPORTANT: Maintenance no longer toggles immediately.
  bot.action('adminv21_maintenance', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    const active = currentSettings().maintenance_mode === '1';

    if (active) {
      return replyOrEdit(
        ctx,
        `🛠️ Maintenance Mode

الحالة الحالية: 🟠 مفعّل

هل تريد إعادة فتح البوت للمستخدمين؟`,
        maintenanceConfirmKeyboard(true)
      );
    }

    return replyOrEdit(
      ctx,
      `⚠️ تأكيد وضع الصيانة

تفعيل الصيانة سيوقف تفاعل المستخدمين العاديين مع البوت مؤقتًا.

✅ الأدمن سيظل قادرًا على استخدام /admin

هل تريد التفعيل؟`,
      maintenanceConfirmKeyboard(false)
    );
  });

  bot.action('adminv21_maintenance_enable', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    setSetting('maintenance_mode', '1');

    return replyOrEdit(
      ctx,
      `🟠 تم تفعيل وضع الصيانة

المستخدمون العاديون سيتلقون رسالة الصيانة.
الأدمن ما زال قادرًا على استخدام لوحة التحكم.`,
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_maintenance_disable', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    setSetting('maintenance_mode', '0');

    return replyOrEdit(
      ctx,
      `🟢 تم إلغاء وضع الصيانة

FOREX AI متاح للمستخدمين الآن.`,
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_cancel', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    return replyOrEdit(
      ctx,
      controlsText(),
      controlsV21Keyboard(currentSettings())
    );
  });

  bot.action('adminv21_exit', async (ctx) => {
    if (!requireAdmin(ctx)) return;

    await ctx.answerCbQuery().catch(() => null);

    return ctx.reply(
      '✅ تم الخروج من لوحة الأدمن.\nاستخدم /menu للعودة للقائمة الرئيسية.'
    );
  });
}

module.exports = {
  registerAdminV21,
  dashboardText
};
