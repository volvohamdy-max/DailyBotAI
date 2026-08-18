const db = require('./db');

function isWatching(telegramId, pair) {
  const row = db.prepare(`
    SELECT 1
    FROM trend_watches
    WHERE telegram_id = ? AND pair = ?
    LIMIT 1
  `).get(String(telegramId), String(pair));

  return Boolean(row);
}

function addWatch(telegramId, pair) {
  db.prepare(`
    INSERT OR IGNORE INTO trend_watches (telegram_id, pair)
    VALUES (?, ?)
  `).run(String(telegramId), String(pair));

  return true;
}

function removeWatch(telegramId, pair) {
  db.prepare(`
    DELETE FROM trend_watches
    WHERE telegram_id = ? AND pair = ?
  `).run(String(telegramId), String(pair));

  return false;
}

function toggleWatch(telegramId, pair) {
  if (isWatching(telegramId, pair)) {
    return removeWatch(telegramId, pair);
  }

  return addWatch(telegramId, pair);
}

function allWatches() {
  return db.prepare(`
    SELECT telegram_id, pair, created_at
    FROM trend_watches
    ORDER BY created_at ASC
  `).all();
}

module.exports = {
  isWatching,
  addWatch,
  removeWatch,
  toggleWatch,
  allWatches
};
