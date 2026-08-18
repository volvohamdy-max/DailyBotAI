const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS free_signal_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_sent_at TEXT
    );

    INSERT OR IGNORE INTO free_signal_state
      (id, last_sent_at)
    VALUES
      (1, NULL);
  `);
}

function canSendFreeSignal(hours = 24) {
  ensureTable();

  const row = db.prepare(`
    SELECT last_sent_at
    FROM free_signal_state
    WHERE id = 1
  `).get();

  if (!row?.last_sent_at) {
    return true;
  }

  const last =
    new Date(row.last_sent_at).getTime();

  if (!Number.isFinite(last)) {
    return true;
  }

  return (
    Date.now() - last >=
    Number(hours) * 60 * 60 * 1000
  );
}

function markFreeSignalSent() {
  ensureTable();

  db.prepare(`
    UPDATE free_signal_state
    SET last_sent_at = ?
    WHERE id = 1
  `).run(new Date().toISOString());
}

module.exports = {
  ensureTable,
  canSendFreeSignal,
  markFreeSignalSent
};
