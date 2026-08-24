const db = require('./db');

const PORTFOLIO_MAX_OPEN_GOLD = 2;

function normalizeSource(value) {
    return String(value || '').toUpperCase();
}

function isManagedStrategySource(source) {
    const s = normalizeSource(source);

    return (
        s.startsWith('VIP_SCALP_') ||
        s === 'VIP_REGIME' ||
        s === 'VIP_H4_MR' ||
        s === 'VIP_FREE'
    );
}

function getManagedOpenTrades() {
    return db.prepare(`
        SELECT *
        FROM trades
        WHERE pair = 'XAUUSD'
          AND status IN ('open', 'secured', 'target1')
          AND (
            UPPER(telegram_id) LIKE 'VIP_SCALP_%'
            OR UPPER(telegram_id) = 'VIP_REGIME'
            OR UPPER(telegram_id) = 'VIP_H4_MR'
            OR UPPER(telegram_id) = 'VIP_FREE'
          )
        ORDER BY id DESC
    `).all();
}

function evaluateGoldPortfolioEntry(data) {
    const source = normalizeSource(data?.telegram_id);
    const action = String(data?.action || '').toUpperCase();

    if (!isManagedStrategySource(source)) {
        return {
            allowed: true,
            managed: false,
            reason: 'UNMANAGED_SOURCE'
        };
    }

    if (!['BUY', 'SELL'].includes(action)) {
        return {
            allowed: false,
            managed: true,
            reason: 'INVALID_DIRECTION'
        };
    }

    const open = getManagedOpenTrades();

    const sameStrategy = open.find(
        trade => normalizeSource(trade.telegram_id) === source
    );

    if (sameStrategy) {
        return {
            allowed: false,
            managed: true,
            reason: 'STRATEGY_ALREADY_OPEN',
            openCount: open.length,
            conflictingTradeId: sameStrategy.id,
            conflictingSource: sameStrategy.telegram_id
        };
    }

    if (open.length >= PORTFOLIO_MAX_OPEN_GOLD) {
        return {
            allowed: false,
            managed: true,
            reason: 'MAX_OPEN_GOLD_REACHED',
            openCount: open.length,
            maxOpen: PORTFOLIO_MAX_OPEN_GOLD,
            openTrades: open
        };
    }

    // Match the validated portfolio backtest: the second slot is allowed when
    // it belongs to a different strategy, regardless of BUY/SELL direction.
    return {
        allowed: true,
        managed: true,
        reason: 'PORTFOLIO_OK',
        openCount: open.length,
        remainingSlots: PORTFOLIO_MAX_OPEN_GOLD - open.length
    };
}

function addTrade(data) {

    // الذهب فقط
    if (String(data.pair).toUpperCase() !== 'XAUUSD') {
        console.log(
            `⚠️ Skipped non-gold trade: ${data.pair}`
        );
        return null;
    }

    const portfolio = evaluateGoldPortfolioEntry(data);

    if (!portfolio.allowed) {
        console.log(
            `🛡️ GOLD PORTFOLIO BLOCKED | ` +
            `source=${normalizeSource(data.telegram_id)} | ` +
            `direction=${String(data.action || '').toUpperCase()} | ` +
            `reason=${portfolio.reason} | ` +
            `open=${portfolio.openCount ?? 'n/a'}/${PORTFOLIO_MAX_OPEN_GOLD}`
        );

        if (portfolio.conflictingTradeId) {
            console.log(
                `↔️ Conflict Trade #${portfolio.conflictingTradeId} | ` +
                `${portfolio.conflictingSource}`
            );
        }

        return null;
    }

    if (portfolio.managed) {
        console.log(
            `✅ GOLD PORTFOLIO OK | ` +
            `source=${normalizeSource(data.telegram_id)} | ` +
            `direction=${String(data.action || '').toUpperCase()} | ` +
            `open=${portfolio.openCount}/${PORTFOLIO_MAX_OPEN_GOLD}`
        );
    }

    return db.prepare(`
        INSERT INTO trades
        (telegram_id, pair, action, entry, stop_loss, target1, target2)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(data.telegram_id),
        'XAUUSD',
        data.action,
        data.entry,
        data.stop_loss,
        data.target1,
        data.target2
    );
}

function getOpenTrades() {
    return db.prepare(`
        SELECT *
        FROM trades
        WHERE pair = 'XAUUSD'
          AND status IN ('open', 'secured', 'target1')
        ORDER BY id DESC
    `).all();
}
function updateTradeStatus(id, status) {
    return db.prepare(
        "UPDATE trades SET status = ? WHERE id = ?"
    ).run(status, id);
}


function markTradeAsFree(id) {
  return db.prepare(
    "UPDATE trades SET telegram_id = 'VIP_FREE' WHERE id = ?"
  ).run(Number(id));
}

function deleteNonGoldTrades() {
    return db.prepare(
        "DELETE FROM trades WHERE pair != 'XAUUSD'"
    ).run();
}
function closeAllOpenTrades() {
    return db.prepare(
        "UPDATE trades SET status = 'closed' WHERE status = 'open'"
    ).run();
}
module.exports = {
    addTrade,
    getOpenTrades,
    getManagedOpenTrades,
    evaluateGoldPortfolioEntry,
    updateTradeStatus,
    markTradeAsFree,
    deleteNonGoldTrades,
    closeAllOpenTrades
};
