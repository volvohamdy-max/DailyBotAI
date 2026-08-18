const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hidden_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      trade_id INTEGER NOT NULL UNIQUE,

      pair TEXT NOT NULL,
      action TEXT NOT NULL,

      entry REAL,
      stop_loss REAL,
      target1 REAL,
      target2 REAL,

      ai_score REAL,

      status TEXT NOT NULL DEFAULT 'ACTIVE',

      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      sl_hit INTEGER NOT NULL DEFAULT 0,

      tp1_notified INTEGER NOT NULL DEFAULT 0,
      tp2_notified INTEGER NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_hidden_status
      ON hidden_signals(status);

    CREATE INDEX IF NOT EXISTS idx_hidden_created
      ON hidden_signals(created_at);
  `);
}

function createHiddenSignal(data) {
  ensureTable();

  return db.prepare(`
    INSERT OR IGNORE INTO hidden_signals
    (
      trade_id,
      pair,
      action,
      entry,
      stop_loss,
      target1,
      target2,
      ai_score
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(data.tradeId),
    String(data.pair || '').toUpperCase(),
    String(data.action || '').toUpperCase(),
    Number(data.entry),
    Number(data.stopLoss),
    Number(data.target1),
    Number(data.target2),
    Number(data.aiScore || 0)
  );
}

function getByTradeId(tradeId) {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM hidden_signals
    WHERE trade_id = ?
  `).get(Number(tradeId));
}

function recordHiddenTp1(tradeId) {
  ensureTable();

  return db.prepare(`
    UPDATE hidden_signals
    SET tp1_hit = 1
    WHERE trade_id = ?
  `).run(Number(tradeId));
}

function recordHiddenTp2(tradeId) {
  ensureTable();

  return db.prepare(`
    UPDATE hidden_signals
    SET
      tp1_hit = 1,
      tp2_hit = 1,
      status = 'CLOSED',
      closed_at = CURRENT_TIMESTAMP
    WHERE trade_id = ?
  `).run(Number(tradeId));
}

function recordHiddenSl(tradeId) {
  ensureTable();

  return db.prepare(`
    UPDATE hidden_signals
    SET
      sl_hit = 1,
      status = 'CLOSED',
      closed_at = CURRENT_TIMESTAMP
    WHERE trade_id = ?
  `).run(Number(tradeId));
}

function markTp1Notified(tradeId) {
  ensureTable();

  return db.prepare(`
    UPDATE hidden_signals
    SET tp1_notified = 1
    WHERE trade_id = ?
  `).run(Number(tradeId));
}

function markTp2Notified(tradeId) {
  ensureTable();

  return db.prepare(`
    UPDATE hidden_signals
    SET tp2_notified = 1
    WHERE trade_id = ?
  `).run(Number(tradeId));
}

function getRecentHiddenSignals(days = 7) {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM hidden_signals
    WHERE created_at >= datetime(
      'now',
      ?
    )
    ORDER BY id DESC
  `).all(`-${Number(days)} days`);
}

module.exports = {
  ensureTable,
  createHiddenSignal,
  getByTradeId,

  recordHiddenTp1,
  recordHiddenTp2,
  recordHiddenSl,

  markTp1Notified,
  markTp2Notified,

  getRecentHiddenSignals
};
