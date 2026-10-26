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

function countDistinct(event, since = null) {
  ensureTable();
  if (since) return Number(db.prepare('SELECT COUNT(DISTINCT telegram_id) AS n FROM promo_funnel_events WHERE event = ? AND created_at >= ?').get(event, since)?.n || 0);
  return Number(db.prepare('SELECT COUNT(DISTINCT telegram_id) AS n FROM promo_funnel_events WHERE event = ?').get(event)?.n || 0);
}

function funnelStats(days = 30) {
  ensureTable();
  const safeDays = Math.max(1, Math.min(3650, Number(days) || 30));
  const since = new Date(Date.now() - safeDays * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const starts = countDistinct('start', since);
  const used = countDistinct('feature_use', since);
  const limits = countDistinct('free_limit_hit', since);
  const vip = countDistinct('vip_plan_selected', since);
  const proofs = countDistinct('vip_proof_submitted', since);
  const sources = db.prepare(`
    SELECT COALESCE(source, 'direct') AS source, COUNT(DISTINCT telegram_id) AS users
    FROM promo_funnel_events
    WHERE event = 'start' AND created_at >= ?
    GROUP BY COALESCE(source, 'direct')
    ORDER BY users DESC
    LIMIT 10
  `).all(since);
  const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) : '0.0';
  return { days: safeDays, starts, used, limits, vip, proofs, sources, activationRate: pct(used, starts), vipIntentRate: pct(vip, starts), proofRate: pct(proofs, starts), proofFromIntentRate: pct(proofs, vip) };
}

function funnelText(days = 30) {
  const s = funnelStats(days);
  const sourceLines = s.sources.length ? s.sources.map((x, i) => `${i + 1}. ${x.source} — ${x.users}`).join('\n') : 'لا توجد بيانات حملات حتى الآن.';
  return `📣 إحصائيات الترويج — آخر ${s.days} يوم\n━━━━━━━━━━━━━━━━━━\n\n👥 دخلوا البوت: ${s.starts}\n🧪 استخدموا ميزة: ${s.used} (${s.activationRate}%)\n🔒 وصلوا للحد المجاني: ${s.limits}\n💎 اختاروا باقة VIP: ${s.vip} (${s.vipIntentRate}%)\n📸 أرسلوا إثبات دفع: ${s.proofs} (${s.proofRate}%)\n🎯 إثبات من مهتمي VIP: ${s.proofFromIntentRate}%\n\n📊 أفضل مصادر الدخول:\n${sourceLines}\n\n🔗 استخدم روابط مثل:\n/start=ad_telegram1 أو ad_facebook1\nليظهر كل إعلان كمصدر مستقل.`;
}

module.exports = { ensureTable, trackEvent, trackStart, trackFeatureUse, trackVipIntent, trackVipProof, sourceFromStartPayload, funnelStats, funnelText };
