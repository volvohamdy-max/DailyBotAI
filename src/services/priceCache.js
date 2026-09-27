const cache = {};

function setPrice(pair, price) {
    cache[pair] = {
        price,
        time: Date.now()
    };
}

function getCachedPrice(pair) {
    const item = cache[pair];

    if (!item) {
        return null;
    }

    const CACHE_TIME = Number(process.env.TRADE_MONITOR_PRICE_CACHE_MS) || 10 * 1000; // 10s default: keep TP/SL tracking responsive

    if (Date.now() - item.time > CACHE_TIME) {
        delete cache[pair];
        return null;
    }

    return item.price;
}

module.exports = {
    setPrice,
    getCachedPrice
};
