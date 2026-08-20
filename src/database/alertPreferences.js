const db = require('./db');

const DEFAULT_PAIRS = [
  'XAUUSD',
  'BTCUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'CHFJPY'
];

function normalizePairs(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((pair) => DEFAULT_PAIRS.includes(pair)))];
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizePairs(JSON.parse(value));
    } catch (_) {
      return DEFAULT_PAIRS.slice();
    }
  }

  return DEFAULT_PAIRS.slice();
}

function ensurePreference(telegramId) {
  const id = String(telegramId);

  db.prepare(`
    INSERT OR IGNORE INTO alert_preferences
      (telegram_id, enabled, min_confidence, pairs)
    VALUES (?, 1, 80, ?)
  `).run(id, JSON.stringify(DEFAULT_PAIRS));

  return getPreference(id);
}

function getPreference(telegramId) {
  const id = String(telegramId);

  const row = db.prepare(`
    SELECT telegram_id, enabled, min_confidence, pairs
    FROM alert_preferences
    WHERE telegram_id = ?
  `).get(id);

  if (!row) {
    return ensurePreference(id);
  }

  return {
    telegram_id: row.telegram_id,
    enabled: Number(row.enabled) === 1,
    min_confidence: Number(row.min_confidence) || 80,
    pairs: normalizePairs(row.pairs)
  };
}

function setEnabled(telegramId, enabled) {
  ensurePreference(telegramId);

  db.prepare(`
    UPDATE alert_preferences
    SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(enabled ? 1 : 0, String(telegramId));

  return getPreference(telegramId);
}

function setMinConfidence(telegramId, confidence) {
  const allowed = [70, 75, 80, 85, 90, 95];
  const normalized = allowed.includes(Number(confidence))
    ? Number(confidence)
    : 80;

  ensurePreference(telegramId);

  db.prepare(`
    UPDATE alert_preferences
    SET min_confidence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(normalized, String(telegramId));

  return getPreference(telegramId);
}

function togglePair(telegramId, pair) {
  if (!DEFAULT_PAIRS.includes(pair)) {
    return getPreference(telegramId);
  }

  const pref = getPreference(telegramId);
  const pairs = new Set(pref.pairs);

  if (pairs.has(pair)) {
    pairs.delete(pair);
  } else {
    pairs.add(pair);
  }

  db.prepare(`
    UPDATE alert_preferences
    SET pairs = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(JSON.stringify([...pairs]), String(telegramId));

  return getPreference(telegramId);
}

function setAllPairs(telegramId, enabled) {
  ensurePreference(telegramId);

  db.prepare(`
    UPDATE alert_preferences
    SET pairs = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(
    JSON.stringify(enabled ? DEFAULT_PAIRS : []),
    String(telegramId)
  );

  return getPreference(telegramId);
}

function getEligibleAlertUsers() {
  return db.prepare(`
    SELECT
      u.telegram_id,
      u.language,
      u.is_vip,
      u.vip_expires_at,
      p.enabled,
      p.min_confidence,
      p.pairs
    FROM users u
    LEFT JOIN alert_preferences p
      ON p.telegram_id = u.telegram_id
    WHERE u.is_vip = 1
      AND (u.vip_expires_at IS NULL OR u.vip_expires_at > datetime('now'))
  `).all().map((row) => ({
    telegram_id: row.telegram_id,
    language: row.language === 'en' ? 'en' : 'ar',
    is_vip: Number(row.is_vip) === 1,
    enabled: row.enabled === null || row.enabled === undefined
      ? true
      : Number(row.enabled) === 1,
    min_confidence: Number(row.min_confidence) || 80,
    pairs: normalizePairs(row.pairs)
  }));
}

function canSendAlert(telegramId, pair, action, cooldownMinutes = 30) {
  const row = db.prepare(`
    SELECT sent_at
    FROM alert_history
    WHERE telegram_id = ?
      AND pair = ?
      AND action = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(telegramId), pair, action);

  if (!row || !row.sent_at) return true;

  const last = new Date(row.sent_at).getTime();
  if (!Number.isFinite(last)) return true;

  return Date.now() - last >= cooldownMinutes * 60 * 1000;
}

// Scale path for hundreds of VIP users: one indexed query per alert cycle
// instead of one SQL lookup for every user x opportunity combination.
function getRecentAlertCooldownMap(cooldownMinutes = 30) {
  const cutoff = new Date(Date.now() - Number(cooldownMinutes || 30) * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT telegram_id, pair, action, MAX(sent_at) AS sent_at
    FROM alert_history
    WHERE sent_at >= ?
    GROUP BY telegram_id, pair, action
  `).all(cutoff);

  const map = new Map();
  for (const row of rows) {
    map.set(
      `${String(row.telegram_id)}|${row.pair}|${row.action}`,
      row.sent_at
    );
  }
  return map;
}

function recordAlert(telegramId, pair, action, score, confidence) {
  db.prepare(`
    INSERT INTO alert_history
      (telegram_id, pair, action, score, confidence, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    String(telegramId),
    pair,
    action,
    Number(score) || 0,
    Number(confidence) || 0,
    new Date().toISOString()
  );
}

module.exports = {
  DEFAULT_PAIRS,
  getPreference,
  setEnabled,
  setMinConfidence,
  togglePair,
  setAllPairs,
  getEligibleAlertUsers,
  canSendAlert,
  getRecentAlertCooldownMap,
  recordAlert
};
