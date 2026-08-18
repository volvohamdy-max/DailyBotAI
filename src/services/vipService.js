const db = require('../database/db');

const plans = {
  monthly: { label: 'شهري', days: 30 },
  quarterly: { label: 'ثلاثي', days: 90 },
  yearly: { label: 'سنوي', days: 365 }
};

function createVipRequest(telegramId, planKey, proofFileId = null, note = null) {
  return db.prepare('INSERT INTO vip_requests (telegram_id, plan_key, proof_file_id, note) VALUES (?, ?, ?, ?)')
    .run(String(telegramId), planKey, proofFileId, note);
}

module.exports = { plans, createVipRequest };
