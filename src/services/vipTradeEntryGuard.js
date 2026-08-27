const config = require('../config');
const { getOpenTrades } = require('../database/trades');

const announced = new Set();
let initialized = false;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildEntryMessage(trade) {
  const entry = num(trade.entry);
  const sl = num(trade.stop_loss);
  const tp1 = num(trade.target1);
  const tp2 = num(trade.target2);
  const action = String(trade.action || '').toUpperCase();
  const source = String(trade.telegram_id || 'UNKNOWN');

  return [
    '💎 صفقة جديدة — VIP',
    '━━━━━━━━━━━━━━━━━━',
    '',
    `#${trade.id} 🥇 #XAUUSD`,
    `${action === 'BUY' ? '📈' : '📉'} الاتجاه: ${action}`,
    '',
    `💰 الدخول: ${entry == null ? '-' : entry.toFixed(2)}`,
    `🛑 وقف الخسارة: ${sl == null ? '-' : sl.toFixed(2)}`,
    `🎯 TP1: ${tp1 == null ? '-' : tp1.toFixed(2)}`,
    `🏆 TP2: ${tp2 == null ? '-' : tp2.toFixed(2)}`,
    '',
    `⚙️ المصدر: ${source}`
  ].join('\n');
}

async function ensureOpenTradesAnnounced(bot) {
  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) {
    console.log('❌ VIP ENTRY GUARD | VIP_CHANNEL_ID missing');
    return;
  }

  const trades = getOpenTrades();

  // On startup, do not re-send old open trades. From this point forward,
  // every newly observed open trade must be delivered to VIP.
  if (!initialized) {
    for (const trade of trades) announced.add(Number(trade.id));
    initialized = true;
    console.log(`💎 VIP ENTRY GUARD READY | baseline=${trades.length}`);
    return;
  }

  for (const trade of trades) {
    const id = Number(trade.id);
    if (!id || announced.has(id)) continue;

    try {
      const sent = await bot.telegram.sendMessage(chatId, buildEntryMessage(trade));
      announced.add(id);
      console.log(`💎 VIP ENTRY GUARD SENT | Trade #${id} | message=${sent?.message_id || 'ok'}`);
    } catch (error) {
      const description = error?.response?.description || error?.message || String(error);
      console.log(`❌ VIP ENTRY GUARD FAILED | Trade #${id} | ${description}`);
      // Intentionally not marked announced: next scheduler cycle retries it.
    }
  }

  const openIds = new Set(trades.map(t => Number(t.id)));
  if (announced.size > 500) {
    for (const id of announced) if (!openIds.has(id)) announced.delete(id);
  }
}

module.exports = { ensureOpenTradesAnnounced, buildEntryMessage };
