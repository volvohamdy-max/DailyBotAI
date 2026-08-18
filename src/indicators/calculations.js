function ema(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  values.forEach((value, index) => {
    result[index] = index === 0 ? value : value * k + result[index - 1] * (1 - k);
  });
  return result;
}

function rsi(closes, period = 14) {
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - (100 / (1 + rs));
}

function macd(closes) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = fast.map((value, i) => value - slow[i]);
  const signal = ema(line, 9);
  return { macd: line.at(-1), signal: signal.at(-1), histogram: line.at(-1) - signal.at(-1) };
}

function atr(candles, period = 14) {
  const ranges = candles.slice(-period).map((candle, index, arr) => {
    const prevClose = index === 0 ? candle.close : arr[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function adx(candles, period = 14) {
  const recent = candles.slice(-period);
  const directionalMoves = recent.map((candle, index) => {
    if (index === 0) return 0;
    return Math.abs(candle.close - recent[index - 1].close);
  });
  const averageMove = directionalMoves.reduce((sum, value) => sum + value, 0) / period;
  const volatility = atr(candles, period) || 1;
  return Math.min(100, (averageMove / volatility) * 50);
}

function supportResistance(candles, lookback = 30) {
  const recent = candles.slice(-lookback);
  return {
    support: Math.min(...recent.map((c) => c.low)),
    resistance: Math.max(...recent.map((c) => c.high))
  };
}

module.exports = { ema, rsi, macd, atr, adx, supportResistance };
