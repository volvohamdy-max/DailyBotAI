const {
  evaluateCopilotTrade,
  buildCopilotMessage
} = require('./tradeCopilot');
const {
  getActiveCopilotTrades,
  updateCopilotHealth,
  stopCopilotTrade
} = require('../database/copilotTrades');

const CONCURRENCY = Math.max(1, Number(process.env.COPILOT_FANOUT_CONCURRENCY) || 10);
const BATCH_PAUSE_MS = Math.max(0, Number(process.env.COPILOT_FANOUT_BATCH_PAUSE_MS) || 200);

const terminalSent = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decision(trade, result) {
  const previous = String(trade.health_status || 'NEW');
  const current = String(result.healthStatus || 'UNKNOWN');
  const terminal = result.terminal || null;
  const key = String(trade.id);

  if (terminal && terminalSent.get(key) !== terminal) {
    terminalSent.set(key, terminal);
    return { send: previous !== 'NEW', previous, reason: 'TERMINAL' };
  }

  if (previous !== 'NEW' && current !== previous) {
    return { send: true, previous, reason: 'STATUS_CHANGED' };
  }

  return { send: false, previous, reason: 'NO_IMPORTANT_CHANGE' };
}

async function processTrade(bot, trade) {
  const result = await evaluateCopilotTrade(trade);

  updateCopilotHealth(
    trade.id,
    result.healthStatus,
    result.currentPrice,
    result.score,
    [...result.critical, ...result.warnings].slice(0, 3).join(' | ')
  );

  const alert = decision(trade, result);

  if (alert.send) {
    await bot.telegram.sendMessage(
      trade.telegram_id,
      buildCopilotMessage(trade, result, alert.previous)
    );
  }

  if (result.terminal === 'SL') {
    stopCopilotTrade(trade.id);
    terminalSent.delete(String(trade.id));
  }

  return { sent: alert.send ? 1 : 0 };
}

async function monitorCopilotTrades(bot) {
  const trades = getActiveCopilotTrades();
  if (!trades.length) return;

  console.log(`🤖 COPILOT SCALE: ${trades.length} active | concurrency=${CONCURRENCY}`);

  let sent = 0;
  let failed = 0;

  // evaluateCopilotTrade already shares one market snapshot internally.
  // Bounded batches prevent 500 Telegram sends from blocking the event loop.
  for (let i = 0; i < trades.length; i += CONCURRENCY) {
    const batch = trades.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(trade => processTrade(bot, trade))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') sent += Number(r.value?.sent || 0);
      else failed++;
    }

    if (i + CONCURRENCY < trades.length && BATCH_PAUSE_MS > 0) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  console.log(`✅ COPILOT SCALE finished | active=${trades.length} | sent=${sent} | failed=${failed}`);
}

module.exports = { monitorCopilotTrades };
