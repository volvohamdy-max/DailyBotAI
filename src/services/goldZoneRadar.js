const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
const { getPrice } = require('../services/marketService');

const TIMEFRAMES = [
  { key: '5min', label: 'M5', weight: 1 },
  { key: '15min', label: 'M15', weight: 2 },
  { key: '1h', label: 'H1', weight: 3 }
];
const COOLDOWN_MS = 20 * 60 * 1000;
const lastAlert = new Map();

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pctDistance(a, b) { return a > 0 ? Math.abs(a - b) / a * 100 : Infinity; }
function fmt(v) { return num(v) == null ? '—' : num(v).toFixed(2); }
function trendOf(a) {
  const i = a?.indicators || {};
  let buy = 0, sell = 0;
  if (num(i.ema20) != null && num(i.ema50) != null) num(i.ema20) > num(i.ema50) ? buy++ : sell++;
  if (num(i.rsi) != null) num(i.rsi) >= 50 ? buy++ : sell++;
  if (i.macd && num(i.macd.macd) != null && num(i.macd.signal) != null) num(i.macd.macd) >= num(i.macd.signal) ? buy++ : sell++;
  return buy > sell ? 'BUY' : sell > buy ? 'SELL' : 'NEUTRAL';
}
function localExtremes(candles) {
  const rows = (candles || []).slice(-120);
  const supports = [], resistances = [];
  for (let i = 2; i < rows.length - 2; i++) {
    const low = num(rows[i].low), high = num(rows[i].high);
    if (low == null || high == null) continue;
    const nearbyLows = rows.slice(i - 2, i + 3).map(x => num(x.low)).filter(Number.isFinite);
    const nearbyHighs = rows.slice(i - 2, i + 3).map(x => num(x.high)).filter(Number.isFinite);
    if (nearbyLows.length === 5 && low === Math.min(...nearbyLows)) supports.push(low);
    if (nearbyHighs.length === 5 && high === Math.max(...nearbyHighs)) resistances.push(high);
  }
  return { supports, resistances };
}
function clusterLevels(levels, price, tolerancePct = 0.12) {
  const groups = [];
  for (const level of levels.filter(x => num(x) != null && x > 0).sort((a,b) => a-b)) {
    let group = groups.find(g => pctDistance(g.mean, level) <= tolerancePct);
    if (!group) { group = { values: [], mean: level }; groups.push(group); }
    group.values.push(level);
    group.mean = group.values.reduce((s,x)=>s+x,0)/group.values.length;
  }
  return groups.map(g => ({
    price: g.mean,
    touches: g.values.length,
    distancePct: pctDistance(price, g.mean)
  })).filter(g => Number.isFinite(g.distancePct)).sort((a,b) => a.distancePct-b.distancePct);
}
async function buildRadar() {
  const [priceRaw, candles5, candles15, candles1h] = await Promise.all([
    getPrice('XAUUSD'),
    getGoldCandlesResilient('5min', 150),
    getGoldCandlesResilient('15min', 150),
    getGoldCandlesResilient('1h', 150)
  ]);
  const price = num(priceRaw);
  if (!(price > 0)) throw new Error('Invalid live gold price');
  const [a5, a15, a1h] = await Promise.all([
    analyzePair('XAUUSD', '5min'),
    analyzePair('XAUUSD', '15min'),
    analyzePair('XAUUSD', '1h')
  ]);
  const analyses = [a5, a15, a1h];
  const candles = [candles5, candles15, candles1h];
  const candidates = [];
  for (let idx = 0; idx < candles.length; idx++) {
    const tf = TIMEFRAMES[idx];
    const extremes = localExtremes(candles[idx]);
    const supports = clusterLevels(extremes.supports, price);
    const resistances = clusterLevels(extremes.resistances, price);
    for (const level of supports.slice(0, 8)) candidates.push({ ...level, side: 'BUY', timeframe: tf.label, weight: tf.weight });
    for (const level of resistances.slice(0, 8)) candidates.push({ ...level, side: 'SELL', timeframe: tf.label, weight: tf.weight });
  }
  // Consolidate same-side levels across timeframes into stronger multi-timeframe zones.
  const zones = [];
  for (const c of candidates.sort((a,b)=>a.distancePct-b.distancePct)) {
    let z = zones.find(x => x.side === c.side && pctDistance(x.price, c.price) <= 0.12);
    if (!z) { z = { side:c.side, price:c.price, touches:0, frames:new Set(), nearestPct:c.distancePct, strength:0 }; zones.push(z); }
    z.price = (z.price * z.touches + c.price) / (z.touches + 1);
    z.touches += c.touches;
    z.frames.add(c.timeframe);
    z.nearestPct = Math.min(z.nearestPct, c.distancePct);
    z.strength = z.touches * 5 + z.frames.size * 12 + Math.max(0, 25 - z.nearestPct * 100);
  }
  const nearby = zones.filter(z => z.nearestPct <= 0.65).sort((a,b)=>b.strength-a.strength).slice(0,6);
  const directions = analyses.map((a,i)=>({ tf:TIMEFRAMES[i].label, trend:trendOf(a), indicators:a?.indicators||{} }));
  const buyVotes = directions.filter(x=>x.trend==='BUY').length;
  const sellVotes = directions.filter(x=>x.trend==='SELL').length;
  const overall = buyVotes >= 2 ? 'BUY' : sellVotes >= 2 ? 'SELL' : 'NEUTRAL';
  const currentRsi = num(directions[1].indicators.rsi);
  const currentAdx = num(directions[1].indicators.adx);
  const support = nearby.filter(z=>z.side==='BUY').sort((a,b)=>a.nearestPct-b.nearestPct)[0];
  const resistance = nearby.filter(z=>z.side==='SELL').sort((a,b)=>a.nearestPct-b.nearestPct)[0];
  let setup = null;
  if (support && support.nearestPct <= 0.18 && overall !== 'SELL' && (currentRsi == null || currentRsi >= 42)) setup = { side:'BUY', zone:support, reason:'السعر قريب من دعم متعدد الفريمات مع عدم وجود تعارض هابط واضح.' };
  if (resistance && resistance.nearestPct <= 0.18 && overall !== 'BUY' && (currentRsi == null || currentRsi <= 62)) {
    if (!setup || resistance.strength > setup.zone.strength) setup = { side:'SELL', zone:resistance, reason:'السعر قريب من مقاومة متعددة الفريمات مع عدم وجود تعارض صاعد واضح.' };
  }
  const biasText = overall === 'BUY' ? 'صاعد' : overall === 'SELL' ? 'هابط' : 'غير محسوم';
  return { price, directions, overall, currentRsi, currentAdx, nearby, support, resistance, setup, biasText };
}
function formatRadar(r) {
  const trend = x => x === 'BUY' ? '🟢 صاعد' : x === 'SELL' ? '🔴 هابط' : '⚪ محايد';
  const zoneText = z => z ? `${fmt(z.price)} | بُعد ${z.nearestPct.toFixed(3)}% | ${z.frames.size} فريم | قوة ${Math.round(z.strength)}` : 'لا توجد منطقة قريبة كفاية';
  const lines = [
    '🚨 رادار مناطق الذهب الذكي — XAUUSD',
    '━━━━━━━━━━━━━━━━━━',
    `💵 السعر اللحظي: ${fmt(r.price)}`,
    `🧭 الاتجاه العام M5/M15/H1: ${trend(r.overall)}`,
    `📊 RSI M15: ${r.currentRsi == null ? '—' : r.currentRsi.toFixed(1)} | ADX M15: ${r.currentAdx == null ? '—' : r.currentAdx.toFixed(1)}`,
    '',
    '🧱 أقرب المناطق القوية:',
    `🟢 دعم: ${zoneText(r.support)}`,
    `🔴 مقاومة: ${zoneText(r.resistance)}`,
    '',
    r.setup
      ? `🚦 تنبيه منطقة نشطة: ${r.setup.side === 'BUY' ? 'شراء محتمل' : 'بيع محتمل'}\n📍 المنطقة: ${fmt(r.setup.zone.price)}\n📝 السبب: ${r.setup.reason}\n⚠️ دي منطقة للمراقبة وليست دخولًا مؤكدًا؛ انتظر شمعة تأكيد وحدد وقف الخسارة قبل التنفيذ.`
      : '⏳ لا يوجد دخول مؤكد الآن. الرادار يعرض المناطق القريبة فقط؛ لا تدخل لمجرد وصول السعر دون تأكيد.',
    '',
    '🔎 توافق الفريمات:',
    ...r.directions.map(x => `• ${x.tf}: ${trend(x.trend)}`),
    '',
    '⚠️ المستويات مستخرجة من قمم وقيعان الشموع وقد تتغير مع السوق. ليست ضمانًا للربح.'
  ];
  return lines.join('\n');
}
function registerGoldZoneRadar(bot) {
  bot.hears(['🚨 رادار مناطق الذهب', '🚨 Gold Zone Radar'], async ctx => {
    const en = ctx.state?.language === 'en';
    if (en) return ctx.reply('The gold zone radar is currently available in Arabic only. Switch to Arabic to use it.');
    await ctx.reply('🔍 جاري فحص مناطق الذهب على M5 وM15 وH1...');
    try { return ctx.reply(formatRadar(await buildRadar())); }
    catch (error) {
      console.log('❌ GOLD ZONE RADAR:', error.message);
      return ctx.reply('❌ تعذر فحص مناطق الذهب مؤقتًا. جرّب مرة أخرى بعد قليل.');
    }
  });
}
module.exports = { registerGoldZoneRadar, buildRadar, formatRadar };
