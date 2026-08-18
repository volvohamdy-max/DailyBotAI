const db = require('./db');

const DEFAULTS = {
  auto_signals_enabled: '1',
  breaking_news_enabled: '1',
  min_ai_confidence: '60',
  gold_max_risk_pct: '0.35',
  maintenance_mode: '0',
  free_daily_limit_enabled: '0'
};

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO admin_settings(key, value) VALUES(?, ?)'
  );

  for (const [key, value] of Object.entries(DEFAULTS)) {
    stmt.run(key, value);
  }
}

function getSetting(key, fallback = null) {
  ensureTable();

  const row = db.prepare(
    'SELECT value FROM admin_settings WHERE key = ?'
  ).get(String(key));

  if (!row) return fallback;
  return row.value;
}

function getNumberSetting(key, fallback = 0) {
  const value = Number(getSetting(key, fallback));
  return Number.isFinite(value) ? value : Number(fallback);
}

function getBoolSetting(key, fallback = false) {
  const raw = String(getSetting(key, fallback ? '1' : '0'));
  return raw === '1' || raw.toLowerCase() === 'true';
}

function setSetting(key, value) {
  ensureTable();

  db.prepare(`
    INSERT INTO admin_settings(key, value, updated_at)
    VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(key), String(value));

  return getSetting(key);
}

function toggleSetting(key, fallback = false) {
  const next = !getBoolSetting(key, fallback);
  setSetting(key, next ? '1' : '0');
  return next;
}

function getAllSettings() {
  ensureTable();

  const rows = db.prepare(
    'SELECT key, value, updated_at FROM admin_settings ORDER BY key'
  ).all();

  return Object.fromEntries(
    rows.map((row) => [row.key, row.value])
  );
}

module.exports = {
  ensureTable,
  getSetting,
  getNumberSetting,
  getBoolSetting,
  setSetting,
  toggleSetting,
  getAllSettings
};
