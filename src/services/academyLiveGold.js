const { analyzePair } = require('./analysisService');
const { getPrice } = require('./marketService');

const conceptHints = {
  basics: 'ركز على اتجاه H1 وM15 وهل الفريمين متوافقان أم مختلفان.',
  price: 'استخدم الاتجاه والزخم كسياق، ثم انتظر Price Action واضح عند مستوى مهم قبل أي قرار.',
  smc: 'اعتبر الاتجاه الحالي سياقًا وابحث على الشارت عن Sweep للسيولة ثم BOS/CHoCH قبل الدخول.',
  ict: 'راقب السيولة وPremium/Discount وFVG، ولا تعتبر أي مفهوم منفرد إشارة دخول.',
  classic: 'اربط اتجاه H1 بمستويات الدعم والمقاومة والقنوات، وانتظر كسرًا أو ارتدادًا مؤكدًا.',
  fib: 'ارسم Fibonacci على آخر موجة واضحة في اتجاه H1 وابحث عن توافق 50%-61.8% مع منطقة فنية.',
  fundamental: 'القراءة الفنية الحالية لا تلغي مخاطر الأخبار؛ راجع الأخبار الأمريكية عالية التأثير قبل التداول.',
  gold: 'ابدأ بـH1 للسياق ثم M15 للتأكيد، ولا تدخل إذا كان الفريمان متعارضين بدون إشارة قوية.'
};

function direction(a) {
  return a?.technicalDirection || a?.signal?.action || 'WAIT';
}

function num(v, digits = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : 'N/A';
}

async function buildAcademyGoldExample(schoolKey) {
  const [price, h1, m15] = await Promise.all([
    getPrice('XAUUSD'),
    analyzePair('XAUUSD', '1h'),
    analyzePair('XAUUSD', '15min')
  ]);
  const hi = h1?.indicators || {};
  const mi = m15?.indicators || {};
  const h1Dir = direction(h1);
  const m15Dir = direction(m15);
  const aligned = h1Dir !== 'WAIT' && h1Dir === m15Dir;
  return `🥇 تطبيق حي على الذهب — XAUUSD\n━━━━━━━━━━━━━━━━━━\n💵 السعر اللحظي: ${num(price, 2)}\n\n🕐 H1: ${h1Dir}\n• RSI: ${num(hi.rsi)} | ADX: ${num(hi.adx)}\n\n🕒 M15: ${m15Dir}\n• RSI: ${num(mi.rsi)} | ADX: ${num(mi.adx)}\n\n${aligned ? `✅ الفريمات متوافقة حاليًا على ${h1Dir}.` : '⚠️ لا يوجد توافق واضح بين H1 وM15 حاليًا.'}\n\n🎓 تطبيق الدرس:\n${conceptHints[schoolKey] || conceptHints.gold}\n\n⚠️ ده مثال تعليمي لحظي وليس توصية دخول.`;
}

module.exports = { buildAcademyGoldExample };
