const { Markup } = require('telegraf');
const db = require('../database/db');
const { requireAdmin } = require('../utils/auth');

const ACTIVE_STATUSES = new Set(['open', 'secured', 'target1']);
const PAUSED_PREFIX = 'paused_';

function getManagedTrades() {
  return db.prepare(`
    SELECT *
    FROM trades
    WHERE pair = 'XAUUSD'
      AND (
        status IN ('open', 'secured', 'target1')
        OR status LIKE 'paused_%'
      )
    ORDER BY id DESC
    LIMIT 10
  `).all();
}

function getTrade(id) {
  return db.prepare(`
    SELECT *
    FROM trades
    WHERE id = ?
      AND pair = 'XAUUSD'
  `).get(Number(id));
}

function displayStatus(status) {
  const value = String(status || '');
  if (value.startsWith(PAUSED_PREFIX)) {
    return `⏸️ paused (${value.slice(PAUSED_PREFIX.length)})`;
  }
  return value;
}

function liveTradesText(trades) {
  if (!trades.length) {
    return `📈 Live Trade Center\n━━━━━━━━━━━━━━━━━━\n\nلا توجد صفقات نشطة أو موقوفة حاليًا.`;
  }

  const rows = trades.map((t) =>
    `#${t.id} ${t.pair} ${t.action}\n` +
    `📌 Status: ${displayStatus(t.status)}\n` +
    `💰 Entry: ${t.entry}\n` +
    `🎯 TP1: ${t.target1}\n` +
    `🏆 TP2: ${t.target2}\n` +
    `🛑 SL: ${t.stop_loss}\n` +
    `🕐 Opened: ${t.created_at}`
  );

  return `📈 Live Trade Center\n━━━━━━━━━━━━━━━━━━\n\n${rows.join('\n\n')}\n\nاختر الإجراء من الأزرار بالأسفل.`;
}

function liveTradesKeyboard(trades) {
  const rows = [];

  for (const trade of trades) {
    const id = Number(trade.id);
    const status = String(trade.status || '');
    const paused = status.startsWith(PAUSED_PREFIX);

    rows.push([
      Markup.button.callback(
        `${paused ? '▶️ استكمال' : '⏸️ إيقاف'} #${id}`,
        paused ? `admintrade_resume_${id}` : `admintrade_pause_${id}`
      ),
      Markup.button.callback(
        `❌ إلغاء #${id}`,
        `admintrade_cancel_ask_${id}`
      )
    ]);
  }

  rows.push([
    Markup.button.callback('🔄 تحديث', 'adminv21_live'),
    Markup.button.callback('⬅️ Dashboard', 'adminv21_dashboard')
  ]);

  return Markup.inlineKeyboard(rows);
}

function cancelConfirmKeyboard(id) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ نعم، إلغاء الصفقة', `admintrade_cancel_yes_${id}`)
    ],
    [
      Markup.button.callback('⬅️ رجوع', 'adminv21_live')
    ]
  ]);
}

async function replyOrEdit(ctx, text, keyboard) {
  try {
    await ctx.answerCbQuery().catch(() => null);
    return await ctx.editMessageText(text, keyboard);
  } catch {
    return ctx.reply(text, keyboard);
  }
}

function pauseTrade(id) {
  const trade = getTrade(id);
  if (!trade) return { ok: false, message: 'الصفقة غير موجودة.' };

  const status = String(trade.status || '');
  if (!ACTIVE_STATUSES.has(status)) {
    return { ok: false, message: 'الصفقة ليست في حالة تسمح بالإيقاف.' };
  }

  db.prepare('UPDATE trades SET status = ? WHERE id = ?')
    .run(`${PAUSED_PREFIX}${status}`, Number(id));

  return { ok: true };
}

