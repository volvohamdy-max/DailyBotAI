const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shadow_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      pair TEXT NOT NULL,
      action TEXT NOT NULL,

      entry REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target1 REAL NOT NULL,
      target2 REAL NOT NULL,

      source TEXT NOT NULL DEFAULT 'RADAR',
      original_score REAL,
      adaptive_score REAL,

      ema_ok INTEGER DEFAULT 0,
      rsi_ok INTEGER DEFAULT 0,
      adx_ok INTEGER DEFAULT 0,
      vwap_ok INTEGER DEFAULT 0,
      momentum_ok INTEGER DEFAULT 0,

      status TEXT NOT NULL DEFAULT 'OPEN',

      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      sl_hit INTEGER NOT NULL DEFAULT 0,

      exit_price REAL,
      outcome TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_shadow_status
      ON shadow_trades(status);

    CREATE INDEX IF NOT EXISTS idx_shadow_pair
      ON shadow_trades(pair);

    CREATE INDEX IF NOT EXISTS idx_shadow_created
      ON shadow_trades(created_at);
  `);
}


function addShadowTrade(data) {
  ensureTable();

  const duplicate = db.prepare(`
    SELECT id
    FROM shadow_trades
    WHERE pair = ?
      AND action = ?
      AND status = 'OPEN'
      AND created_at >= datetime('now', '-30 minutes')
    ORDER BY id DESC
    LIMIT 1
  `).get(
    String(data.pair).toUpperCase(),
    String(data.action).toUpperCase()
  );

  if (duplicate) {
    return null;
  }

  return db.prepare(`
    INSERT INTO shadow_trades
    (
      pair,
      action,

      entry,
      stop_loss,
      target1,
      target2,

      source,
      original_score,
      adaptive_score,

      ema_ok,
      rsi_ok,
      adx_ok,
      vwap_ok,
      momentum_ok
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(data.pair).toUpperCase(),
    String(data.action).toUpperCase(),

    Number(data.entry),
    Number(data.stop_loss),
    Number(data.target1),
    Number(data.target2),

    String(data.source || 'RADAR'),

    Number(data.original_score || 0),

    data.adaptive_score == null
      ? null
      : Number(data.adaptive_score),

    data.ema_ok ? 1 : 0,
    data.rsi_ok ? 1 : 0,
    data.adx_ok ? 1 : 0,
    data.vwap_ok ? 1 : 0,
    data.momentum_ok ? 1 : 0
  );
}


function getOpenShadowTrades() {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM shadow_trades
    WHERE status = 'OPEN'
    ORDER BY id ASC
  `).all();
}


function markShadowTp1(id, price) {
  ensureTable();

  return db.prepare(`
    UPDATE shadow_trades
    SET
      tp1_hit = 1,
      exit_price = ?,
      outcome = 'TP1_OPEN'
    WHERE id = ?
  `).run(
    Number(price),
    Number(id)
  );
}


function closeShadowTrade(
  id,
  outcome,
  price
) {
  ensureTable();

  return db.prepare(`
    UPDATE shadow_trades
    SET
      status = 'CLOSED',
      outcome = ?,
      exit_price = ?,

      tp2_hit =
        CASE
          WHEN ? = 'TP2'
          THEN 1
          ELSE tp2_hit
        END,

      sl_hit =
        CASE
          WHEN ? = 'SL'
          THEN 1
          ELSE sl_hit
        END,

      closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    String(outcome),
    Number(price),

    String(outcome),
    String(outcome),

    Number(id)
  );
}


function getShadowStats(days = 30) {
  ensureTable();

  const rows = db.prepare(`
    SELECT *
    FROM shadow_trades
    WHERE created_at >= datetime(
      'now',
      ?
    )
  `).all(
    `-${Number(days)} days`
  );

  const closed =
    rows.filter(
      x => x.status === 'CLOSED'
    );

  const tp2 =
    closed.filter(
      x => x.outcome === 'TP2'
    ).length;

  const sl =
    closed.filter(
      x => x.outcome === 'SL'
    ).length;

  const tp1 =
    rows.filter(
      x => Number(x.tp1_hit) === 1
    ).length;

  return {
    days: Number(days),

    total: rows.length,

    open:
      rows.length -
      closed.length,

    closed:
      closed.length,

    tp1,
    tp2,
    sl,

    tp1Rate:
      closed.length
        ? (tp1 / closed.length) * 100
        : 0,

    tp2Rate:
      closed.length
        ? (tp2 / closed.length) * 100
        : 0,

    slRate:
      closed.length
        ? (sl / closed.length) * 100
        : 0
  };
}


function getClosedShadowTrades(
  days = 90
) {
  ensureTable();

  return db.prepare(`
    SELECT *
    FROM shadow_trades
    WHERE status = 'CLOSED'
      AND created_at >= datetime(
        'now',
        ?
      )
    ORDER BY id DESC
  `).all(
    `-${Number(days)} days`
  );
}


module.exports = {
  ensureTable,

  addShadowTrade,
  getOpenShadowTrades,

  markShadowTp1,
  closeShadowTrade,

  getShadowStats,
  getClosedShadowTrades
};
