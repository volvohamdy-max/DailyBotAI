const db = require('../database/db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_funnel_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      event TEXT NOT NULL,
      source TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_promo_funnel_event ON promo_funnel_events(event, created_at);
    CREATE INDEX IF NOT EXISTS idx_promo_funnel_source ON promo_funnel_events(source, created_at);
  `);
}

function cleanSource(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'direct';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'direct';
}

function sourceFromStartPayload(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return 'direct';
  if (raw.startsWith('ad_')) return cleanSource(raw.slice(3));
  if (raw.startsWith('promo_')) return cleanSource(raw.slice(6));
  return 'referral_or_other';
}

function trackEvent(telegramId, event, source = null, meta = null) {
  try {
    ensureTable();
    db.prepare(`INSERT INTO promo_funnel_events (telegram_id, event, source, meta) VALUES (?, ?, ?, ?)`)
      .run(String(telegramId), String(event), source ? cleanSource(source) : null, meta ? JSON.stringify(meta) : null);
  } catch (error) {
    console.log('⚠️ Promo analytics:', error.message);
  }
}

function trackStart(telegramId, payload) {
  const source = sourceFromStartPayload(payload);
  trackEvent(telegramId, 'start', source, { payload: String(payload || '').slice(0, 100) });
  return source;
}

function trackFeatureUse(telegramId, feature, status) {
  trackEvent(telegramId, status === 'blocked' ? 'free_limit_hit' : 'feature_use', null, { feature });
}

function trackVipIntent(telegramId, planKey) {
  trackEvent(telegramId, 'vip_plan_selected', null, { plan: planKey });
}

function trackVipProof(telegramId, planKey) {
  trackEvent(telegramId, 'vip_proof_submitted', null, { plan: planKey });
}

module.exports = { ensureTable, trackEvent, trackStart, trackFeatureUse, trackVipIntent, trackVipProof, sourceFromStartPayload };
