const { ema, rsi, macd, atr, adx, supportResistance } = require('./calculations');

function analyzeIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 50) {
    throw new Error('يلزم 50 شمعة على الأقل للتحليل.');
  }
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20).at(-1);
  const ema50 = ema(closes, 50).at(-1);
  return {
    lastPrice: closes.at(-1),
    rsi: rsi(closes),
    macd: macd(closes),
    ema20,
    ema50,
    atr: atr(candles),
    adx: adx(candles),
    ...supportResistance(candles)
  };
}

module.exports = analyzeIndicators;
