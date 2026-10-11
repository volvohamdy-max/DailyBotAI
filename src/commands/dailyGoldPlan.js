const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function direction(a) {
  const i = a?.indicators || {};
  let buy = 0, sell = 0;
  if (n(i.ema20) != null && n(i.ema50) != null) n(i.ema20) > n(i.ema50) ? buy++ : sell++;
  if (n(i.rsi) != null) n(i.rsi) >= 50 ? buy++ : sell++;
  if (i.macd && n(i.macd.macd) != null && n(i.macd.signal) != null) n(i.macd.macd) >= n(i.macd.signal) ? buy++ : sell++;
  if (buy >= 2 && buy > sell) return 'BUY';
  if (sell >= 2 && sell > buy) return 'SELL';
  return 'NEUTRAL';
}
function fmt(v) { return n(v) == null ? '—' : n(v).toFixed(2); }
function label(d, en) { return d === 'BUY' ? (en ? '🟢 Bullish' : '🟢 صاعد') : d === 'SELL' ? (en ? '🔴 Bearish' : '🔴 هابط') : (en ? '⚪ Neutral' : '⚪ محايد'); }
function levels(candles) {
  const rows = (candles || []).slice(-60);
  if (!rows.length) return { support: null, resistance: null };
  const lows = rows.map(x => n(x.low)).filter(Number.isFinite);
  const highs = rows.map(x => n(x.high)).filter(Number.isFinite);
  return { support: lows.length ? Math.min(...lows) : null, resistance: highs.length ? Math.max(...highs) : null };
}

async function buildDailyGoldPlan(en = false) {
  const frames = ['1d', '4h', '1h'];
  const analyses = {};
  for (const tf of frames) analyses[tf] = await analyzePair('XAUUSD', tf);
  const dirs = Object.fromEntries(frames.map(tf => [tf, direction(analyses[tf])]));
  const buyCount = Object.values(dirs).filter(x => x === 'BUY').length;
  const sellCount = Object.values(dirs).filter(x => x === 'SELL').length;
  const bias = buyCount >= 2 ? 'BUY' : sellCount >= 2 ? 'SELL' : 'NEUTRAL';
  const h1 = analyses['1h']?.indicators || {};
  const candles = await getGoldCandlesResilient('1h');
  const lv = levels(candles);
  const adx = n(h1.adx);
  const rsi = n(h1.rsi);
  const strength = adx == null ? (en ? 'Unknown' : 'غير محددة') : adx >= 25 ? (en ? 'Strong' : 'قوية') : adx >= 18 ? (en ? 'Medium' : 'متوسطة') : (en ? 'Weak / range risk' : 'ضعيفة / احتمال تذبذب');
  const plan = bias === 'BUY'
    ? (en ? 'Prefer buying pullbacks while the multi-timeframe bullish structure remains intact.' : 'الأفضل اليوم البحث عن شراء من التصحيحات طالما هيكل الفريمات ما زال صاعدًا.')
    : bias === 'SELL'
      ? (en ? 'Prefer selling rebounds while the multi-timeframe bearish structure remains intact.' : 'الأفضل اليوم البحث عن بيع من الارتفاعات طالما هيكل الفريمات ما زال هابطًا.')
      : (en ? 'No clear multi-timeframe edge. Waiting for alignment is preferable to forcing a trade.' : 'لا يوجد توافق قوي بين الفريمات حاليًا؛ الانتظار أفضل من إجبار صفقة.');

  if (en) return `🎯 DAILY GOLD PLAN — XAUUSD\n━━━━━━━━━━━━━━━━━━\n\n💵 Live price: ${fmt(h1.lastPrice)}\n\n🧭 MULTI-TIMEFRAME DIRECTION\n• D1: ${label(dirs['1d'], true)}\n• H4: ${label(dirs['4h'], true)}\n• H1: ${label(dirs['1h'], true)}\n\n🎯 Daily bias: ${label(bias, true)}\n💪 Trend strength H1: ${strength}${adx == null ? '' : ` (ADX ${adx.toFixed(1)})`}\n📊 RSI H1: ${rsi == null ? '—' : rsi.toFixed(1)}\n\n🧱 KEY H1 ZONE\n• Support: ${fmt(lv.support)}\n• Resistance: ${fmt(lv.resistance)}\n\n📌 TODAY'S PLAN\n${plan}\n\n⚠️ Recheck the plan after major market moves or high-impact news. This is analytical guidance, not a profit guarantee.`;
  return `🎯 خطة الذهب اليومية — XAUUSD\n━━━━━━━━━━━━━━━━━━\n\n💵 السعر اللحظي: ${fmt(h1.lastPrice)}\n\n🧭 اتجاه الفريمات\n• اليومي D1: ${label(dirs['1d'], false)}\n• 4 ساعات H4: ${label(dirs['4h'], false)}\n• الساعة H1: ${label(dirs['1h'], false)}\n\n🎯 انحياز اليوم: ${label(bias, false)}\n💪 قوة الاتجاه H1: ${strength}${adx == null ? '' : ` (ADX ${adx.toFixed(1)})`}\n📊 RSI H1: ${rsi == null ? '—' : rsi.toFixed(1)}\n\n🧱 أهم منطقة على H1\n• الدعم: ${fmt(lv.support)}\n• المقاومة: ${fmt(lv.resistance)}\n\n📌 خطة اليوم\n${plan}\n\n⚠️ أعد فحص الخطة بعد الحركات الكبيرة أو الأخبار القوية. التحليل للمساعدة في القرار وليس ضمانًا للربح.`;
}

module.exports = function registerDailyGoldPlan(bot) {
  bot.hears(['🎯 خطة الذهب اليومية', '🎯 Daily Gold Plan'], async ctx => {
    const en = ctx.state?.language === 'en';
    await ctx.reply(en ? '🔍 Building today’s gold plan across D1, H4 and H1...' : '🔍 جاري تجهيز خطة الذهب لليوم على D1 وH4 وH1...');
    try { return ctx.reply(await buildDailyGoldPlan(en)); }
    catch (error) {
      console.log('❌ DAILY GOLD PLAN:', error.message);
      return ctx.reply(en ? '❌ Daily gold plan is temporarily unavailable. Try again shortly.' : '❌ تعذر تجهيز خطة الذهب اليومية مؤقتًا. جرّب مرة أخرى بعد قليل.');
    }
  });
};
