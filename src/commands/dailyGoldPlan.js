const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
const { getMultiSourceCalendar, isHighImpact } = require('../services/newsCalendarGate');

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
function cairoDayKey(date) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone:'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit' }).format(date); }
  catch { return date.toISOString().slice(0,10); }
}
function cairoTime(date) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone:'Africa/Cairo', hour:'2-digit', minute:'2-digit', hour12:false }).format(date); }
  catch { return date.toISOString().slice(11,16); }
}
function eventImpact(e) {
  const x = String(e?.impact || '').toLowerCase();
  if (isHighImpact(e) || x === 'high') return 'high';
  if (x === 'medium' || x === 'med') return 'medium';
  return 'low';
}
async function goldNewsSection(en = false) {
  try {
    const cal = await getMultiSourceCalendar(false);
    const now = new Date();
    const today = cairoDayKey(now);
    const events = (cal?.data || []).filter(e => {
      const d = new Date(e.date);
      if (!Number.isFinite(d.getTime()) || cairoDayKey(d) !== today) return false;
      const cur = String(e.currency || '').toUpperCase();
      return cur === 'USD' && ['high','medium'].includes(eventImpact(e));
    }).sort((a,b) => new Date(a.date) - new Date(b.date));
    const upcoming = events.filter(e => new Date(e.date).getTime() >= Date.now() - 15 * 60 * 1000);
    const important = upcoming.slice(0,4);
    if (!important.length) return en
      ? `📰 GOLD NEWS RISK\n• No upcoming medium/high-impact USD event found for the rest of today.`
      : `📰 أخبار مؤثرة على الذهب\n• لا توجد أخبار دولار متوسطة/عالية التأثير متبقية اليوم حسب التقويم الحالي.`;
    const lines = important.map(e => {
      const high = eventImpact(e) === 'high';
      const d = new Date(e.date);
      const mins = Math.round((d.getTime() - Date.now()) / 60000);
      const proximity = mins >= 0 && mins <= 60 ? (en ? ' ⚠️ SOON' : ' ⚠️ قريب') : '';
      return `• ${high ? '🔴' : '🟠'} ${cairoTime(d)} — ${String(e.title || 'USD event').trim()}${proximity}`;
    });
    const dangerSoon = important.some(e => eventImpact(e) === 'high' && new Date(e.date).getTime() >= Date.now() && new Date(e.date).getTime() - Date.now() <= 60 * 60 * 1000);
    const warning = dangerSoon
      ? (en ? '\n🚨 High-impact USD news is within 60 minutes. Avoid fresh gold entries around the release and wait for volatility to settle.' : '\n🚨 يوجد خبر دولار قوي خلال 60 دقيقة. يفضل عدم فتح دخول جديد على الذهب قرب الخبر وانتظار هدوء الحركة.')
      : (en ? '\n⚠️ Check these times before entering gold; USD releases can quickly change the technical setup.' : '\n⚠️ راجع المواعيد دي قبل دخول الذهب لأن أخبار الدولار ممكن تغيّر الصورة الفنية بسرعة.');
    return `${en ? '📰 GOLD NEWS RISK' : '📰 أخبار مؤثرة على الذهب'}\n${lines.join('\n')}${warning}`;
  } catch (error) {
    console.log('⚠️ DAILY GOLD NEWS:', error.message);
    return en ? '📰 GOLD NEWS RISK\n• News calendar is temporarily unavailable.' : '📰 أخبار مؤثرة على الذهب\n• تعذر قراءة التقويم الاقتصادي مؤقتًا.';
  }
}

async function buildDailyGoldPlan(en = false) {
  const frames = ['1day', '4h', '1h'];
  const analyses = {};
  for (const tf of frames) analyses[tf] = await analyzePair('XAUUSD', tf);
  const dirs = Object.fromEntries(frames.map(tf => [tf, direction(analyses[tf])]));
  const buyCount = Object.values(dirs).filter(x => x === 'BUY').length;
  const sellCount = Object.values(dirs).filter(x => x === 'SELL').length;
  const bias = buyCount >= 2 ? 'BUY' : sellCount >= 2 ? 'SELL' : 'NEUTRAL';
  const h1 = analyses['1h']?.indicators || {};
  const candles = await getGoldCandlesResilient('1h');
  const lv = levels(candles);
  const news = await goldNewsSection(en);
  const adx = n(h1.adx);
  const rsi = n(h1.rsi);
  const strength = adx == null ? (en ? 'Unknown' : 'غير محددة') : adx >= 25 ? (en ? 'Strong' : 'قوية') : adx >= 18 ? (en ? 'Medium' : 'متوسطة') : (en ? 'Weak / range risk' : 'ضعيفة / احتمال تذبذب');
  const plan = bias === 'BUY'
    ? (en ? 'Prefer buying pullbacks while the multi-timeframe bullish structure remains intact.' : 'الأفضل اليوم البحث عن شراء من التصحيحات طالما هيكل الفريمات ما زال صاعدًا.')
    : bias === 'SELL'
      ? (en ? 'Prefer selling rebounds while the multi-timeframe bearish structure remains intact.' : 'الأفضل اليوم البحث عن بيع من الارتفاعات طالما هيكل الفريمات ما زال هابطًا.')
      : (en ? 'No clear multi-timeframe edge. Waiting for alignment is preferable to forcing a trade.' : 'لا يوجد توافق قوي بين الفريمات حاليًا؛ الانتظار أفضل من إجبار صفقة.');

  if (en) return `🎯 DAILY GOLD PLAN — XAUUSD\n━━━━━━━━━━━━━━━━━━\n\n💵 Live price: ${fmt(h1.lastPrice)}\n\n🧭 MULTI-TIMEFRAME DIRECTION\n• D1: ${label(dirs['1day'], true)}\n• H4: ${label(dirs['4h'], true)}\n• H1: ${label(dirs['1h'], true)}\n\n🎯 Daily bias: ${label(bias, true)}\n💪 Trend strength H1: ${strength}${adx == null ? '' : ` (ADX ${adx.toFixed(1)})`}\n📊 RSI H1: ${rsi == null ? '—' : rsi.toFixed(1)}\n\n🧱 KEY H1 ZONE\n• Support: ${fmt(lv.support)}\n• Resistance: ${fmt(lv.resistance)}\n\n${news}\n\n📌 TODAY'S PLAN\n${plan}\n\n⚠️ Recheck the plan after major market moves or high-impact news. This is analytical guidance, not a profit guarantee.`;
  return `🎯 خطة الذهب اليومية — XAUUSD\n━━━━━━━━━━━━━━━━━━\n\n💵 السعر اللحظي: ${fmt(h1.lastPrice)}\n\n🧭 اتجاه الفريمات\n• اليومي D1: ${label(dirs['1day'], false)}\n• 4 ساعات H4: ${label(dirs['4h'], false)}\n• الساعة H1: ${label(dirs['1h'], false)}\n\n🎯 انحياز اليوم: ${label(bias, false)}\n💪 قوة الاتجاه H1: ${strength}${adx == null ? '' : ` (ADX ${adx.toFixed(1)})`}\n📊 RSI H1: ${rsi == null ? '—' : rsi.toFixed(1)}\n\n🧱 أهم منطقة على H1\n• الدعم: ${fmt(lv.support)}\n• المقاومة: ${fmt(lv.resistance)}\n\n${news}\n\n📌 خطة اليوم\n${plan}\n\n⚠️ أعد فحص الخطة بعد الحركات الكبيرة أو الأخبار القوية. التحليل للمساعدة في القرار وليس ضمانًا للربح.`;
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
