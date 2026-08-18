const axios = require('axios');
const config = require('../config');

function localDecision(indicators) {
  const bullish = indicators.ema20 > indicators.ema50 && indicators.macd.histogram > 0 && indicators.rsi < 70;
  const bearish = indicators.ema20 < indicators.ema50 && indicators.macd.histogram < 0 && indicators.rsi > 30;
  const action = bullish ? 'BUY' : bearish ? 'SELL' : 'WAIT';
  const entry = indicators.lastPrice;
  const risk = indicators.atr * 1.5;
  return {
    action,
    entry: entry.toFixed(5),
    stopLoss: action === 'BUY' ? (entry - risk).toFixed(5) : action === 'SELL' ? (entry + risk).toFixed(5) : 'N/A',
    targets: action === 'BUY'
      ? [(entry + risk).toFixed(5), (entry + risk * 2).toFixed(5)]
      : action === 'SELL'
        ? [(entry - risk).toFixed(5), (entry - risk * 2).toFixed(5)]
        : ['N/A'],
    confidence: Math.round(Math.min(85, 45 + indicators.adx / 2)),
  reason: 'الإشارة مبنية على توافق المؤشرات الفنية واتجاه السوق.'
  };
}

async function askOpenAI(pair, indicators) {return localDecision(indicators);
  if (!config.openaiApiKey) return localDecision(indicators);

  const prompt = `Analyze ${pair} forex data and return JSON only with action BUY/SELL/WAIT, entry, stopLoss, targets array, confidence, reason. Data: ${JSON.stringify(indicators)}`;
  const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: config.openaiModel,
    messages: [
      { role: 'system', content: 'You are a cautious forex analysis assistant. Return valid compact JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  }, {
    headers: { Authorization: `Bearer ${config.openaiApiKey}` }
  });

  return JSON.parse(data.choices[0].message.content);
}

module.exports = { askOpenAI, localDecision };
