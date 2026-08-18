const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_teaser_state (
      pair TEXT PRIMARY KEY,
      last_state TEXT,
      last_direction TEXT,
      last_score REAL,
      last_sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getState(pair) {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM opportunity_teaser_state
    WHERE pair = ?
  `).get(
    String(pair).toUpperCase()
  );
}

function saveState(
  pair,
  state,
  direction,
  score,
  markSent = false
) {
  ensureTable();

  const symbol =
    String(pair).toUpperCase();

  const exists =
    getState(symbol);

  if (!exists) {
    return db.prepare(`
      INSERT INTO opportunity_teaser_state
      (
        pair,
        last_state,
        last_direction,
        last_score,
        last_sent_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      symbol,
      String(state),
      direction || null,
      Number(score || 0),
      markSent
        ? new Date().toISOString()
        : null
    );
  }

  return db.prepare(`
    UPDATE opportunity_teaser_state
    SET
      last_state = ?,
      last_direction = ?,
      last_score = ?,

      last_sent_at =
        CASE
          WHEN ? = 1
          THEN ?
          ELSE last_sent_at
        END,

      updated_at = CURRENT_TIMESTAMP

    WHERE pair = ?
  `).run(
    String(state),
    direction || null,
    Number(score || 0),

    markSent ? 1 : 0,

    markSent
      ? new Date().toISOString()
      : null,

    symbol
  );
}

module.exports = {
  ensureTable,
  getState,
  saveState
};
