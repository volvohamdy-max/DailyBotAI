const {
  buildOpportunityRadar
} = require('./opportunityRadar');

const {
  addShadowTrade
} = require('../database/shadowTrades');

const {
  getCandles
} = require('./marketService');

const {
  calculateTradeLevels
} = require('./tradeEngine');


function n(value) {
  const x = Number(value);
  return Number.isFinite(x)
    ? x
    : null;
}


function getLevels(row) {
  const levels =
    row.levels ||
    row.tradeLevels ||
    row.signal?.levels ||
    {};

  return {
    entry: n(
      row.entry ??
      levels.entry ??
      row.signal?.entry
    ),

    sl: n(
      row.stop_loss ??
      row.sl ??
      levels.sl ??
      levels.stop_loss ??
      row.signal?.sl
    ),

    tp1: n(
      row.target1 ??
      row.tp1 ??
      levels.tp1 ??
      row.signal?.tp1
    ),

    tp2: n(
      row.target2 ??
      row.tp2 ??
      levels.tp2 ??
      row.signal?.tp2
    )
  };
}


function validLevels(
  action,
  levels
) {
  const {
    entry,
    sl,
    tp1,
    tp2
  } = levels;

  if (
    [entry, sl, tp1, tp2]
      .some(x => x === null)
  ) {
    return false;
  }

  if (action === 'BUY') {
    return (
      sl < entry &&
      tp1 > entry &&
      tp2 >= tp1
    );
  }

  if (action === 'SELL') {
    return (
      sl > entry &&
      tp1 < entry &&
      tp2 <= tp1
    );
  }

  return false;
}


async function resolveShadowLevels(row, action) {
  const direct = getLevels(row);

  if (validLevels(action, direct)) {
    return direct;
  }

  try {
    const candles = await getCandles(
      String(row.pair || '').toUpperCase(),
      '15min'
    );

    const calculated = calculateTradeLevels(
      candles,
      action,
      row.pair
    );

    if (!calculated) {
      return direct;
    }

    const generated = {
      entry: n(calculated.entry),
      sl: n(calculated.sl),
      tp1: n(calculated.tp1),
      tp2: n(calculated.tp2)
    };

    if (validLevels(action, generated)) {
      console.log(
        `👻 Shadow levels generated | ${row.pair} ${action} | source=tradeEngine`
      );
      return generated;
    }

  } catch (error) {
    console.log(
      `👻 Shadow level generation failed ${row.pair}:`,
      error.message
    );
  }

  return direct;
}


async function collectShadowOpportunities() {
  const rows =
    await buildOpportunityRadar();

  let created = 0;


  for (const row of rows) {
    /*
     * Shadow = interesting opportunity that
     * has NOT reached full 6/6 confirmation.
     *
     * IMPORTANT:
     * This does not change any live strategy decision.
     * It only creates a virtual observation trade.
     */
    if (
      row.passed < 4 ||
      row.passed >= row.total
    ) {
      continue;
    }


    const action =
      String(row.direction || '')
        .toUpperCase();


    if (
      !['BUY', 'SELL']
        .includes(action)
    ) {
      continue;
    }


    const levels =
      await resolveShadowLevels(
        row,
        action
      );


    if (
      !validLevels(
        action,
        levels
      )
    ) {
      console.log(
        `👻 Shadow skipped ${row.pair}: unable to build valid observation levels`
      );

      continue;
    }


    const missing =
      new Set(
        row.missing || []
      );


    const result =
      addShadowTrade({
        pair: row.pair,
        action,

        entry:
          levels.entry,

        stop_loss:
          levels.sl,

        target1:
          levels.tp1,

        target2:
          levels.tp2,

        source:
          `RADAR_${row.passed}_OF_${row.total}`,

        original_score:
          row.score,

        ema_ok:
          !missing.has(
            'تأكيد EMA'
          ),

        rsi_ok:
          !missing.has(
            'منطقة RSI'
          ),

        adx_ok:
          !missing.has(
            'قوة ADX'
          ),

        vwap_ok:
          !missing.has(
            'تأكيد VWAP'
          ),

        momentum_ok:
          !missing.has(
            'زخم MACD'
          )
      });


    if (result) {
      created += 1;

      console.log(
        `👻 Shadow created | ${row.pair} ${action} | ${row.passed}/${row.total} | ` +
        `entry=${levels.entry} sl=${levels.sl} tp1=${levels.tp1} tp2=${levels.tp2}`
      );
    }
  }


  return created;
}


module.exports = {
  collectShadowOpportunities,
  resolveShadowLevels
};
