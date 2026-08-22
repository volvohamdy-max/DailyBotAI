const db = require('../database/db');

function strategyKey(source) {
  const s = String(source || '').toUpperCase();

  if (s === 'VIP_SCALP_GROK_GOLD_92') return 'GROK_GOLD_92';
  if (s === 'VIP_SCALP_NEW_YORK') return 'NEW_YORK';
  if (s === 'VIP_SCALP_PRO_STRATEGY') return 'PRO_STRATEGY';
  if (s === 'VIP_REGIME') return 'GOLD_REGIME';
  if (s === 'VIP_H4_MR') return 'H4_MEAN_REVERSION';

  // Free scalp signals lose their original source in the trades table.
  // Keep them visible rather than attributing them to the wrong strategy.
  if (s === 'VIP_FREE') return 'FREE_SCALP_UNATTRIBUTED';

  return null;
}

function ensurePerformanceTableExists() {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'trade_performance'
  `).get();

  return Boolean(row);
}

function getStrategyPortfolioStats(days = 30) {
  const windowDays = Math.max(1, Number(days) || 30);

  if (!ensurePerformanceTableExists()) {
    return {
      days: windowDays,
      strategies: [],
      note: 'trade_performance table not initialized yet'
    };
  }

  const cutoff = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const rows = db.prepare(`
    SELECT
      trade_id,
      telegram_id,
      closed_at,
      outcome,
      realized_r
    FROM trade_performance
    WHERE opened_at >= ?
    ORDER BY opened_at ASC
  `).all(cutoff);

  const groups = new Map();

  for (const row of rows) {
    const key = strategyKey(row.telegram_id);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        strategy: key,
        total: 0,
        closed: 0,
        open: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        netR: 0,
        grossProfitR: 0,
        grossLossR: 0
      });
    }

    const g = groups.get(key);
    g.total++;

    if (!row.closed_at) {
      g.open++;
      continue;
    }

    g.closed++;

    const r = Number(row.realized_r);

    if (Number.isFinite(r)) {
      g.netR += r;

      if (r > 0) {
        g.wins++;
        g.grossProfitR += r;
      } else if (r < 0) {
        g.losses++;
        g.grossLossR += Math.abs(r);
      } else {
        g.breakeven++;
      }
    } else {
      const outcome = String(row.outcome || '').toUpperCase();

      if (outcome === 'SL') g.losses++;
      else if (outcome === 'BREAKEVEN') g.breakeven++;
      else if (outcome) g.wins++;
    }
  }

  const strategies = [...groups.values()].map((g) => {
    const decided = g.wins + g.losses;

    return {
      strategy: g.strategy,
      total: g.total,
      closed: g.closed,
      open: g.open,
      wins: g.wins,
      losses: g.losses,
      breakeven: g.breakeven,
      winRate: decided > 0 ? (g.wins / decided) * 100 : 0,
      netR: g.netR,
      profitFactor:
        g.grossLossR > 0
          ? g.grossProfitR / g.grossLossR
          : g.grossProfitR > 0
            ? Infinity
            : 0
    };
  });

  strategies.sort((a, b) => b.netR - a.netR);

  return {
    days: windowDays,
    strategies
  };
}

module.exports = {
  getStrategyPortfolioStats
};
