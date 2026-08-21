const {
  getOpenShadowTrades,
  markShadowTp1,
  closeShadowTrade
} = require('../database/shadowTrades');

const {
  getLivePrice
} = require('./priceService');

const {
  getCandles
} = require('./marketService');

let shadowMonitorRunning = false;

function n(value) {
  if (value === null || value === undefined || value === '') return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function candleTimeMs(candle) {
  const raw = candle?.timestamp ?? candle?.time ?? candle?.datetime ?? candle?.date;
  if (raw == null) return null;

  if (typeof raw === 'number' || /^\d+(?:\.\d+)?$/.test(String(raw))) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    return num < 1e12 ? num * 1000 : num;
  }

  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function hitLevel(action, price, level, type) {
  if (
    !['BUY', 'SELL'].includes(action) ||
    price === null ||
    level === null
  ) {
    return false;
  }

  if (action === 'BUY') {
    if (type === 'TP') return price >= level;
    if (type === 'SL') return price <= level;
  }

  if (action === 'SELL') {
    if (type === 'TP') return price <= level;
    if (type === 'SL') return price >= level;
  }

  return false;
}

function candleHits(action, candle, level, type) {
  const high = n(candle?.high);
  const low = n(candle?.low);
  if (high === null || low === null || level === null) return false;

  if (action === 'BUY') {
    return type === 'TP' ? high >= level : low <= level;
  }

  if (action === 'SELL') {
    return type === 'TP' ? low <= level : high >= level;
  }

  return false;
}

function relevantCandles(candles, createdAt) {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return [];

  // Include the candle containing the creation moment.
  const from = createdMs - 5 * 60 * 1000;

  return (Array.isArray(candles) ? candles : [])
    .map(c => ({ ...c, __ts: candleTimeMs(c) }))
    .filter(c => Number.isFinite(c.__ts) && c.__ts >= from)
    .sort((a, b) => a.__ts - b.__ts);
}

function applyCandlePath(trade, candles) {
  const action = String(trade.action || '').toUpperCase();
  const tp1 = n(trade.target1);
  const tp2 = n(trade.target2);
  const sl = n(trade.stop_loss);
  let tp1Hit = Number(trade.tp1_hit) === 1;

  for (const candle of relevantCandles(candles, trade.created_at)) {
    const tp2Hit = candleHits(action, candle, tp2, 'TP');
    const slHit = candleHits(action, candle, sl, 'SL');
    const tp1Now = !tp1Hit && candleHits(action, candle, tp1, 'TP');

    // If both extremes are crossed inside the same candle and we cannot know
    // intrabar order, do not invent an outcome. Leave it for a later/lower-TF
    // observation instead of biasing the audit.
    if (tp2Hit && slHit) {
      console.log(
        `👻 Shadow intrabar ambiguous | #${trade.id} | ${trade.pair} | candle=${new Date(candle.__ts).toISOString()}`
      );
      continue;
    }

    if (tp2Hit) {
      return {
        close: 'TP2',
        price: tp2,
        tp1Hit: true,
        source: 'CANDLE'
      };
    }

    if (tp1Now) {
      markShadowTp1(trade.id, tp1);
      tp1Hit = true;
      console.log(
        `👻🎯 SHADOW TP1 | #${trade.id} | ${trade.pair} | ${tp1} | source=candle`
      );
    }

    if (slHit) {
      return {
        close: 'SL',
        price: sl,
        tp1Hit,
        source: 'CANDLE'
      };
    }
  }

  return { close: null, tp1Hit };
}

async function monitorShadowTrades() {
  if (shadowMonitorRunning) {
    console.log('👻 Shadow monitor already running - skipped');
    return;
  }

  shadowMonitorRunning = true;

  try {
    const trades = getOpenShadowTrades();
    if (!trades.length) return;

    const candleCache = new Map();
    const priceCache = new Map();

    for (const trade of trades) {
      try {
        const pair = String(trade.pair).toUpperCase();
        const action = String(trade.action).toUpperCase();

        let candles = candleCache.get(pair);
        if (candles === undefined) {
          try {
            candles = await getCandles(pair, '5min');
          } catch (error) {
            candles = null;
            console.log(
              `👻 Shadow candles unavailable | ${pair} | ${error.message}`
            );
          }
          candleCache.set(pair, candles);
        }

        if (Array.isArray(candles) && candles.length) {
          const path = applyCandlePath(trade, candles);

          if (path.close) {
            closeShadowTrade(trade.id, path.close, path.price);
            console.log(
              path.close === 'TP2'
                ? `👻🏆 SHADOW TP2 | #${trade.id} | ${pair} | ${path.price} | source=candle`
                : `👻🛑 SHADOW SL | #${trade.id} | ${pair} | ${path.price} | source=candle`
            );
            continue;
          }
        }

        // Live-price fallback covers the newest movement after the latest candle.
        let price = priceCache.get(pair);
        if (price === undefined) {
          price = n(await getLivePrice(pair));
          priceCache.set(pair, price);
        }

        if (price === null) {
          console.log(`👻 Invalid price | Shadow #${trade.id} | ${pair}`);
          continue;
        }

        const tp1 = n(trade.target1);
        const tp2 = n(trade.target2);
        const sl = n(trade.stop_loss);

        if (hitLevel(action, price, tp2, 'TP')) {
          closeShadowTrade(trade.id, 'TP2', price);
          console.log(`👻🏆 SHADOW TP2 | #${trade.id} | ${pair} | ${price} | source=live`);
          continue;
        }

        if (!Number(trade.tp1_hit) && hitLevel(action, price, tp1, 'TP')) {
          markShadowTp1(trade.id, price);
          console.log(`👻🎯 SHADOW TP1 | #${trade.id} | ${pair} | ${price} | source=live`);
        }

        if (hitLevel(action, price, sl, 'SL')) {
          closeShadowTrade(trade.id, 'SL', price);
          console.log(`👻🛑 SHADOW SL | #${trade.id} | ${pair} | ${price} | source=live`);
        }

      } catch (error) {
        console.log(`👻 Shadow #${trade.id} error:`, error.message);
      }
    }

  } finally {
    shadowMonitorRunning = false;
  }
}

module.exports = {
  monitorShadowTrades,
  hitLevel,
  candleHits
};
