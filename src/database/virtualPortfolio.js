const db = require('./db');

const STARTING_BALANCE =
  Number(process.env.VIRTUAL_STARTING_BALANCE) || 1000;

const RISK_PERCENT =
  Number(process.env.VIRTUAL_RISK_PERCENT) || 1;

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtual_portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),

      starting_balance REAL NOT NULL,
      balance REAL NOT NULL,

      peak_balance REAL NOT NULL,
      max_drawdown_percent REAL NOT NULL DEFAULT 0,

      risk_percent REAL NOT NULL DEFAULT 1,

      total_closed INTEGER NOT NULL DEFAULT 0,
      winning_trades INTEGER NOT NULL DEFAULT 0,
      losing_trades INTEGER NOT NULL DEFAULT 0,
      breakeven_trades INTEGER NOT NULL DEFAULT 0,

      total_profit REAL NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS virtual_portfolio_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      trade_id INTEGER NOT NULL UNIQUE,

      pair TEXT,
      action TEXT,

      balance_before REAL NOT NULL,

      risk_percent REAL NOT NULL,
      risk_amount REAL NOT NULL,

      realized_r REAL NOT NULL,
      profit_loss REAL NOT NULL,

      balance_after REAL NOT NULL,

      outcome TEXT,

      settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_trade
      ON virtual_portfolio_trades(trade_id);
  `);

  const row = db.prepare(`
    SELECT id
    FROM virtual_portfolio
    WHERE id = 1
  `).get();

  if (!row) {
    db.prepare(`
      INSERT INTO virtual_portfolio
      (
        id,
        starting_balance,
        balance,
        peak_balance,
        risk_percent
      )
      VALUES (1, ?, ?, ?, ?)
    `).run(
      STARTING_BALANCE,
      STARTING_BALANCE,
      STARTING_BALANCE,
      RISK_PERCENT
    );
  }
}

function getPortfolio() {
  ensureTables();

  return db.prepare(`
    SELECT *
    FROM virtual_portfolio
    WHERE id = 1
  `).get();
}

function settleTrade(tradeId) {
  ensureTables();

  const id = Number(tradeId);

  if (!Number.isFinite(id)) {
    return null;
  }

  // Never settle the same trade twice.
  const existing = db.prepare(`
    SELECT *
    FROM virtual_portfolio_trades
    WHERE trade_id = ?
  `).get(id);

  if (existing) {
    return existing;
  }

  // Read ONLY the final result calculated by performance.js.
  const trade = db.prepare(`
    SELECT
      trade_id,
      pair,
      action,
      outcome,
      realized_r
    FROM trade_performance
    WHERE trade_id = ?
      AND closed_at IS NOT NULL
      AND realized_r IS NOT NULL
  `).get(id);

  if (!trade) {
    return null;
  }

  const portfolio = getPortfolio();

  const balanceBefore =
    Number(portfolio.balance);

  const riskPercent =
    Number(portfolio.risk_percent);

  const realizedR =
    Number(trade.realized_r);

  if (
    !Number.isFinite(balanceBefore) ||
    !Number.isFinite(riskPercent) ||
    !Number.isFinite(realizedR)
  ) {
    throw new Error(
      `Invalid virtual portfolio settlement for trade ${id}`
    );
  }

  // Compounding:
  // Risk is always calculated from CURRENT balance.
  const riskAmount =
    balanceBefore * (riskPercent / 100);

  const profitLoss =
    riskAmount * realizedR;

  const balanceAfter =
    Math.max(
      0,
      balanceBefore + profitLoss
    );

  const peakBefore =
    Number(portfolio.peak_balance);

  const peakAfter =
    Math.max(
      peakBefore,
      balanceAfter
    );

  const drawdown =
    peakAfter > 0
      ? ((peakAfter - balanceAfter) / peakAfter) * 100
      : 0;

  const maxDrawdown =
    Math.max(
      Number(portfolio.max_drawdown_percent || 0),
      drawdown
    );

  db.prepare(`
    INSERT INTO virtual_portfolio_trades
    (
      trade_id,
      pair,
      action,
      balance_before,
      risk_percent,
      risk_amount,
      realized_r,
      profit_loss,
      balance_after,
      outcome
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(trade.pair || ''),
    String(trade.action || ''),
    balanceBefore,
    riskPercent,
    riskAmount,
    realizedR,
    profitLoss,
    balanceAfter,
    String(trade.outcome || '')
  );

  const win =
    profitLoss > 0 ? 1 : 0;

  const loss =
    profitLoss < 0 ? 1 : 0;

  const breakeven =
    profitLoss === 0 ? 1 : 0;

  db.prepare(`
    UPDATE virtual_portfolio
    SET
      balance = ?,
      peak_balance = ?,
      max_drawdown_percent = ?,

      total_closed = total_closed + 1,
      winning_trades = winning_trades + ?,
      losing_trades = losing_trades + ?,
      breakeven_trades = breakeven_trades + ?,

      total_profit = total_profit + ?,

      updated_at = CURRENT_TIMESTAMP

    WHERE id = 1
  `).run(
    balanceAfter,
    peakAfter,
    maxDrawdown,
    win,
    loss,
    breakeven,
    profitLoss
  );

  console.log(
    `💼 VIRTUAL PORTFOLIO | Trade #${id} | ` +
    `${realizedR}R | ` +
    `${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)} | ` +
    `Balance $${balanceAfter.toFixed(2)}`
  );

  return db.prepare(`
    SELECT *
    FROM virtual_portfolio_trades
    WHERE trade_id = ?
  `).get(id);
}

function getRecentTrades(limit = 5) {
  ensureTables();

  const safeLimit =
    Math.max(
      1,
      Math.min(20, Number(limit) || 5)
    );

  return db.prepare(`
    SELECT *
    FROM virtual_portfolio_trades
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit);
}

function getStats() {
  const p = getPortfolio();

  const starting =
    Number(p.starting_balance);

  const balance =
    Number(p.balance);

  const netProfit =
    balance - starting;

  const returnPercent =
    starting > 0
      ? (netProfit / starting) * 100
      : 0;

  return {
    ...p,

    starting_balance: starting,
    balance,

    net_profit: netProfit,
    return_percent: returnPercent,

    recent: getRecentTrades(5)
  };
}

module.exports = {
  ensureTables,
  settleTrade,
  getPortfolio,
  getRecentTrades,
  getStats
};
