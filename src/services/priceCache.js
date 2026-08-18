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

    const CACHE_TIME = 30 * 1000; // 30 seconds - Trade Monitor

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
