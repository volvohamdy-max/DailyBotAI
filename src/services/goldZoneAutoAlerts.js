const { allUsers } = require('../database/users');
const { isForexWeekend } = require('../utils/marketHours');
const { buildRadar, formatAutoAlert } = require('./goldZoneRadar');

const ALERT_COOLDOWN_MS = Number(process.env.GOLD_ZONE_ALERT_COOLDOWN_MS) || 30 * 60 * 1000;
const lastAlerts = new Map();
let running = false;

function alertKey(r) {
  if (!r?.scenario || !r?.setup) return null;
  const roundedZone = Math.round(Number(r.setup.zone.price) * 2) / 2;
  return `${r.scenario.side}:${roundedZone}:${r.scenario.status}`;
}

async function runGoldZoneAutoAlerts(bot) {
  if (running || isForexWeekend()) return;
  running = true;
  try {
    const radar = await buildRadar();
    const message = formatAutoAlert(radar);
    if (!message) return;
    const key = alertKey(radar);
    const now = Date.now();
    if (key && now - Number(lastAlerts.get(key) || 0) < ALERT_COOLDOWN_MS) return;

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
    if (key && sent > 0) lastAlerts.set(key, now);
    if (sent > 0) console.log(`🚨 GOLD ZONE AUTO ALERT | ${key} | VIP sent=${sent}`);
  } catch (error) {
    console.log('❌ GOLD ZONE AUTO ALERT:', error.message);
  } finally {
    running = false;
  }
}

module.exports = { runGoldZoneAutoAlerts };
