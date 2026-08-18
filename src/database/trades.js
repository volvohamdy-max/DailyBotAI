const db = require('./db');

function addTrade(data) {

    // الذهب فقط
    if (String(data.pair).toUpperCase() !== 'XAUUSD') {
        console.log(
            `⚠️ Skipped non-gold trade: ${data.pair}`
        );
        return null;
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
    updateTradeStatus,
    markTradeAsFree,
    deleteNonGoldTrades,
    closeAllOpenTrades
};
