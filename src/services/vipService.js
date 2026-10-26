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

function getPendingVipRequest(telegramId) {
  return db.prepare(`
    SELECT * FROM vip_requests
    WHERE telegram_id = ?
      AND status = 'pending'
      AND plan_key IN ('monthly', 'quarterly', 'yearly')
      AND (proof_file_id IS NULL OR proof_file_id = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(String(telegramId));
}

function beginVipRequest(telegramId, planKey) {
  if (!plans[planKey]) throw new Error('Invalid VIP plan');

  // Keep only one active payment intent per user. Old unpaid intents are
  // cancelled so a later proof can never be attached to the wrong plan.
  db.prepare(`
    UPDATE vip_requests
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
      AND status = 'pending'
      AND (proof_file_id IS NULL OR proof_file_id = '')
  `).run(String(telegramId));

  const result = createVipRequest(telegramId, planKey);
  return db.prepare('SELECT * FROM vip_requests WHERE id = ?').get(Number(result.lastInsertRowid));
}

function attachProofToPendingRequest(telegramId, proofFileId, note = null) {
  const pending = getPendingVipRequest(telegramId);
  if (!pending) return null;

  const result = db.prepare(`
    UPDATE vip_requests
    SET proof_file_id = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'pending'
      AND (proof_file_id IS NULL OR proof_file_id = '')
  `).run(proofFileId, note, pending.id);

  if (Number(result.changes) !== 1) return null;
  return db.prepare('SELECT * FROM vip_requests WHERE id = ?').get(pending.id);
}

module.exports = {
  plans,
  createVipRequest,
  beginVipRequest,
  getPendingVipRequest,
  attachProofToPendingRequest
};
