const {
  getOpenShadowTrades,
  markShadowTp1,
  closeShadowTrade
} = require('../database/shadowTrades');

const {
  getLivePrice
} = require('./priceService');


let shadowMonitorRunning = false;


function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
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
    if (type === 'TP') {
      return price >= level;
    }

    if (type === 'SL') {
      return price <= level;
    }
  }

  if (action === 'SELL') {
    if (type === 'TP') {
      return price <= level;
    }

    if (type === 'SL') {
      return price >= level;
    }
  }

  return false;
}


async function monitorShadowTrades() {
  if (shadowMonitorRunning) {
    console.log(
      '👻 Shadow monitor already running - skipped'
    );
    return;
  }

  shadowMonitorRunning = true;

  try {
    const trades =
      getOpenShadowTrades();

    if (!trades.length) {
      return;
    }

    /*
     * One price request per pair.
     * If later we add more assets this avoids
     * requesting the same live price repeatedly.
     */
    const priceCache =
      new Map();


    for (const trade of trades) {
      try {
        const pair =
          String(trade.pair)
            .toUpperCase();

        const action =
          String(trade.action)
            .toUpperCase();


        let price =
          priceCache.get(pair);


        if (price === undefined) {
          price =
            n(
              await getLivePrice(pair)
            );

          priceCache.set(
            pair,
            price
          );
        }


        if (price === null) {
          console.log(
            `👻 Invalid price | Shadow #${trade.id} | ${pair}`
          );

          continue;
        }


        const tp1 =
          n(trade.target1);

        const tp2 =
          n(trade.target2);

        const sl =
          n(trade.stop_loss);


        /*
         * TP2 checked first because price can move
         * through TP1 and TP2 between monitor cycles.
         */
        if (
          hitLevel(
            action,
            price,
            tp2,
            'TP'
          )
        ) {
          closeShadowTrade(
            trade.id,
            'TP2',
            price
          );

          console.log(
            `👻🏆 SHADOW TP2 | #${trade.id} | ${pair} | ${price}`
          );

          continue;
        }


        if (
          !Number(trade.tp1_hit) &&
          hitLevel(
            action,
            price,
            tp1,
            'TP'
          )
        ) {
          markShadowTp1(
            trade.id,
            price
          );

          console.log(
            `👻🎯 SHADOW TP1 | #${trade.id} | ${pair} | ${price}`
          );
        }


        if (
          hitLevel(
            action,
            price,
            sl,
            'SL'
          )
        ) {
          closeShadowTrade(
            trade.id,
            'SL',
            price
          );

          console.log(
            `👻🛑 SHADOW SL | #${trade.id} | ${pair} | ${price}`
          );
        }

      } catch (error) {
        console.log(
          `👻 Shadow #${trade.id} error:`,
          error.message
        );
      }
    }

  } finally {
    shadowMonitorRunning = false;
  }
}


module.exports = {
  monitorShadowTrades,
  hitLevel
};
