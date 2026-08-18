const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS power_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      trade_id INTEGER NOT NULL UNIQUE,
      pair TEXT NOT NULL,
      action TEXT NOT NULL,

      power_score REAL NOT NULL,
      technical_score REAL,
      ai_confidence REAL,
      scalp_score REAL,

      ema_ok INTEGER DEFAULT 0,
      rsi_ok INTEGER DEFAULT 0,
      adx_ok INTEGER DEFAULT 0,
      vwap_ok INTEGER DEFAULT 0,
      momentum_ok INTEGER DEFAULT 0,

      grade TEXT,
      mode TEXT NOT NULL DEFAULT 'SHADOW',

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_power_trade_id
      ON power_trades(trade_id);

    CREATE INDEX IF NOT EXISTS idx_power_created
      ON power_trades(created_at);
  `);
}

function savePowerTrade(data) {
  ensureTable();

  return db.prepare(`
    INSERT OR IGNORE INTO power_trades
    (
      trade_id,
      pair,
      action,

      power_score,
      technical_score,
      ai_confidence,
      scalp_score,

      ema_ok,
      rsi_ok,
      adx_ok,
      vwap_ok,
      momentum_ok,

      grade,
      mode
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHADOW')
  `).run(
    Number(data.tradeId),

    String(data.pair || '').toUpperCase(),
    String(data.action || '').toUpperCase(),

    Number(data.powerScore || 0),
    Number(data.technicalScore || 0),
    Number(data.aiConfidence || 0),
    Number(data.scalpScore || 0),

    data.emaOk ? 1 : 0,
    data.rsiOk ? 1 : 0,
    data.adxOk ? 1 : 0,
    data.vwapOk ? 1 : 0,
    data.momentumOk ? 1 : 0,

    String(data.grade || '')
  );
}

function getPowerStats(days = 30) {
  ensureTable();

  const cutoff =
    new Date(
      Date.now() -
      Number(days) * 24 * 60 * 60 * 1000
    ).toISOString();

  const rows = db.prepare(`
    SELECT
      p.*,
      t.outcome,
      t.realized_r,
      t.tp1_hit,
      t.tp2_hit,
      t.sl_hit,
      t.closed_at
    FROM power_trades p
    LEFT JOIN trade_performance t
      ON t.trade_id = p.trade_id
    WHERE p.created_at >= ?
    ORDER BY p.created_at DESC
  `).all(cutoff);

  const closed =
    rows.filter(x => x.closed_at);

  const tp1 =
    closed.filter(
      x => Number(x.tp1_hit) === 1
    ).length;

  const tp2 =
    closed.filter(
      x => Number(x.tp2_hit) === 1
    ).length;

  const pureSl =
    closed.filter(
      x => x.outcome === 'SL'
    ).length;

  const tp1ThenSl =
    closed.filter(
      x => x.outcome === 'TP1_THEN_SL'
    ).length;

  const rValues =
    closed
      .map(x => Number(x.realized_r))
      .filter(Number.isFinite);

  const totalR =
    rValues.reduce(
      (a, b) => a + b,
      0
    );

  const avgR =
    rValues.length
      ? totalR / rValues.length
      : 0;

  return {
    days,
    total: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    tp1,
    tp2,
    pureSl,
    tp1ThenSl,
    totalR,
    avgR,
    rows
  };
}

module.exports = {
  ensureTable,
  savePowerTrade,
  getPowerStats
};
