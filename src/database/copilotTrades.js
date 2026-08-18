const db = require('./db');

function initCopilotTrades() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS copilot_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      pair TEXT NOT NULL DEFAULT 'XAUUSD',
      action TEXT NOT NULL,
      entry REAL NOT NULL,
      stop_loss REAL,
      target1 REAL,
      target2 REAL,

      status TEXT NOT NULL DEFAULT 'watching',
      health_status TEXT NOT NULL DEFAULT 'NEW',
      last_price REAL,
      last_score INTEGER,
      last_reason TEXT,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function addCopilotTrade(data) {
  initCopilotTrades();

  return db.prepare(`
    INSERT INTO copilot_trades
    (
      telegram_id,
      pair,
      action,
      entry,
      stop_loss,
      target1,
      target2,
      status,
      health_status
    )
    VALUES (?, 'XAUUSD', ?, ?, ?, ?, ?, 'watching', 'NEW')
  `).run(
    String(data.telegram_id),
    String(data.action).toUpperCase(),
    Number(data.entry),
    data.stop_loss == null ? null : Number(data.stop_loss),
    data.target1 == null ? null : Number(data.target1),
    data.target2 == null ? null : Number(data.target2)
  );
}

function getActiveCopilotTrades() {
  initCopilotTrades();

  return db.prepare(`
    SELECT *
    FROM copilot_trades
    WHERE status = 'watching'
    ORDER BY id DESC
  `).all();
}

function getUserActiveCopilotTrade(telegramId) {
  initCopilotTrades();

  return db.prepare(`
    SELECT *
    FROM copilot_trades
    WHERE telegram_id = ?
      AND status = 'watching'
    ORDER BY id DESC
    LIMIT 1
  `).get(String(telegramId));
}

function updateCopilotHealth(
  id,
  healthStatus,
  price,
  score = null,
  reason = null
) {
  initCopilotTrades();

  return db.prepare(`
    UPDATE copilot_trades
    SET
      health_status = ?,
      last_price = ?,
      last_score = ?,
      last_reason = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    healthStatus,
    Number(price),
    score,
    reason,
    id
  );
}


function hasUsedCopilotTrial(telegramId) {
  initCopilotTrades();

  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM copilot_trades
    WHERE telegram_id = ?
  `).get(String(telegramId));

  return Number(row?.count || 0) > 0;
}

function stopCopilotTrade(id) {
  initCopilotTrades();

  return db.prepare(`
    UPDATE copilot_trades
    SET
      status = 'stopped',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
}

function stopUserCopilotTrades(telegramId) {
  initCopilotTrades();

  return db.prepare(`
    UPDATE copilot_trades
    SET
      status = 'stopped',
      updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
      AND status = 'watching'
  `).run(String(telegramId));
}

module.exports = {
  initCopilotTrades,
  addCopilotTrade,
  getActiveCopilotTrades,
  getUserActiveCopilotTrade,
  hasUsedCopilotTrial,
  updateCopilotHealth,
  stopCopilotTrade,
  stopUserCopilotTrades
};
