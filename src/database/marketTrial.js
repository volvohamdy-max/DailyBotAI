const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_free_trials (
      telegram_id TEXT PRIMARY KEY,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function hasUsedMarketTrial(telegramId) {
  ensureTable();

  return Boolean(
    db.prepare(`
      SELECT telegram_id
      FROM market_free_trials
      WHERE telegram_id = ?
    `).get(String(telegramId))
  );
}

function markMarketTrialUsed(telegramId) {
  ensureTable();

  return db.prepare(`
    INSERT OR IGNORE INTO market_free_trials
      (telegram_id)
    VALUES (?)
  `).run(String(telegramId));
}

module.exports = {
  hasUsedMarketTrial,
  markMarketTrialUsed
};
