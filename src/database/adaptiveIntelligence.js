const db = require('./db');

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS adaptive_trade_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      trade_id INTEGER NOT NULL UNIQUE,
      pair TEXT NOT NULL,
      action TEXT NOT NULL,

      ema_ok INTEGER NOT NULL DEFAULT 0,
      rsi_ok INTEGER NOT NULL DEFAULT 0,
      adx_ok INTEGER NOT NULL DEFAULT 0,
      vwap_ok INTEGER NOT NULL DEFAULT 0,
      momentum_ok INTEGER NOT NULL DEFAULT 0,

      ema20 REAL,
      ema50 REAL,
      rsi REAL,
      adx REAL,
      vwap REAL,
      momentum_strength REAL,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_adaptive_pair
      ON adaptive_trade_features(pair);

    CREATE INDEX IF NOT EXISTS idx_adaptive_created
      ON adaptive_trade_features(created_at);
  `);
}

function finite(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function saveTradeFeatures({
  tradeId,
  pair,
  action,
  indicators = {},
  scalpMeta = {}
}) {
  ensureTable();

  const id = Number(tradeId);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const direction =
    String(action || '')
      .toUpperCase();

  const ema20 =
    finite(
      indicators.ema20 ??
      scalpMeta.ema20
    );

  const ema50 =
    finite(
      indicators.ema50 ??
      scalpMeta.ema50
    );

  const rsi =
    finite(
      indicators.rsi ??
      scalpMeta.rsi5
    );

  const adx =
    finite(
      indicators.adx ??
      scalpMeta.adx5
    );

  const vwap =
    finite(
      indicators.vwap ??
      scalpMeta.vwap5
    );

  const lastPrice =
    finite(
      indicators.lastPrice ??
      scalpMeta.entry
    );

  const momentumDirection =
    String(
      scalpMeta?.momentum?.direction ??
      indicators?.momentum?.direction ??
      'WAIT'
    ).toUpperCase();

  const momentumStrength =
    finite(
      scalpMeta?.momentum?.strength ??
      indicators?.momentum?.strength
    );


  const emaOk =
    ema20 !== null &&
    ema50 !== null &&
    (
      (
        direction === 'BUY' &&
        ema20 > ema50
      ) ||
      (
        direction === 'SELL' &&
        ema20 < ema50
      )
    );


  const rsiOk =
    rsi !== null &&
    (
      (
        direction === 'BUY' &&
        rsi >= 50 &&
        rsi <= 75
      ) ||
      (
        direction === 'SELL' &&
        rsi <= 50 &&
        rsi >= 25
      )
    );


  const adxOk =
    adx !== null &&
    adx >= 20;


  const vwapOk =
    vwap !== null &&
    lastPrice !== null &&
    (
      (
        direction === 'BUY' &&
        lastPrice >= vwap
      ) ||
      (
        direction === 'SELL' &&
        lastPrice <= vwap
      )
    );


  const momentumOk =
    momentumDirection === direction;


  return db.prepare(`
    INSERT OR REPLACE INTO adaptive_trade_features
    (
      trade_id,
      pair,
      action,

      ema_ok,
      rsi_ok,
      adx_ok,
      vwap_ok,
      momentum_ok,

      ema20,
      ema50,
      rsi,
      adx,
      vwap,
      momentum_strength
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(pair || '').toUpperCase(),
    direction,

    emaOk ? 1 : 0,
    rsiOk ? 1 : 0,
    adxOk ? 1 : 0,
    vwapOk ? 1 : 0,
    momentumOk ? 1 : 0,

    ema20,
    ema50,
    rsi,
    adx,
    vwap,
    momentumStrength
  );
}


function getLearningRows(days = 90, pair = null) {
  ensureTable();

  const cutoff =
    new Date(
      Date.now() -
      Number(days) *
      24 *
      60 *
      60 *
      1000
    ).toISOString();

  let sql = `
    SELECT
      f.*,
      p.outcome,
      p.realized_r,
      p.closed_at
    FROM adaptive_trade_features f
    JOIN trade_performance p
      ON p.trade_id = f.trade_id
    WHERE
      f.created_at >= ?
      AND p.closed_at IS NOT NULL
      AND p.realized_r IS NOT NULL
  `;

  const params = [cutoff];

  if (pair) {
    sql += `
      AND f.pair = ?
    `;

    params.push(
      String(pair).toUpperCase()
    );
  }

  sql += `
    ORDER BY f.created_at DESC
  `;

  return db.prepare(sql).all(
    ...params
  );
}


function countLearningSamples(
  days = 90,
  pair = null
) {
  return getLearningRows(
    days,
    pair
  ).length;
}


module.exports = {
  ensureTable,
  saveTradeFeatures,
  getLearningRows,
  countLearningSamples
};