function resumeTrade(id) {
  const trade = getTrade(id);
  if (!trade) return { ok: false, message: 'الصفقة غير موجودة.' };

  const status = String(trade.status || '');
  if (!status.startsWith(PAUSED_PREFIX)) {
    return { ok: false, message: 'الصفقة ليست موقوفة.' };
  }

  const originalStatus = status.slice(PAUSED_PREFIX.length);
  if (!ACTIVE_STATUSES.has(originalStatus)) {
    return { ok: false, message: 'تعذر استعادة حالة الصفقة الأصلية.' };
  }

  db.prepare('UPDATE trades SET status = ? WHERE id = ?')
    .run(originalStatus, Number(id));

  return { ok: true };
}

function cancelTrade(id) {
  const trade = getTrade(id);
  if (!trade) return { ok: false, message: 'الصفقة غير موجودة.' };

  const status = String(trade.status || '');
  const manageable = ACTIVE_STATUSES.has(status) || status.startsWith(PAUSED_PREFIX);
  if (!manageable) {
    return { ok: false, message: 'الصفقة انتهت بالفعل أو لا يمكن إلغاؤها.' };
  }

  db.prepare("UPDATE trades SET status = 'cancelled' WHERE id = ?")
    .run(Number(id));

  // Admin-cancelled trades must not affect performance statistics.
  try {
    db.prepare('DELETE FROM trade_performance WHERE trade_id = ?')
      .run(Number(id));
  } catch (error) {
    console.log(`⚠️ Cancelled trade ${id}: performance cleanup skipped:`, error.message);
  }

  return { ok: true };
}

function registerTradeAdminControls(bot) {
  // Register before Admin V2.1 so this safely replaces only the live-trades screen.
  bot.action('adminv21_live', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const trades = getManagedTrades();
    return replyOrEdit(ctx, liveTradesText(trades), liveTradesKeyboard(trades));
  });

  bot.action(/^admintrade_pause_(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const result = pauseTrade(ctx.match[1]);
    const trades = getManagedTrades();
    const notice = result.ok ? '⏸️ تم إيقاف الصفقة مؤقتًا.\n\n' : `⚠️ ${result.message}\n\n`;
    return replyOrEdit(ctx, notice + liveTradesText(trades), liveTradesKeyboard(trades));
  });

  bot.action(/^admintrade_resume_(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const result = resumeTrade(ctx.match[1]);
    const trades = getManagedTrades();
    const notice = result.ok ? '▶️ تم استكمال متابعة الصفقة.\n\n' : `⚠️ ${result.message}\n\n`;
    return replyOrEdit(ctx, notice + liveTradesText(trades), liveTradesKeyboard(trades));
  });

  bot.action(/^admintrade_cancel_ask_(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const trade = getTrade(ctx.match[1]);

    if (!trade) {
      const trades = getManagedTrades();
      return replyOrEdit(ctx, '⚠️ الصفقة غير موجودة.\n\n' + liveTradesText(trades), liveTradesKeyboard(trades));
    }

    return replyOrEdit(
      ctx,
      `⚠️ تأكيد إلغاء الصفقة\n\n#${trade.id} ${trade.pair} ${trade.action}\n📌 الحالة: ${displayStatus(trade.status)}\n💰 Entry: ${trade.entry}\n🛑 SL: ${trade.stop_loss}\n🎯 TP1: ${trade.target1}\n🏆 TP2: ${trade.target2}\n\nالإلغاء سيوقف Trade Monitor عنها نهائيًا ولن تُحسب Win أو Loss.`,
      cancelConfirmKeyboard(trade.id)
    );
  });

  bot.action(/^admintrade_cancel_yes_(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match[1];
    const result = cancelTrade(id);
    const trades = getManagedTrades();
    const notice = result.ok
      ? `❌ تم إلغاء الصفقة #${id}.\nلن تدخل في إحصائيات Win/Loss.\n\n`
      : `⚠️ ${result.message}\n\n`;
    return replyOrEdit(ctx, notice + liveTradesText(trades), liveTradesKeyboard(trades));
  });
}

module.exports = registerTradeAdminControls;
