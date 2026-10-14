const { allUsers } = require('../database/users');
const { isForexWeekend } = require('../utils/marketHours');
const { buildRadar, formatAutoAlert } = require('./goldZoneRadar');

// One alert represents one active BUY/SELL opportunity, not every tiny recalculation
// of the same zone. Do not alert that side again until it has disappeared long enough
// to be considered a genuinely new opportunity.
const REARM_MS = Number(process.env.GOLD_ZONE_REARM_MS) || 60 * 60 * 1000;
const activeSides = new Map();
let running = false;

function qualifiedSide(radar) {
  const s = radar?.scenario;
  if (!s || !radar?.setup) return null;
  if (!['READY', 'NEWS_BLOCK'].includes(s.status)) return null;
  return s.side;
}

async function runGoldZoneAutoAlerts(bot) {
  if (running || isForexWeekend()) return;
  running = true;
  try {
    const radar = await buildRadar();
    const side = qualifiedSide(radar);
    const now = Date.now();

    // Rearm a direction only after its opportunity has disappeared for an hour.
    for (const [trackedSide, state] of activeSides.entries()) {
      if (trackedSide !== side) {
        if (!state.absentSince) state.absentSince = now;
        if (now - state.absentSince >= REARM_MS) activeSides.delete(trackedSide);
      } else {
        state.absentSince = null;
      }
    }

    if (!side) return;

    // If SELL is already active, changing zone from 4148 to 4146 or changing
    // confidence from 96 to 100 must NOT create another Telegram alert.
    if (activeSides.has(side)) return;

    const message = formatAutoAlert(radar);
    if (!message) return;
    const users = allUsers({ vipOnly: true });
    if (!users.length) return;

    let sent = 0;
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegram_id, message);
        sent++;
      } catch (error) {
        console.log(`⚠️ GOLD ZONE alert user ${user.telegram_id}:`, error.message);
      }
    }

    if (sent > 0) {
      activeSides.set(side, { sentAt: now, absentSince: null });
      console.log(`🚨 GOLD ZONE NEW ${side} OPPORTUNITY | VIP sent=${sent}`);
    }
  } catch (error) {
    console.log('❌ GOLD ZONE AUTO ALERT:', error.message);
  } finally {
    running = false;
  }
}

module.exports = { runGoldZoneAutoAlerts };
