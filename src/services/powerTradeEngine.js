const {
  savePowerTrade
} = require('../database/powerTrades');


function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


function evaluatePowerTrade({
  tradeId,
  pair,
  action,
  result
}) {

  const indicators =
    result?.indicators || {};

  const scalp =
    result?.scalpMeta || {};

  const direction =
    String(action || '')
      .toUpperCase();


  if (
    !tradeId ||
    !['BUY', 'SELL'].includes(direction)
  ) {
    return {
      qualified: false,
      reason: 'INVALID_TRADE'
    };
  }


  const technicalScore =
    number(
      result?.smartScore ??
      result?.finalScore ??
      result?.score
    ) ?? 0;


  const aiConfidence =
    number(
      result?.signal?.confidence
    ) ?? 0;


  const scalpScore =
    number(
      scalp?.score
    ) ?? 0;


  const ema20 =
    number(
      indicators.ema20 ??
      scalp.ema20
    );

  const ema50 =
    number(
      indicators.ema50 ??
      scalp.ema50
    );

  const rsi =
    number(
      indicators.rsi ??
      scalp.rsi5
    );

  const adx =
    number(
      indicators.adx ??
      scalp.adx5
    );

  const vwap =
    number(
      indicators.vwap ??
      scalp.vwap5
    );

  const price =
    number(
      indicators.lastPrice ??
      scalp.entry ??
      result?.price
    );


  const momentumDirection =
    String(
      scalp?.momentum?.direction ??
      indicators?.momentum?.direction ??
      ''
    ).toUpperCase();


  const emaOk =
    ema20 !== null &&
    ema50 !== null &&
    (
      (
        direction === 'BUY' &&
        ema20 > ema50
      ) ||
      (
        direction === 'SELL' &&
        ema20 < ema50
      )
    );


  const rsiOk =
    rsi !== null &&
    (
      (
        direction === 'BUY' &&
        rsi >= 50 &&
        rsi <= 72
      ) ||
      (
        direction === 'SELL' &&
        rsi <= 50 &&
        rsi >= 28
      )
    );


  const adxOk =
    adx !== null &&
    adx >= 25;


  const vwapOk =
    vwap !== null &&
    price !== null &&
    (
      (
        direction === 'BUY' &&
        price >= vwap
      ) ||
      (
        direction === 'SELL' &&
        price <= vwap
      )
    );


  const momentumOk =
    momentumDirection === direction;


  const checks = [
    emaOk,
    rsiOk,
    adxOk,
    vwapOk,
    momentumOk
  ];

  const passed =
    checks.filter(Boolean).length;


  /*
   * STRICT SHADOW CLASSIFICATION
   *
   * مهم:
   * ده لا يغير قرار التداول.
   * فقط يصنف الصفقة بعد صدورها.
   */
  const powerScore =
    Math.round(
      (
        Math.min(100, technicalScore) * 0.25 +
        Math.min(100, aiConfidence) * 0.25 +
        Math.min(100, scalpScore) * 0.30 +
        (passed / 5 * 100) * 0.20
      )
    );


  const grade =
    powerScore >= 95
      ? 'S+'
      : powerScore >= 90
        ? 'S'
        : powerScore >= 85
          ? 'A+'
          : 'NORMAL';


  const qualified =
    powerScore >= 90 &&
    passed >= 4 &&
    (
      scalpScore >= 85 ||
      aiConfidence >= 90
    );


  if (qualified) {
    savePowerTrade({
      tradeId,
      pair,
      action: direction,

      powerScore,
      technicalScore,
      aiConfidence,
      scalpScore,

      emaOk,
      rsiOk,
      adxOk,
      vwapOk,
      momentumOk,

      grade
    });
  }


  return {
    qualified,
    powerScore,
    grade,
    passed,
    total: 5,

    technicalScore,
    aiConfidence,
    scalpScore
  };
}


module.exports = {
  evaluatePowerTrade
};
