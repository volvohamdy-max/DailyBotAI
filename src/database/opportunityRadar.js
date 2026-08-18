const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_radar_watches (
      telegram_id TEXT NOT NULL,
      pair TEXT NOT NULL,
      last_state TEXT,
      last_score REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (telegram_id, pair)
    );

    CREATE INDEX IF NOT EXISTS idx_opportunity_radar_pair
      ON opportunity_radar_watches (pair);
  `);

  // Safe migrations for existing installations
  const columns = db.prepare(
    "PRAGMA table_info(opportunity_radar_watches)"
  ).all();

  const names = new Set(
    columns.map(x => x.name)
  );

  if (!names.has('last_direction')) {
    db.exec(`
      ALTER TABLE opportunity_radar_watches
      ADD COLUMN last_direction TEXT
    `);
  }

  if (!names.has('last_completion')) {
    db.exec(`
      ALTER TABLE opportunity_radar_watches
      ADD COLUMN last_completion INTEGER DEFAULT 0
    `);
  }

  if (!names.has('confirmed_at')) {
    db.exec(`
      ALTER TABLE opportunity_radar_watches
      ADD COLUMN confirmed_at TEXT
    `);
  }
}

function addWatch(telegramId, pair) {
  ensureTable();

  return db.prepare(`
    INSERT INTO opportunity_radar_watches
      (telegram_id, pair, last_state, last_score)
    VALUES (?, ?, 'WATCHING', NULL)
    ON CONFLICT(telegram_id, pair)
    DO UPDATE SET
      last_state = 'WATCHING',
      updated_at = CURRENT_TIMESTAMP
  `).run(
    String(telegramId),
    String(pair).toUpperCase()
  );
}

function removeWatch(telegramId, pair) {
  ensureTable();

  return db.prepare(`
    DELETE FROM opportunity_radar_watches
    WHERE telegram_id = ?
      AND pair = ?
  `).run(
    String(telegramId),
    String(pair).toUpperCase()
  );
}

function getWatches() {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM opportunity_radar_watches
    ORDER BY created_at ASC
  `).all();
}

function getUserWatches(telegramId) {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM opportunity_radar_watches
    WHERE telegram_id = ?
    ORDER BY created_at ASC
  `).all(String(telegramId));
}

function updateWatchState(
  telegramId,
  pair,
  state,
  score,
  direction = null,
  completion = 0
) {
  ensureTable();

  const confirmedAt =
    state === 'CONFIRMED'
      ? new Date().toISOString()
      : null;

  return db.prepare(`
    UPDATE opportunity_radar_watches
    SET
      last_state = ?,
      last_score = ?,
      last_direction = ?,
      last_completion = ?,

      confirmed_at =
        CASE
          WHEN ? = 'CONFIRMED'
          THEN COALESCE(confirmed_at, ?)

          WHEN ? IN ('FORMING', 'ALMOST_READY', 'CANCELLED', 'WEAK')
          THEN NULL

          ELSE confirmed_at
        END,

      updated_at = CURRENT_TIMESTAMP

    WHERE telegram_id = ?
      AND pair = ?
  `).run(
    String(state),

    Number(score || 0),

    direction
      ? String(direction).toUpperCase()
      : null,

    Number(completion || 0),

    String(state),
    confirmedAt,

    String(state),

    String(telegramId),
    String(pair).toUpperCase()
  );
}

module.exports = {
  ensureTable,
  addWatch,
  removeWatch,
  getWatches,
  getUserWatches,
  updateWatchState
};
