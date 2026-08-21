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

  const existing = db.prepare(`
    SELECT *
    FROM virtual_portfolio_trades
    WHERE trade_id = ?
  `).get(id);

  if (existing) {
    return existing;
  }

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

  const balanceBefore = Number(portfolio.balance);
  const riskPercent = Number(portfolio.risk_percent);
  const realizedR = Number(trade.realized_r);

  if (
    !Number.isFinite(balanceBefore) ||
    !Number.isFinite(riskPercent) ||
    !Number.isFinite(realizedR)
  ) {
    throw new Error(
      `Invalid virtual portfolio settlement for trade ${id}`
    );
  }

  const riskAmount = balanceBefore * (riskPercent / 100);
  const profitLoss = riskAmount * realizedR;
  const balanceAfter = Math.max(0, balanceBefore + profitLoss);

  const peakBefore = Number(portfolio.peak_balance);
  const peakAfter = Math.max(peakBefore, balanceAfter);

  const drawdown =
    peakAfter > 0
      ? ((peakAfter - balanceAfter) / peakAfter) * 100
      : 0;

  const maxDrawdown = Math.max(
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

  const win = profitLoss > 0 ? 1 : 0;
  const loss = profitLoss < 0 ? 1 : 0;
  const breakeven = profitLoss === 0 ? 1 : 0;

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

function syncClosedTrades() {
  ensureTables();

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT p.trade_id
      FROM trade_performance p
      LEFT JOIN virtual_portfolio_trades v
        ON v.trade_id = p.trade_id
      WHERE p.closed_at IS NOT NULL
        AND p.realized_r IS NOT NULL
        AND v.trade_id IS NULL
      ORDER BY COALESCE(p.closed_at, p.opened_at, p.created_at) ASC, p.trade_id ASC
    `).all();
  } catch (error) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const settled = settleTrade(row.trade_id);
      if (settled) synced += 1;
    } catch (error) {
      failed += 1;
      console.log(
        `⚠️ VIRTUAL PORTFOLIO sync failed | Trade #${row.trade_id}:`,
        error.message
      );
    }
  }

  if (synced > 0 || failed > 0) {
    console.log(
      `💼 VIRTUAL PORTFOLIO SYNC | settled=${synced} | failed=${failed}`
    );
  }

  return { synced, failed };
}

function getRecentTrades(limit = 5) {
  ensureTables();

  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));

  return db.prepare(`
    SELECT *
    FROM virtual_portfolio_trades
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit);
}

function strategyInfo(telegramId) {
  const source = String(telegramId || '').toUpperCase();

  if (source === 'VIP_REGIME') {
    return { key: 'REGIME', label: '🧭 Regime', current: true };
  }
  if (source === 'VIP_SCALP_NEW_YORK') {
    return { key: 'NEW_YORK', label: '🗽 New York', current: true };
  }
  if (source === 'VIP_SCALP_AGGRESSIVE_BREAKOUT_A') {
    return { key: 'BREAKOUT_A', label: '🔥 Breakout-A', current: true };
  }
  if (source === 'VIP_SCALP_PRO_STRATEGY') {
    return { key: 'PRO_STRATEGY', label: '⭐ Pro Strategy', current: true };
  }

  return { key: 'LEGACY_OTHER', label: '🗃️ Legacy / Other', current: false };
}

function maxDrawdownR(rows) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;

  for (const row of rows) {
    const r = Number(row.realized_r);
    if (!Number.isFinite(r)) continue;

    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  return Number(maxDd.toFixed(3));
}

function getStrategyStats() {
  ensureTables();

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT
        v.trade_id,
        v.realized_r,
        v.profit_loss,
        v.outcome,
        v.settled_at,
        p.telegram_id
      FROM virtual_portfolio_trades v
      LEFT JOIN trade_performance p
        ON p.trade_id = v.trade_id
      ORDER BY v.id ASC
    `).all();
  } catch (_) {
    return [];
  }

  const grouped = new Map();

  for (const row of rows) {
    const info = strategyInfo(row.telegram_id);

    if (!grouped.has(info.key)) {
      grouped.set(info.key, {
        ...info,
        rows: [],
        total: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        netR: 0,
        profit: 0
      });
    }

    const item = grouped.get(info.key);
    const r = Number(row.realized_r);
    const pnl = Number(row.profit_loss);

    item.rows.push(row);
    item.total += 1;

    if (Number.isFinite(pnl)) {
      if (pnl > 0) item.wins += 1;
      else if (pnl < 0) item.losses += 1;
      else item.breakeven += 1;
      item.profit += pnl;
    }

    if (Number.isFinite(r)) {
      item.netR += r;
    }
  }

  return [...grouped.values()]
    .map(item => ({
      key: item.key,
      label: item.label,
      current: item.current,
      total: item.total,
      wins: item.wins,
      losses: item.losses,
      breakeven: item.breakeven,
      winRate: item.total
        ? (item.wins / item.total) * 100
        : 0,
      netR: Number(item.netR.toFixed(3)),
      profit: Number(item.profit.toFixed(2)),
      maxDrawdownR: maxDrawdownR(item.rows)
    }))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.profit - a.profit;
    });
}

function getStats() {
  syncClosedTrades();

  const p = getPortfolio();

  const starting = Number(p.starting_balance);
  const balance = Number(p.balance);
  const netProfit = balance - starting;

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
    recent: getRecentTrades(5),
    by_strategy: getStrategyStats()
  };
}

module.exports = {
  ensureTables,
  settleTrade,
  syncClosedTrades,
  getPortfolio,
  getRecentTrades,
  getStrategyStats,
  getStats
};
