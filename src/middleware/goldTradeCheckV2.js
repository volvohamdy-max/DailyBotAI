const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
const { getPrice } = require('../services/marketService');
const { calculateTradeLevels } = require('../services/tradeEngine');
const { findUser } = require('../database/users');

const FRAMES = [
  ['D1', '1day', 5],
  ['H4', '4h', 5],
  ['H1', '1h', 4],
  ['M15', '15min', 3],
  ['M5', '5min', 1]
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function directionOf(analysis) {
  const action = String(analysis?.signal?.action || '').toUpperCase();
  if (action === 'BUY' || action === 'SELL') return action;
  const technical = String(analysis?.technicalDirection || '').toUpperCase();
  if (technical === 'BUY' || technical === 'SELL') return technical;
  const i = analysis?.indicators || {};
  const ema20 = num(i.ema20), ema50 = num(i.ema50), rsi = Number(i.rsi);
  if (ema20 && ema50) {
    if (ema20 > ema50 && (!Number.isFinite(rsi) || rsi >= 48)) return 'BUY';
    if (ema20 < ema50 && (!Number.isFinite(rsi) || rsi <= 52)) return 'SELL';
  }
  return null;
}

function validLevels(direction, entry, sl, tp1, tp2) {
  if (![entry, sl, tp1, tp2].every(v => Number.isFinite(v) && v > 0)) return false;
  return direction === 'BUY'
    ? sl < entry && entry < tp1 && tp1 < tp2
    : sl > entry && entry > tp1 && tp1 > tp2;
}

async function buildCheck(ctx, type, direction) {
  const en = findUser(ctx.from?.id)?.language === 'en';
  const executionTf = type === 'scalp' ? '5min' : '15min';

  const frames = await Promise.all(FRAMES.map(async ([label, tf, weight]) => {
    try {
      const analysis = await analyzePair('XAUUSD', tf);
      return { label, tf, weight, direction: directionOf(analysis), analysis };
    } catch (error) {
      return { label, tf, weight, direction: null };
    }
  }));

  const execution = frames.find(f => f.tf === executionTf)?.analysis;
  if (!execution?.indicators) throw new Error('Insufficient execution timeframe data');

  const candles = await getGoldCandlesResilient(executionTf);
  if (!Array.isArray(candles) || candles.length < 20) throw new Error('Insufficient Gold candles');

  let levels = calculateTradeLevels(candles, direction, 'XAUUSD');
  if (!levels) throw new Error('Unable to calculate trade levels');

  let entry = num(levels.entry);
  let sl = num(levels.sl ?? levels.stopLoss);
  let tp1 = num(levels.tp1 ?? levels.target1);
  let tp2 = num(levels.tp2 ?? levels.target2);

  try {
    const live = num(await getPrice('XAUUSD'));
    if (live && entry) {
      const shift = live - entry;
      entry = live;
      sl = sl ? sl + shift : null;
      tp1 = tp1 ? tp1 + shift : null;
      tp2 = tp2 ? tp2 + shift : null;
    }
  } catch (_) {}

  if (!validLevels(direction, entry, sl, tp1, tp2)) throw new Error('Invalid execution levels');

  const usable = frames.filter(f => f.direction);
  const totalWeight = usable.reduce((sum, f) => sum + f.weight, 0) || 1;
  const alignedWeight = usable.filter(f => f.direction === direction).reduce((sum, f) => sum + f.weight, 0);
  const alignment = Math.round(alignedWeight / totalWeight * 100);
  const htf = usable.filter(f => f.label === 'D1' || f.label === 'H4');
  const htfAligned = htf.filter(f => f.direction === direction).length;
  const executionDir = directionOf(execution);

  let score = alignment;
  if (htf.length === 2 && htfAligned === 2) score += 10;
  if (htf.length === 2 && htfAligned === 0) score -= 25;
  if (executionDir === direction) score += 8; else if (executionDir) score -= 12;
  score = Math.max(0, Math.min(100, score));

  const risk = Math.abs(entry - sl);
  const rr1 = risk > 0 ? Math.abs(tp1 - entry) / risk : null;
  const rr2 = risk > 0 ? Math.abs(tp2 - entry) / risk : null;
  const fmt = v => Number(v).toFixed(2);
  const frameLine = frames.map(f => `${f.label}:${f.direction === 'BUY' ? '🟢' : f.direction === 'SELL' ? '🔴' : '⚪'}`).join('  ');

  let verdict;
  if (htf.length === 2 && htfAligned === 0) verdict = en ? '⛔ Higher timeframes conflict with your trade.' : '⛔ الفريمات الكبيرة عكس اتجاه صفقتك.';
  else if (score >= 80) verdict = en ? '🔥 Strong multi-timeframe confirmation.' : '🔥 تأكيد قوي من تعدد الفريمات.';
  else if (score >= 65) verdict = en ? '🟢 Good confirmation, but not the strongest setup.' : '🟢 تأكيد جيد، لكن الصفقة ليست في أقوى حالة.';
  else verdict = en ? '🟡 Confirmation is incomplete; waiting is safer.' : '🟡 التأكيد غير مكتمل؛ الانتظار أفضل.';

  return en
    ? `🥇 GOLD TRADE CHECK — VIP\n━━━━━━━━━━━━━━━━━━\n⚙️ Type: ${type === 'scalp' ? 'Scalping' : 'Intraday'}\n⏱️ Execution TF: ${executionTf}\n🎯 Your direction: ${direction}\n\n${verdict}\n\n🧭 Multi-timeframe\n${frameLine}\n📊 Alignment: ${alignment}%\n⭐ Final score: ${score}/100\n\n💰 Entry: ${fmt(entry)}\n🛑 Stop Loss: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}\n🏆 TP2: ${fmt(tp2)}\n⚖️ R:R TP1: ${rr1 ? `1:${rr1.toFixed(2)}` : '—'} | TP2: ${rr2 ? `1:${rr2.toFixed(2)}` : '—'}\n\n⚠️ Market analysis, not a guarantee of profit.`
    : `🥇 اختبار صفقة الذهب — VIP\n━━━━━━━━━━━━━━━━━━\n⚙️ النوع: ${type === 'scalp' ? 'سكالب' : 'إنتراداي'}\n⏱️ فريم التنفيذ: ${executionTf}\n🎯 اختيارك: ${direction}\n\n${verdict}\n\n🧭 تحليل الفريمات\n${frameLine}\n📊 نسبة التوافق: ${alignment}%\n⭐ التقييم النهائي: ${score}/100\n\n💰 الدخول: ${fmt(entry)}\n🛑 وقف الخسارة: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}\n🏆 TP2: ${fmt(tp2)}\n⚖️ العائد/المخاطرة TP1: ${rr1 ? `1:${rr1.toFixed(2)}` : '—'} | TP2: ${rr2 ? `1:${rr2.toFixed(2)}` : '—'}\n\n⚠️ تحليل لحظي للسوق وليس ضمانًا للربح.`;
}

module.exports = function goldTradeCheckV2() {
  return async (ctx, next) => {
    const data = ctx.callbackQuery?.data;
    const match = /^viptrade_(scalp|intraday)_(buy|sell)$/i.exec(String(data || ''));
    if (!match) return next();

    const type = match[1].toLowerCase();
    const direction = match[2].toUpperCase();
    try { await ctx.answerCbQuery(); } catch (_) {}

    try {
      const text = await buildCheck(ctx, type, direction);
      return ctx.reply(text);
    } catch (error) {
      console.log('GOLD TRADE CHECK V2 ERROR:', error.message);
      const en = findUser(ctx.from?.id)?.language === 'en';
      return ctx.reply(en
        ? '⚠️ Gold trade check could not build safe execution levels right now. Please try again shortly.'
        : '⚠️ تعذر تكوين مستويات تنفيذ آمنة لصفقة الذهب حاليًا. حاول مرة أخرى بعد قليل.');
    }
  };
};
