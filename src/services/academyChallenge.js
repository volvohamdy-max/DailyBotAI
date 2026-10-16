const { analyzePair } = require('./analysisService');
const { getPrice } = require('./marketService');

function direction(a) { return a?.technicalDirection || a?.signal?.action || 'WAIT'; }
function n(v, d = 1) { const x = Number(v); return Number.isFinite(x) ? x.toFixed(d) : 'N/A'; }

async function buildGoldChallenge() {
  const [price, h1, m15] = await Promise.all([
    getPrice('XAUUSD'),
    analyzePair('XAUUSD', '1h'),
    analyzePair('XAUUSD', '15min')
  ]);
  const h = direction(h1), m = direction(m15);
  let answer = 'WAIT';
  if (h === 'BUY' && m === 'BUY') answer = 'BUY';
  if (h === 'SELL' && m === 'SELL') answer = 'SELL';
  const hi = h1?.indicators || {}, mi = m15?.indicators || {};
  return {
    answer,
    text: `🏆 تحدي محلل الذهب LIVE\n━━━━━━━━━━━━━━━━━━\n💵 XAUUSD: ${n(price,2)}\n\n🕐 H1\nالاتجاه: ${h}\nRSI: ${n(hi.rsi)} | ADX: ${n(hi.adx)}\n\n🕒 M15\nالاتجاه: ${m}\nRSI: ${n(mi.rsi)} | ADX: ${n(mi.adx)}\n\n❓ بناءً على المعطيات دي، قرارك التعليمي إيه؟`,
    explanation: answer === 'WAIT'
      ? 'الفريمات غير متوافقة بوضوح، لذلك الانتظار أفضل من إجبار صفقة.'
      : `H1 وM15 متوافقان على ${answer}. ده يعطي سياقًا أقوى، لكن الدخول الحقيقي ما زال يحتاج منطقة وتأكيد وإدارة مخاطر وأخبار آمنة.`
  };
}

module.exports = { buildGoldChallenge };
