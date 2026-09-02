const { tByLang } = require('../utils/i18n');

const {
  addCopilotTrade,
  getUserActiveCopilotTrade,
  hasUsedCopilotTrial,
  updateCopilotHealth,
  stopUserCopilotTrades
} = require('../database/copilotTrades');

const {
  evaluateCopilotTrade,
  buildCopilotMessage
} = require('../services/tradeCopilot');
const config = require('../config');
const { findUser } = require('../database/users');
const {
  mainKeyboard,
  marketKeyboard,
  alertsKeyboard,
  accountKeyboard,
  moreKeyboard,
  settingsKeyboard,
  vipKeyboard
} = require('../keyboards/main');
const { adminV21Keyboard } = require('../keyboards/adminV21');
const { plans, createVipRequest } = require('../services/vipService');
const { analyzePair } = require('../services/analysisService');
const { getCandles } = require('../services/marketService');
const { calculateTradeLevels } = require('../services/tradeEngine');
const { scanMarkets } = require('../services/smartScanner');
const { Markup } = require('telegraf');
const {
  dailyUsageMiddleware
} = require('../services/dailyUsageGate');

const { runSignalLab } = require('../services/signalLab');
const {
  getBestTrade,
  getLastRejectedCandidates
} = require('../services/bestTrade');

const PAIRS = [
  'XAUUSD',
  'BTCUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'CHFJPY'
];

const ASSET_ROWS = [
  ['🥇 XAUUSD', '₿ BTCUSD'],
  ['🇪🇺 EURUSD', '🇬🇧 GBPUSD'],
  ['🇯🇵 USDJPY', '🇪🇺 EURJPY'],
  ['🇬🇧 GBPJPY', '🇨🇭 CHFJPY']
];

const ASSET_MAP = {
  '🥇 XAUUSD': 'XAUUSD',
  '₿ BTCUSD': 'BTCUSD',
  '🇪🇺 EURUSD': 'EURUSD',
  '🇬🇧 GBPUSD': 'GBPUSD',
  '🇯🇵 USDJPY': 'USDJPY',
  '🇪🇺 EURJPY': 'EURJPY',
  '🇬🇧 GBPJPY': 'GBPJPY',
  '🇨🇭 CHFJPY': 'CHFJPY'
};

function languageOf(ctx) {
  const user = findUser(ctx.from.id);
  return user && user.language === 'en' ? 'en' : 'ar';
}

function isEnglish(ctx) {
  return languageOf(ctx) === 'en';
}

function keyboard(ctx) {
  const adminIds = (config.adminIds || []).map(String);

  const isAdmin = adminIds.includes(
    String(ctx.from?.id)
  );

  const user = findUser(ctx.from?.id);

  const isVip =
    Boolean(user && user.is_vip);

  return mainKeyboard(
    languageOf(ctx),
    isAdmin,
    isVip
  );
}



function vipOfferText(ctx) {
  if (isEnglish(ctx)) {
    return `💎 FOREX AI — VIP
━━━━━━━━━━━━━━━━━━

Not just signals...
Let the bot help you analyze your trading decision.

🥇 Check Your Trade
⚡ Real-time signals
💰 Entry + SL + TP1 + TP2
🏆 Best Opportunity
🔎 Full Smart Scanner
🔔 Personalized Alerts
🤖 Opportunity Strength Rating
📊 Automatic TP / SL Monitoring

━━━━━━━━━━━━━━━━━━

🔥 MOST POPULAR

💎 1 Month
$29.99

💎 3 Months
$74.99
Save $15

💎 1 Year
$249.99
Save $110

👇 Choose your subscription plan`;
  }

  return `💎 FOREX AI — VIP
━━━━━━━━━━━━━━━━━━

مش مجرد إشارات...
خلي البوت يساعدك في تحليل قرارك.

🥇 اختبر صفقتك
⚡ إشارات لحظية
💰 Entry + SL + TP1 + TP2
🏆 أفضل فرصة
🔎 Smart Scanner كامل
🔔 تنبيهات شخصية
🤖 تقييم قوة الفرص
📊 متابعة TP / SL تلقائيًا

━━━━━━━━━━━━━━━━━━

🔥 الأكثر اختيارًا

💎 شهر
$29.99

💎 3 شهور
$74.99
وفر $15

💎 سنة
$249.99
وفر $110

👇 اختر خطة الاشتراك`;
}

function vipTradeAllowed(ctx) {
  const user =
    findUser(ctx.from?.id);

  const adminIds =
    (config.adminIds || [])
      .map(String);

  const isAdmin =
    adminIds.includes(
      String(ctx.from?.id)
    );

  return Boolean(
    isAdmin ||
    (user && user.is_vip)
  );
}

function vipTradeTypeKeyboard(ctx) {
  const en = isEnglish(ctx);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        en ? '⚡ Scalping' : '⚡ سكالب',
        'viptrade_type_scalp'
      ),
      Markup.button.callback(
        en ? '📈 Intraday' : '📈 إنتراداي',
        'viptrade_type_intraday'
      )
    ],
    [
      Markup.button.callback(
        en ? '❌ Cancel' : '❌ إلغاء',
        'viptrade_cancel'
      )
    ]
  ]);
}

function vipTradeDirectionKeyboard(ctx, type) {
  const en = isEnglish(ctx);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '📈 BUY',
        `viptrade_${type}_buy`
      ),
      Markup.button.callback(
        '📉 SELL',
        `viptrade_${type}_sell`
      )
    ],
    [
      Markup.button.callback(
        en ? '⬅️ Change type' : '⬅️ تغيير النوع',
        'viptrade_home'
      )
    ]
  ]);
}

function directionalMarketScore(
  analysis,
  selectedDirection
) {
  const indicators =
    analysis?.indicators || {};

  const ema20 =
    Number(indicators.ema20);

  const ema50 =
    Number(indicators.ema50);

  const rsi =
    Number(indicators.rsi);

  const adx =
    Number(indicators.adx);

  const macd =
    Number(indicators.macd?.macd);

  const macdSignal =
    Number(indicators.macd?.signal);

  const marketDirection =
    analysis?.signal?.action === 'BUY' ||
    analysis?.signal?.action === 'SELL'
      ? analysis.signal.action
      : (
          Number.isFinite(ema20) &&
          Number.isFinite(ema50)
            ? (
                ema20 >= ema50
                  ? 'BUY'
                  : 'SELL'
              )
            : 'WAIT'
        );

  let score = 0;

  if (
    selectedDirection ===
    marketDirection
  ) {
    score += 35;
  }

  if (
    Number.isFinite(ema20) &&
    Number.isFinite(ema50)
  ) {
    if (
      selectedDirection === 'BUY' &&
      ema20 > ema50
    ) score += 20;

    if (
      selectedDirection === 'SELL' &&
      ema20 < ema50
    ) score += 20;
  }

  if (Number.isFinite(rsi)) {
    if (
      selectedDirection === 'BUY' &&
      rsi >= 50 &&
      rsi <= 70
    ) score += 15;

    if (
      selectedDirection === 'SELL' &&
      rsi <= 50 &&
      rsi >= 30
    ) score += 15;
  }

  if (
    Number.isFinite(macd) &&
    Number.isFinite(macdSignal)
  ) {
    if (
      selectedDirection === 'BUY' &&
      macd > macdSignal
    ) score += 15;

    if (
      selectedDirection === 'SELL' &&
      macd < macdSignal
    ) score += 15;
  }

  if (
    Number.isFinite(adx) &&
    adx >= 25
  ) {
    score += 15;
  }

  return {
    score:
      Math.max(
        0,
        Math.min(100, score)
      ),

    marketDirection
  };
}

async function buildVipTradeCheck(
  ctx,
  type,
  direction
) {
  const en =
    isEnglish(ctx);

  const timeframe =
    type === 'scalp'
      ? '5min'
      : '15min';

  const [
    analysis,
    candles
  ] = await Promise.all([
    analyzePair('XAUUSD'),
    getCandles(
      'XAUUSD',
      timeframe
    )
  ]);

  if (
    !analysis ||
    !Array.isArray(candles) ||
    candles.length < 20
  ) {
    throw new Error(
      'Insufficient market data'
    );
  }

  const levels =
    calculateTradeLevels(
      candles,
      direction,
      'XAUUSD'
    );

  if (!levels) {
    throw new Error(
      'Unable to calculate trade levels'
    );
  }

  const {
    score,
    marketDirection
  } =
    directionalMarketScore(
      analysis,
      direction
    );

  const confidence =
    Number(
      analysis?.signal?.confidence || 0
    );

  // Historical Gold validation — Signal Lab.
  const labResult = await runSignalLab(
    'XAUUSD',
    analysis.indicators,
    direction,
    { timeframe }
  );

  const sameDirection =
    marketDirection === direction;

  const entry =
    Number(levels.entry);

  const sl =
    Number(
      levels.sl ??
      levels.stopLoss
    );

  const tp1 =
    Number(
      levels.tp1 ??
      levels.target1
    );

  const tp2 =
    Number(
      levels.tp2 ??
      levels.target2
    );

  const risk =
    Number.isFinite(entry) &&
    Number.isFinite(sl)
      ? Math.abs(entry - sl)
      : 0;

  const rr1 =
    risk > 0 &&
    Number.isFinite(tp1)
      ? Math.abs(tp1 - entry) / risk
      : null;

  const rr2 =
    risk > 0 &&
    Number.isFinite(tp2)
      ? Math.abs(tp2 - entry) / risk
      : null;

  const fmt = value =>
    Number.isFinite(Number(value))
      ? Number(value).toFixed(2)
      : '—';

  let alignmentText;

  if (!sameDirection) {
    alignmentText = en
      ? '🔴 Your trade is AGAINST the current market direction\n⚠️ Risk is currently higher.'
      : '🔴 اختيارك عكس اتجاه السوق الحالي\n⚠️ المخاطرة حاليًا أعلى.';
  }

  else if (score >= 80 && confidence >= 70) {
    alignmentText = en
      ? '🔥 Strong confirmation\n✅ Your direction matches the market with strong technical + AI confirmation.'
      : '🔥 تأكيد قوي\n✅ اختيارك مع اتجاه السوق ويوجد تأكيد فني وAI قوي.';
  }

  else if (score >= 70 && confidence >= 50) {
    alignmentText = en
      ? '🟢 Good confirmation\n✅ Your direction matches the market, but confirmation is not at the strongest level.'
      : '🟢 تأكيد جيد\n✅ اختيارك مع اتجاه السوق، لكن التأكيد ليس في أقوى مستوياته.';
  }

  else if (score >= 60) {
    alignmentText = en
      ? '🟡 Direction matches the market, but confirmation is still moderate.\n⏳ Waiting for stronger confirmation may be better.'
      : '🟡 الاتجاه متوافق مع السوق، لكن التأكيد ما زال متوسطًا.\n⏳ الانتظار لتأكيد أقوى قد يكون أفضل.';
  }

  else {
    alignmentText = en
      ? '🟠 Direction matches the market, but current confirmation is weak.\n⛔ This is not a strong entry confirmation right now.'
      : '🟠 الاتجاه متوافق مع السوق، لكن التأكيد الحالي ضعيف.\n⛔ لا يوجد تأكيد قوي للدخول حاليًا.';
  }

  const typeText =
    type === 'scalp'
      ? (
          en
            ? '⚡ Scalping'
            : '⚡ سكالب'
        )
      : (
          en
            ? '📈 Intraday'
            : '📈 إنتراداي'
        );

  const marketText =
    marketDirection === 'BUY'
      ? '📈 BUY'
      : marketDirection === 'SELL'
        ? '📉 SELL'
        : '⏳ WAIT';

  if (en) {
    return `🥇 VIP GOLD TRADE CHECK
━━━━━━━━━━━━━━━━━━

⚙️ Type: ${typeText}
🎯 Your direction: ${direction}
📊 Market direction: ${marketText}

${alignmentText}

━━━━━━━━━━━━━━━━━━
💰 Entry: ${fmt(entry)}
🛑 Stop Loss: ${fmt(sl)}
🎯 TP1: ${fmt(tp1)}
🏆 TP2: ${fmt(tp2)}

⚖️ Risk / Reward
TP1 → ${rr1 ? `1:${rr1.toFixed(2)}` : '—'}
TP2 → ${rr2 ? `1:${rr2.toFixed(2)}` : '—'}

━━━━━━━━━━━━━━━━━━
⭐ Market Score: ${score}/100
🤖 AI Confidence: ${Number.isFinite(confidence) ? confidence : 0}%

🧪 SIGNAL LAB — GOLD HISTORY
📚 Similar setups: ${labResult.similarSetups}
⭐ Historical Score: ${labResult.historicalScore}/100
🎯 TP1 historical rate: ${labResult.tp1Rate}%
🏆 TP2 historical rate: ${labResult.tp2Rate}%
🛑 SL historical rate: ${labResult.slRate}%
${labResult.approved ? '✅ LAB APPROVED' : '⚠️ LAB NOT APPROVED'}

⏱️ Analysis timeframe: ${timeframe}

⚠️ Automated market analysis, not a guarantee of profit.`;
  }

  return `🥇 اختبار صفقة الذهب — VIP
━━━━━━━━━━━━━━━━━━

⚙️ نوع الصفقة: ${typeText}
🎯 اختيارك: ${direction}
📊 اتجاه السوق: ${marketText}

${alignmentText}

━━━━━━━━━━━━━━━━━━
💰 الدخول: ${fmt(entry)}
🛑 وقف الخسارة: ${fmt(sl)}
🎯 الهدف الأول TP1: ${fmt(tp1)}
🏆 الهدف الثاني TP2: ${fmt(tp2)}

⚖️ العائد للمخاطرة
TP1 → ${rr1 ? `1:${rr1.toFixed(2)}` : '—'}
TP2 → ${rr2 ? `1:${rr2.toFixed(2)}` : '—'}

━━━━━━━━━━━━━━━━━━
⭐ قوة الصفقة: ${score}/100
🤖 ثقة AI: ${Number.isFinite(confidence) ? confidence : 0}%

🧪 SIGNAL LAB — تاريخ الذهب
📚 الحالات التاريخية المشابهة: ${labResult.similarSetups}
⭐ التقييم التاريخي: ${labResult.historicalScore}/100
🎯 وصول TP1 تاريخيًا: ${labResult.tp1Rate}%
🏆 وصول TP2 تاريخيًا: ${labResult.tp2Rate}%
🛑 وصول SL تاريخيًا: ${labResult.slRate}%
${labResult.approved ? '✅ معتمد من Signal Lab' : '⚠️ غير معتمد من Signal Lab'}

⏱️ فريم التحليل: ${timeframe}

⚠️ تحليل آلي لحالة السوق وليس ضمانًا للربح.`;
}

function assetKeyboard(ctx) {
  const back = isEnglish(ctx) ? '🔙 Back' : '🔙 رجوع';
  return Markup.keyboard([...ASSET_ROWS, [back]]).resize();
}

function formatPrice(value, language = 'ar') {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return language === 'en' ? 'N/A' : 'غير متاح';
  }
  return number.toFixed(5);
}

function accountText(ctx, user) {
  const en = isEnglish(ctx);
  const expiry = user.vip_expires_at || user.vip_expire;

  if (en) {
    return `👤 MY ACCOUNT

🆔 ID
${ctx.from.id}

💎 VIP
${user.is_vip ? '✅ Active' : '❌ Inactive'}

🎁 Points
${user.points || 0}

📅 VIP expiry
${expiry || 'Not subscribed'}

🔗 Referral code
${user.referral_code || '-'}`;
  }

  return `👤 حسابي

🆔 ID
${ctx.from.id}

💎 اشتراك VIP
${user.is_vip ? '✅ مفعل' : '❌ غير مفعل'}

🎁 النقاط
${user.points || 0}

📅 انتهاء الاشتراك
${expiry || 'غير مشترك'}

🔗 كود الإحالة
${user.referral_code || '-'}`;
}

function scannerResultText(ctx, results) {
  const en = isEnglish(ctx);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  const rows = results.slice(0, 5).map((item, index) => {
    const directionEmoji =
      item.action === 'BUY' ? '🟢' :
      item.action === 'SELL' ? '🔴' : '🟡';

    return `${medals[index]} ${item.pair}  ${directionEmoji} ${item.action}
⭐ ${en ? 'Score' : 'التقييم'}: ${item.score}/100`;
  });

  if (en) {
    return `🔎 SMART MARKET SCANNER
━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}

━━━━━━━━━━━━━━━━━━
📊 ${results.length} market opportunities ranked
⏱️ Updated: now

⚠️ Market analysis is informational and does not guarantee profit.`;
  }

  return `🔎 الماسح الذكي للسوق
━━━━━━━━━━━━━━━━━━

${rows.join('\n\n')}

━━━━━━━━━━━━━━━━━━
📊 تم ترتيب ${results.length} فرص حسب القوة
⏱️ آخر تحديث: الآن

⚠️ التحليل يعكس حالة السوق الحالية ولا يضمن الربح.`;
}

function trendPowerText(adx, en) {
  if (adx >= 35) return en ? '⭐⭐⭐⭐⭐ Very strong' : '⭐⭐⭐⭐⭐ قوي جدًا';
  if (adx >= 25) return en ? '⭐⭐⭐⭐☆ Strong' : '⭐⭐⭐⭐☆ قوي';
  if (adx >= 20) return en ? '⭐⭐⭐☆☆ Moderate' : '⭐⭐⭐☆☆ متوسط';
  return en ? '⭐⭐☆☆☆ Weak' : '⭐⭐☆☆☆ ضعيف';
}

function marketAnalysisText(ctx, pair, result) {
  const en = isEnglish(ctx);
  const indicators = result.indicators;
  const bullish = Number(indicators.ema20) > Number(indicators.ema50);
  const macdBullish =
    Number(indicators.macd?.macd) > Number(indicators.macd?.signal);
  const adx = Number(indicators.adx);
  const rsi = Number(indicators.rsi);
  const price = Number(indicators.lastPrice);

  const trendScore = bullish ? 9 : 4;
  const momentumScore = rsi > 55 && rsi < 70 ? 8 : 6;
  const buyersScore = macdBullish ? 9 : 4;
  const liquidityScore = adx > 25 ? 8 : 6;
  const finalScore = Math.round(
    ((trendScore + momentumScore + buyersScore + liquidityScore) / 4) * 10
  );

  // AI output may come from an external model in its own language.
  // Keep it as-is when present; otherwise use our localized fallback.
  const aiComment = result.signal?.analysis || (
    en
      ? `Technical indicators currently suggest ${bullish ? 'buyer' : 'seller'} control on ${pair}.`
      : `تشير المؤشرات الفنية حاليًا إلى سيطرة ${bullish ? 'المشترين' : 'البائعين'} على حركة ${pair}.`
  );

  if (en) {
    return `📊 MARKET ANALYSIS

💱 Asset: ${pair}
💰 Current price: ${formatPrice(price, 'en')}

━━━━━━━━━━━━━━━━━━
📈 Main trend: ${bullish ? '🟢 Bullish' : '🔴 Bearish'}
📊 Trend strength: ${trendPowerText(adx, true)}

━━━━━━━━━━━━━━━━━━
📉 INDICATORS

EMA20: ${bullish ? '🟢 Above EMA50' : '🔴 Below EMA50'}
RSI: ${Number.isFinite(rsi) ? rsi.toFixed(1) : 'N/A'} ${rsi >= 50 ? '🟢 Positive momentum' : '🔴 Negative momentum'}
MACD: ${macdBullish ? '🟢 Bullish crossover' : '🔴 Bearish crossover'}
ADX: ${Number.isFinite(adx) ? adx.toFixed(1) : 'N/A'} ${adx >= 25 ? '🟢 Strong trend' : '🟡 Weak trend'}

━━━━━━━━━━━━━━━━━━
📍 KEY LEVELS

🟢 Support: ${indicators.support ?? 'N/A'}
🔴 Resistance: ${indicators.resistance ?? 'N/A'}

━━━━━━━━━━━━━━━━━━
🤖 AI ANALYSIS

${aiComment}

━━━━━━━━━━━━━━━━━━
📌 MARKET SCORE

Trend: ${trendScore}/10
Momentum: ${momentumScore}/10
Liquidity: ${liquidityScore}/10
Buyer strength: ${buyersScore}/10

⭐ Final score: ${finalScore >= 70 ? '🟢' : '🟡'} ${finalScore}/100

⚠️ This report describes current market conditions and is not a direct entry signal.`;
  }

  return `📊 تحليل السوق

💱 الأصل: ${pair}
💰 السعر الحالي: ${formatPrice(price, 'ar')}

━━━━━━━━━━━━━━━━━━
📈 الاتجاه العام: ${bullish ? '🟢 صاعد' : '🔴 هابط'}
📊 قوة الاتجاه: ${trendPowerText(adx, false)}

━━━━━━━━━━━━━━━━━━
📉 قراءة المؤشرات

EMA20: ${bullish ? '🟢 أعلى من EMA50' : '🔴 أقل من EMA50'}
RSI: ${Number.isFinite(rsi) ? rsi.toFixed(1) : 'غير متاح'} ${rsi >= 50 ? '🟢 زخم إيجابي' : '🔴 زخم سلبي'}
MACD: ${macdBullish ? '🟢 تقاطع شرائي' : '🔴 تقاطع بيعي'}
ADX: ${Number.isFinite(adx) ? adx.toFixed(1) : 'غير متاح'} ${adx >= 25 ? '🟢 ترند قوي' : '🟡 ترند ضعيف'}

━━━━━━━━━━━━━━━━━━
📍 أهم المستويات

🟢 الدعم: ${indicators.support ?? 'غير متاح'}
🔴 المقاومة: ${indicators.resistance ?? 'غير متاح'}

━━━━━━━━━━━━━━━━━━
🤖 تحليل الذكاء الاصطناعي

${aiComment}

━━━━━━━━━━━━━━━━━━
📌 تقييم السوق

الاتجاه: ${trendScore}/10
الزخم: ${momentumScore}/10
السيولة: ${liquidityScore}/10
قوة المشترين: ${buyersScore}/10

⭐ التقييم النهائي: ${finalScore >= 70 ? '🟢' : '🟡'} ${finalScore}/100

⚠️ التقرير يوضح حالة السوق الحالية وليس إشارة دخول مباشرة.`;
}

function tradeText(ctx, trade) {
  const en = isEnglish(ctx);
  const indicators = trade.indicators || {};
  const entry = Number(trade.entry);
  const tp1 = Number(trade.tp1);
  const tp2 = Number(trade.tp2);
  const sl = Number(trade.sl);
  const rrTp1 = Number(trade.rrTp1) || 1;
  const rrTp2 = Number(trade.rrTp2) || 2;
const action =
  trade.action === 'BUY'
    ? '🟢 BUY'
    : '🔴 SELL';

const strength =
  trade.finalScore >= 85
    ? (en ? '🔥 Very strong' : '🔥 قوية جدًا')
    : trade.finalScore >= 75
      ? (en ? '💪 Strong' : '💪 قوية')
      : trade.finalScore >= 65
        ? (en ? '🟡 Moderate' : '🟡 متوسطة')
        : (en ? '⚪ Weak' : '⚪ ضعيفة');
  const lang = en ? 'en' : 'ar';

  if (en) {
    return `⚡ TRADE NOW

🎯 ${trade.pair}  ${action}

━━━━━━━━━━━━━━━━━━
📊 QUALITY

⭐ Smart Score: ${trade.smartScore}/100
📐 Technical Score: ${trade.technicalScore ?? 'N/A'}/100
🏆 Final Score: ${trade.finalScore}/100
🤖 AI Confidence: ${trade.confidence}%
🧪 Historical Score: ${trade.historicalScore}/100
📚 Similar Setups: ${trade.similarSetups}

🎯 TP1 Success: ${trade.tp1Rate}%
🏆 TP2 Success: ${trade.tp2Rate}%
🛑 SL Rate: ${trade.slRate}%

━━━━━━━━━━━━━━━━━━
💰 Entry: ${formatPrice(entry, lang)}
🎯 TP1: ${formatPrice(tp1, lang)}
🏆 TP2: ${formatPrice(tp2, lang)}
🛑 Stop Loss: ${formatPrice(sl, lang)}
⚖️ R:R → TP1: 1:${rrTp1} | TP2: 1:${rrTp2}

━━━━━━━━━━━━━━━━━━
🔥 Trade strength: ${strength}
📊 RSI: ${Number.isFinite(Number(indicators.rsi)) ? Number(indicators.rsi).toFixed(1) : 'N/A'}
💪 ADX: ${Number.isFinite(Number(indicators.adx)) ? Number(indicators.adx).toFixed(1) : 'N/A'}

⚠️ Scores are analytical metrics, not a guarantee of profit.`;
  }

  return `⚡ صفقة الآن

🎯 ${trade.pair}  ${action}

━━━━━━━━━━━━━━━━━━
📊 جودة الفرصة

⭐ Smart Score: ${trade.smartScore}/100
📐 Technical Score: ${trade.technicalScore ?? 'N/A'}/100
🏆 Final Score: ${trade.finalScore}/100
🤖 AI Confidence: ${trade.confidence}%
🧪 Historical Score: ${trade.historicalScore}/100
📚 الحالات المشابهة: ${trade.similarSetups}

🎯 نجاح TP1: ${trade.tp1Rate}%
🏆 نجاح TP2: ${trade.tp2Rate}%
🛑 معدل SL: ${trade.slRate}%

━━━━━━━━━━━━━━━━━━
💰 الدخول: ${formatPrice(entry, lang)}
🎯 TP1: ${formatPrice(tp1, lang)}
🏆 TP2: ${formatPrice(tp2, lang)}
🛑 وقف الخسارة: ${formatPrice(sl, lang)}
⚖️ العائد للمخاطرة → TP1: 1:${rrTp1} | TP2: 1:${rrTp2}

━━━━━━━━━━━━━━━━━━
🔥 قوة الصفقة: ${strength}
📊 RSI: ${Number.isFinite(Number(indicators.rsi)) ? Number(indicators.rsi).toFixed(1) : 'غير متاح'}
💪 ADX: ${Number.isFinite(Number(indicators.adx)) ? Number(indicators.adx).toFixed(1) : 'غير متاح'}

⚠️ التقييمات مؤشرات تحليلية وليست ضمانًا للربح.`;
}


function scalpStatusTextV2(status, en) {
  const map = {
    ENTRY_READY: en ? '✅ Entry ready now' : '✅ دخول مناسب الآن',
    WAIT_PULLBACK: en ? '🟡 Wait for pullback' : '🟡 انتظار Pullback',
    WAIT: en ? '🟡 Waiting for 5M confirmation' : '🟡 انتظار تأكيد 5M',
    REJECT: en ? '❌ Entry rejected' : '❌ نقطة الدخول مرفوضة',
    NOT_CHECKED: en ? '⚪ 5M not checked' : '⚪ لم يتم فحص 5M',
    ERROR: en ? '⚠️ 5M unavailable' : '⚠️ تعذر فحص 5M'
  };
  return map[String(status || 'NOT_CHECKED')] || String(status || 'NOT_CHECKED');
}

function bestOpportunityTextV2(ctx, item) {
  const en = isEnglish(ctx);
  const scalp = item.scalpEntry || {};
  const action = item.action === 'BUY' ? '🟢 BUY' : item.action === 'SELL' ? '🔴 SELL' : '⚪ WAIT';
  const confidence = Number.isFinite(Number(item.confidence)) ? `${Number(item.confidence)}%` : (en ? 'Unavailable' : 'غير متاح');
  const status = scalpStatusTextV2(scalp.status, en);

  return en
    ? `🏆 BEST OPPORTUNITY NOW

🎯 ${item.pair}  ${action}

━━━━━━━━━━━━━━━━━━
⭐ Smart Score: ${item.score}/100
🤖 AI Confidence: ${confidence}
📊 15M Direction: ${item.action}
⏱️ 5M Entry: ${status}

📌 ${scalp.status === 'ENTRY_READY'
      ? 'Technically ready. Use “⚡ Trade Now” for strict execution approval and exact levels.'
      : 'Strongest current opportunity, but NOT an immediate-entry signal.'}`
    : `🏆 أفضل فرصة حاليًا

🎯 ${item.pair}  ${action}

━━━━━━━━━━━━━━━━━━
⭐ Smart Score: ${item.score}/100
🤖 ثقة AI: ${confidence}
📊 اتجاه 15M: ${item.action}
⏱️ دخول 5M: ${status}

📌 ${scalp.status === 'ENTRY_READY'
      ? 'الفرصة جاهزة فنيًا. استخدم «⚡ صفقة الآن» لاعتماد التنفيذ وإظهار المستويات.'
      : 'دي أقوى فرصة موجودة حاليًا، لكنها ليست إشارة دخول فوري.'}`;
}

function noTradeTextV2(ctx, rejected) {
  const en = isEnglish(ctx);
  const reason = (item) => {
    if (item.reason === 'AI_MISSING') return en ? '❌ AI confirmation unavailable' : '❌ تأكيد AI غير متاح';
    if (item.reason === 'AI_MISMATCH') return en ? '❌ AI direction mismatch' : '❌ اتجاه AI مختلف عن الماسح';
    if (item.reason === 'SCALP_NOT_READY') return en
      ? `🟡 5M not ready — ${item.scalpStatus || 'NOT_READY'}`
      : `🟡 دخول 5M غير جاهز — ${item.scalpStatus || 'NOT_READY'}`;
    return en
      ? `❌ AI confidence ${item.aiConfidence}% — minimum 60%`
      : `❌ ثقة AI ${item.aiConfidence}% — الحد الأدنى 60%`;
  };

  const near = Array.isArray(rejected) && rejected.length
    ? rejected.slice(0, 3).map((item, index) =>
        `${['🥇','🥈','🥉'][index] || '•'} ${item.pair} — ${item.action}
⭐ Smart Score: ${item.smartScore}/100
${reason(item)}`
      ).join('\n\n')
    : '';

  return en
    ? `🔍 No immediate-entry trade is available right now.

The strict execution filters rejected the current setups.
${near ? `\nClosest opportunities:\n\n${near}\n` : ''}
🛡️ “Trade Now” only returns setups ready for immediate scalping entry.`
    : `🔍 لا توجد صفقة دخول فوري مناسبة حاليًا.

فلاتر التنفيذ الصارمة رفضت الفرص الحالية.
${near ? `\nأقرب الفرص:\n\n${near}\n` : ''}
🛡️ «صفقة الآن» لا تعرض إلا صفقة جاهزة للدخول الفوري في السكالبينج.`;
}

async function calculateSignalLab() {
  const results = [];

  // Signal Lab is GOLD ONLY and uses the local historical XAUUSD dataset.
  for (const pair of ['XAUUSD']) {
    try {
      const analysis = await analyzePair(pair);
      if (!analysis || !analysis.indicators) continue;

      const indicators = analysis.indicators;
      const ema20 = Number(indicators.ema20);
      const ema50 = Number(indicators.ema50);
      const rsi = Number(indicators.rsi);
      const adx = Number(indicators.adx);
      let buyScore = 0;
      let sellScore = 0;

      if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
        if (ema20 > ema50) buyScore++;
        else if (ema20 < ema50) sellScore++;
      }

      if (Number.isFinite(rsi)) {
        if (rsi > 50) buyScore++;
        else if (rsi < 50) sellScore++;
      }

      if (
        indicators.macd &&
        Number.isFinite(Number(indicators.macd.macd)) &&
        Number.isFinite(Number(indicators.macd.signal))
      ) {
        if (Number(indicators.macd.macd) > Number(indicators.macd.signal)) buyScore++;
        else if (Number(indicators.macd.macd) < Number(indicators.macd.signal)) sellScore++;
      }

      if (Number.isFinite(adx) && adx >= 20) {
        if (buyScore > sellScore) buyScore++;
        else if (sellScore > buyScore) sellScore++;
      }

      let direction = 'WAIT';
      if (buyScore > sellScore && buyScore >= 2) direction = 'BUY';
      else if (sellScore > buyScore && sellScore >= 2) direction = 'SELL';

      const smartScore = Math.round((Math.max(buyScore, sellScore) / 4) * 100);

      let lab = {
        approved: false,
        historicalScore: 0,
        similarSetups: 0,
        tp1Rate: 0,
        tp2Rate: 0,
        slRate: 0
      };

      if (direction !== 'WAIT') {
        try {
          const labResult = await runSignalLab(pair, indicators, direction);
          if (labResult) {
            lab = {
              approved: Boolean(labResult.approved),
              historicalScore: Number(labResult.historicalScore) || 0,
              similarSetups: Number(labResult.similarSetups) || 0,
              tp1Rate: Number(labResult.tp1Rate) || 0,
              tp2Rate: Number(labResult.tp2Rate) || 0,
              slRate: Number(labResult.slRate) || 0
            };
          }
        } catch (error) {
          console.log(`❌ Lab calculation ${pair}:`, error.message);
        }
      }

      results.push({
        pair,
        direction,
        smartScore,
        ...lab
      });
    } catch (error) {
      console.log(`❌ Signal Lab ${pair} error:`, error.message);
    }
  }

  return results.sort((a, b) => b.smartScore - a.smartScore);
}

function signalLabText(ctx, results) {
  const en = isEnglish(ctx);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  const messages = results.slice(0, 5).map((item, index) => {
    const direction =
      item.direction === 'BUY' ? '🟢 BUY' :
      item.direction === 'SELL' ? '🔴 SELL' : '⚪ WAIT';

    const status = item.approved
      ? (en ? '✅ LAB APPROVED' : '✅ مقبول من المختبر')
      : (en ? '⚠️ LAB NOT APPROVED' : '⚠️ غير معتمد من المختبر');

    return `${medals[index]} ${item.pair}  ${direction}
⭐ Smart Score: ${item.smartScore}/100
🧪 Historical Score: ${item.historicalScore}/100
📚 ${en ? 'Similar Setups' : 'الحالات المشابهة'}: ${item.similarSetups}
🎯 TP1: ${item.tp1Rate}%
🏆 TP2: ${item.tp2Rate}%
🛑 SL: ${item.slRate}%
${status}`;
  });

  return en
    ? `🧪 AI SIGNAL LAB

${messages.join('\n━━━━━━━━━━━━━━━━━━\n\n')}

━━━━━━━━━━━━━━━━━━
📌 Historical similarity is an analytical reference, not a promise of future results.`
    : `🧪 مختبر إشارات الذكاء الاصطناعي

${messages.join('\n━━━━━━━━━━━━━━━━━━\n\n')}

━━━━━━━━━━━━━━━━━━
📌 التشابه مع الحالات التاريخية مرجع تحليلي وليس ضمانًا للنتائج المستقبلية.`;
}


// =====================================================
// TRADE COPILOT STATE
// =====================================================

const copilotDrafts = new Map();

const copilotRefreshCooldowns = new Map();
const copilotRefreshRunning = new Set();

const COPILOT_REFRESH_COOLDOWN_MS =
  Number(process.env.COPILOT_REFRESH_COOLDOWN_MS) ||
  45 * 1000;

function copilotRefreshAllowed(userId) {
  const key = String(userId);
  const last = copilotRefreshCooldowns.get(key) || 0;
  const remaining =
    COPILOT_REFRESH_COOLDOWN_MS -
    (Date.now() - last);

  return {
    allowed: remaining <= 0,
    remainingMs: Math.max(0, remaining)
  };
}



function copilotAccess(ctx) {
  const user = findUser(ctx.from?.id);

  const isVip =
    Boolean(user && Number(user.is_vip) === 1);

  const usedTrial =
    hasUsedCopilotTrial(ctx.from?.id);

  return {
    isVip,
    usedTrial,
    allowed:
      isVip || !usedTrial,
    isTrial:
      !isVip && !usedTrial
  };
}



function copilotDirectionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '📈 BUY',
        'copilot_buy'
      ),
      Markup.button.callback(
        '📉 SELL',
        'copilot_sell'
      )
    ],
    [
      Markup.button.callback(
        '❌ إلغاء',
        'copilot_cancel'
      )
    ]
  ]);
}

function copilotControlKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        '🔄 تحديث الآن',
        'copilot_check_now'
      )
    ],
    [
      Markup.button.callback(
        '🛑 إيقاف المتابعة',
        'copilot_stop'
      )
    ]
  ]);
}


function registerUserCommands(bot) {
  // Free/VIP daily feature gate
  bot.use(dailyUsageMiddleware());


  // MENU_UX_V3_HANDLERS
  bot.hears(['📊 السوق', '📊 Markets'], (ctx) => {
    const lang = isEnglish(ctx) ? 'en' : 'ar';
    const locale = tByLang(lang);
    return ctx.reply(locale.marketMenuTitle, marketKeyboard(lang));
  });

  bot.hears(['🔔 مركز التنبيهات', '🔔 Alerts Center'], (ctx) => {
    const lang = isEnglish(ctx) ? 'en' : 'ar';
    const locale = tByLang(lang);
    return ctx.reply(locale.alertsMenuTitle, alertsKeyboard(lang));
  });

  bot.hears(['👤 الحساب', '👤 Account'], (ctx) => {
    const lang = isEnglish(ctx) ? 'en' : 'ar';
    const locale = tByLang(lang);
    return ctx.reply(locale.accountMenuTitle, accountKeyboard(lang));
  });

  bot.hears(['⚙️ المزيد', '⚙️ More'], (ctx) => {
    const lang = isEnglish(ctx) ? 'en' : 'ar';
    const locale = tByLang(lang);
    return ctx.reply(locale.moreMenuTitle, moreKeyboard(lang));
  });

  bot.hears(['🔙 رجوع', '🔙 Back'], (ctx) => {
    const lang = isEnglish(ctx) ? 'en' : 'ar';
    return ctx.reply(
      isEnglish(ctx) ? '📋 Main menu' : '📋 القائمة الرئيسية',
      mainKeyboard(lang)
    );
  });

  bot.command('status', (ctx) => {
    const user = findUser(ctx.from.id);
    if (!user) {
      return ctx.reply(isEnglish(ctx) ? 'Send /start first.' : 'اكتب /start أولاً');
    }
    return ctx.reply(accountText(ctx, user), keyboard(ctx));
  });

  bot.command('menu', (ctx) =>
    ctx.reply(
      isEnglish(ctx) ? '📋 Main menu:' : '📋 القائمة الرئيسية:',
      keyboard(ctx)
    )
  );

  bot.command('vip', (ctx) => {
    return ctx.reply(
      vipOfferText(ctx),
      vipKeyboard()
    );
  });
  bot.command('ref', (ctx) => {
    const user = findUser(ctx.from.id);
    if (!user) {
      return ctx.reply(isEnglish(ctx) ? 'Send /start first.' : 'اكتب /start أولاً');
    }
    const link = `https://t.me/${config.botUsername}?start=${user.referral_code}`;

    return ctx.reply(
      isEnglish(ctx)
        ? `🔗 Your referral link:\n${link}\n\n🎁 Points: ${user.points || 0}`
        : `🔗 رابط إحالتك:\n${link}\n\n🎁 نقاطك: ${user.points || 0}`,
      keyboard(ctx)
    );
  });

  bot.hears('🔎 Smart Scanner', async (ctx) => {
    try {
      await ctx.reply(
        isEnglish(ctx)
          ? '🔎 SMART MARKET SCANNER\n\n🔍 Scanning markets...\n🧠 Ranking opportunities...\n⏳ One moment.'
          : '🔎 الماسح الذكي للسوق\n\n🔍 جاري فحص الأسواق...\n🧠 ترتيب الفرص حسب القوة...\n⏳ لحظات.'
      );

      const results = await scanMarkets();

      if (!results || results.length === 0) {
        return ctx.reply(
          isEnglish(ctx)
            ? '🔍 No suitable market opportunities found right now.\n\nThe market remains under monitoring.'
            : '🔍 لا توجد فرص مناسبة حاليًا.\n\nالسوق ما زال تحت المراقبة.',
          keyboard(ctx)
        );
      }

      return ctx.reply(scannerResultText(ctx, results), keyboard(ctx));
    } catch (error) {
      console.log('❌ Smart Scanner error:', error.message);
      return ctx.reply(
        isEnglish(ctx)
          ? '❌ Smart Scanner could not complete the scan. Please try again shortly.'
          : '❌ تعذر إكمال فحص Smart Scanner. حاول مرة أخرى بعد قليل.',
        keyboard(ctx)
      );
    }
  });

  bot.hears('📈 تحليل', async (ctx) => {
    return ctx.reply(
      isEnglish(ctx)
        ? '📊 MARKET ANALYSIS\n\nChoose the asset you want to analyze:'
        : '📊 تحليل السوق\n\nاختر الأصل الذي تريد تحليله:',
      assetKeyboard(ctx)
    );
  });

  Object.entries(ASSET_MAP).forEach(([button, pair]) => {
    bot.hears(button, async (ctx) => {
      try {
        await ctx.reply(
          isEnglish(ctx)
            ? `🔎 Analyzing ${pair}...\n\n🧠 Reading trend, momentum and key levels.\n⏳ One moment.`
            : `🔎 جاري تحليل ${pair}...\n\n🧠 قراءة الاتجاه والزخم والمستويات المهمة.\n⏳ لحظات.`
        );

        const result = await analyzePair(pair);

        if (!result || !result.indicators) {
          return ctx.reply(
            isEnglish(ctx)
              ? `❌ ${pair} analysis is unavailable right now. Please try again shortly.`
              : `❌ تعذر الحصول على تحليل ${pair} حاليًا. حاول مرة أخرى بعد قليل.`,
            keyboard(ctx)
          );
        }

        return ctx.reply(marketAnalysisText(ctx, pair, result), keyboard(ctx));
      } catch (error) {
        console.log(`❌ Analysis error ${pair}:`, error.message);
        return ctx.reply(
          isEnglish(ctx)
            ? `❌ An error occurred while analyzing ${pair}. Please try again shortly.`
            : `❌ حدث خطأ أثناء تحليل ${pair}. حاول مرة أخرى بعد قليل.`,
          keyboard(ctx)
        );
      }
    });
  });

  // BEST_OPPORTUNITY_V2_HANDLER
  bot.hears(['🏆 أفضل صفقة', '🏆 أفضل فرصة', '🏆 Best Trade', '🏆 Best Opportunity'], async (ctx) => {
    try {
      await ctx.reply(
        isEnglish(ctx)
          ? '🏆 Searching for the strongest current opportunity...'
          : '🏆 جاري البحث عن أقوى فرصة موجودة حاليًا...'
      );

      const rows = await scanMarkets();

      const ranked = (Array.isArray(rows) ? rows : [])
        .filter((row) => row && (row.action === 'BUY' || row.action === 'SELL'))
        .sort((a, b) => {
          const aReady = a.scalpEntry?.status === 'ENTRY_READY' ? 1 : 0;
          const bReady = b.scalpEntry?.status === 'ENTRY_READY' ? 1 : 0;
          if (bReady !== aReady) return bReady - aReady;

          const aiA = Number(a.confidence) || 0;
          const aiB = Number(b.confidence) || 0;
          if (aiB !== aiA) return aiB - aiA;

          return Number(b.score || 0) - Number(a.score || 0);
        });

      const bestOpportunity = ranked[0];

      if (!bestOpportunity) {
        return ctx.reply(
          isEnglish(ctx)
            ? '🔍 No clear market opportunity is available right now.'
            : '🔍 لا توجد فرصة واضحة في السوق حاليًا.',
          keyboard(ctx)
        );
      }

      return ctx.reply(
        bestOpportunityTextV2(ctx, bestOpportunity),
        keyboard(ctx)
      );
    } catch (error) {
      console.log('❌ Best Opportunity V2 error:', error.stack || error);
      return ctx.reply(
        isEnglish(ctx)
          ? '❌ Best Opportunity is temporarily unavailable.'
          : '❌ تعذر عرض أفضل فرصة حاليًا. حاول مرة أخرى بعد قليل.',
        keyboard(ctx)
      );
    }
  });

  bot.hears('⚡ صفقة الآن', async (ctx) => {
    try {
      await ctx.reply(
        isEnglish(ctx)
          ? `⚡ SEARCHING FOR A TRADE

🔍 Scanning markets
🧠 Analyzing trend and momentum
🤖 Applying AI filter
🧪 Checking historical setups
🛡️ Reviewing trade quality

⏳ One moment...`
          : `⚡ جاري البحث عن أفضل فرصة

🔍 فحص الأسواق
🧠 تحليل الاتجاه والزخم
🤖 تطبيق فلتر الذكاء الاصطناعي
🧪 مراجعة الحالات التاريخية
🛡️ تقييم جودة الصفقة

⏳ لحظات...`
      );

      const trade = await getBestTrade();

      if (!trade) {
        const rejected = getLastRejectedCandidates(3);
        return ctx.reply(
          noTradeTextV2(ctx, rejected),
          keyboard(ctx)
        );
      }

      return ctx.reply(tradeText(ctx, trade), keyboard(ctx));
    } catch (error) {
      console.log('❌ Best Trade command error:', error.message);
      return ctx.reply(
        isEnglish(ctx)
          ? '❌ An error occurred while searching for a trade. Please try again shortly.'
          : '❌ حدث خطأ أثناء البحث عن أفضل صفقة. حاول مرة أخرى بعد قليل.',
        keyboard(ctx)
      );
    }
  });

  // Single Signal Lab handler — duplicate handler removed.
  bot.hears('🧪 AI Signal Lab', async (ctx) => {
    try {
      await ctx.reply(
        isEnglish(ctx)
          ? '🧪 AI SIGNAL LAB\n\n🔬 Scanning markets and comparable historical setups...\n⏳ One moment.'
          : '🧪 مختبر إشارات الذكاء الاصطناعي\n\n🔬 جاري فحص السوق والحالات التاريخية المشابهة...\n⏳ لحظات.'
      );

      const results = await calculateSignalLab();

      if (!results.length) {
        return ctx.reply(
          isEnglish(ctx)
            ? '❌ Signal Lab results are unavailable right now. Please try again shortly.'
            : '❌ تعذر الحصول على نتائج Signal Lab حاليًا. حاول مرة أخرى بعد قليل.',
          keyboard(ctx)
        );
      }

      return ctx.reply(signalLabText(ctx, results), keyboard(ctx));
    } catch (error) {
      console.log('❌ Signal Lab command error:', error.message);
      return ctx.reply(
        isEnglish(ctx)
          ? '❌ AI Signal Lab could not complete the analysis. Please try again.'
          : '❌ حدث خطأ أثناء تشغيل AI Signal Lab. حاول مرة أخرى.',
        keyboard(ctx)
      );
    }
  });


  // =====================================================
  // VIP GOLD TRADE CHECKER
  // =====================================================

  bot.hears(
    ['🥇 اختبر صفقتك', '🥇 Check Your Trade'],
    async (ctx) => {
      if (!vipTradeAllowed(ctx)) {
        const promoText = isEnglish(ctx)
          ? `🥇 CHECK YOUR TRADE
━━━━━━━━━━━━━━━━━━

Have a trade in mind but not sure whether to enter? 🤔

Let the bot analyze your decision before entry and compare your direction with the current market.

💎 With VIP you get:

📊 Market direction alignment
⭐ Trade strength
🤖 Analysis confidence
💰 Suggested entry
🛑 Stop Loss
🎯 TP1
🏆 TP2
⚖️ Risk / Reward

━━━━━━━━━━━━━━━━━━

🔒 Check Your Trade is available to VIP members.

💎 VIP — $29.99 / month

⚠️ Automated market analysis is a decision-support tool and does not guarantee profit.`
          : `🥇 اختبر صفقتك
━━━━━━━━━━━━━━━━━━

عندك صفقة ومش متأكد تدخل ولا لأ؟ 🤔

خلّي البوت يحلل قرارك قبل الدخول ويقارن اختيارك بحالة السوق الحالية.

💎 مع VIP هتعرف:

📊 هل اختيارك مع اتجاه السوق؟
⭐ قوة الصفقة
🤖 درجة توافق التحليل
💰 سعر الدخول المقترح
🛑 وقف الخسارة
🎯 الهدف الأول TP1
🏆 الهدف الثاني TP2
⚖️ العائد مقابل المخاطرة

━━━━━━━━━━━━━━━━━━

🔒 أداة «اختبر صفقتك» متاحة لأعضاء VIP

💎 VIP — $29.99 / شهر

⚠️ التحليل آلي ومساعد لاتخاذ القرار، وليس ضمانًا للربح.`;

        return ctx.reply(
          promoText,
          vipKeyboard()
        );
      }

      return ctx.reply(
        isEnglish(ctx)
          ? '🥇 Choose your Gold trade type:'
          : '🥇 اختر نوع صفقة الذهب:',
        vipTradeTypeKeyboard(ctx)
      );
    }
  );

  bot.action(
    'viptrade_home',
    async (ctx) => {
      await ctx.answerCbQuery()
        .catch(() => null);

      if (!vipTradeAllowed(ctx)) {
        return ctx.reply(
          isEnglish(ctx)
            ? '💎 VIP membership required.'
            : '💎 يلزم اشتراك VIP.'
        );
      }

      return ctx.editMessageText(
        isEnglish(ctx)
          ? '🥇 Choose your Gold trade type:'
          : '🥇 اختر نوع صفقة الذهب:',
        vipTradeTypeKeyboard(ctx)
      ).catch(error => {
        if (
          String(
            error?.response?.description ||
            error?.message ||
            ''
          ).includes(
            'message is not modified'
          )
        ) return;

        throw error;
      });
    }
  );

  for (
    const type of
    ['scalp', 'intraday']
  ) {
    bot.action(
      `viptrade_type_${type}`,
      async (ctx) => {
        await ctx.answerCbQuery()
          .catch(() => null);

        if (!vipTradeAllowed(ctx)) {
          return ctx.reply(
            isEnglish(ctx)
              ? '💎 VIP membership required.'
              : '💎 يلزم اشتراك VIP.'
          );
        }

        return ctx.editMessageText(
          isEnglish(ctx)
            ? '📊 Choose your expected direction for XAUUSD:'
            : '📊 اختر اتجاه صفقتك على XAUUSD:',
          vipTradeDirectionKeyboard(
            ctx,
            type
          )
        );
      }
    );

    for (
      const direction of
      ['buy', 'sell']
    ) {
      bot.action(
        `viptrade_${type}_${direction}`,
        async (ctx) => {
          await ctx.answerCbQuery(
            isEnglish(ctx)
              ? 'Analyzing...'
              : 'جاري التحليل...'
          ).catch(() => null);

          if (!vipTradeAllowed(ctx)) {
            return ctx.reply(
              isEnglish(ctx)
                ? '💎 VIP membership required.'
                : '💎 يلزم اشتراك VIP.'
            );
          }

          try {
            const result =
              await buildVipTradeCheck(
                ctx,
                type,
                direction.toUpperCase()
              );

            // Send approved Signal Lab Gold trade to VIP channel.
            // buildVipTradeCheck already ran Signal Lab before returning.
            if (config.vipChannelId) {
              const approvedByLab =
                result.includes('✅ معتمد من Signal Lab') ||
                result.includes('✅ LAB APPROVED');

              if (approvedByLab) {
                try {
                  await ctx.telegram.sendMessage(
                    config.vipChannelId,
                    `⚡ صفقة ذهب من اختبر صفقتك
━━━━━━━━━━━━━━━━━━

${result}`
                  );

                  console.log(
                    `✅ VIP TRADE CHECK SENT | XAUUSD | ${direction.toUpperCase()} | ${type} | SIGNAL LAB APPROVED`
                  );
                } catch (vipError) {
                  console.log(
                    '❌ VIP TRADE CHECK SEND ERROR:',
                    vipError.message
                  );
                }
              } else {
                console.log(
                  `🧪 VIP TRADE CHECK BLOCKED | XAUUSD | ${direction.toUpperCase()} | ${type} | SIGNAL LAB NOT APPROVED`
                );
              }
            } else {
              console.log(
                '❌ VIP TRADE CHECK | VIP_CHANNEL_ID missing'
              );
            }

            return ctx.reply(
              result,
              keyboard(ctx)
            );

          } catch (error) {
            console.log(
              'VIP trade checker error:',
              error.stack ||
              error.message
            );

            return ctx.reply(
              isEnglish(ctx)
                ? '❌ Could not complete the Gold trade analysis right now.'
                : '❌ تعذر إكمال تحليل صفقة الذهب حاليًا.'
            );
          }
        }
      );
    }
  }

  bot.action(
    'viptrade_cancel',
    async (ctx) => {
      await ctx.answerCbQuery()
        .catch(() => null);

      return ctx.deleteMessage()
        .catch(() => null);
    }
  );

  bot.hears('💎 VIP', (ctx) => {
    return ctx.reply(
      vipOfferText(ctx),
      vipKeyboard()
    );
  });
  bot.hears('🔗 الإحالة', (ctx) => {
    const user = findUser(ctx.from.id);
    if (!user) {
      return ctx.reply(isEnglish(ctx) ? 'Send /start first.' : 'اكتب /start أولاً');
    }
    const link = `https://t.me/${config.botUsername}?start=${user.referral_code}`;
    return ctx.reply(
      isEnglish(ctx)
        ? `🔗 Your referral link:\n${link}\n\n🎁 Points: ${user.points || 0}`
        : `🔗 رابط إحالتك:\n${link}\n\n🎁 نقاطك: ${user.points || 0}`,
      keyboard(ctx)
    );
  });

bot.hears(['👤 حالة الحساب', '👤 حسابي', '👤 My Account'], (ctx) => {
  const user = findUser(ctx.from.id);

  if (!user) {
    return ctx.reply(
      isEnglish(ctx)
        ? '❌ Account not found. Send /start first.'
        : '❌ لم يتم العثور على حسابك. اكتب /start أولاً.'
    );
  }

  return ctx.reply(accountText(ctx, user), keyboard(ctx));
});
bot.hears(['🔔 التنبيهات', '🔔 Alerts'], (ctx) => {
  return ctx.reply(
    isEnglish(ctx)
      ? `🔔 ALERTS

Your market alerts section is ready.

Current status:
🟢 Trade opportunity alerts
🟢 Smart Scanner alerts
🟢 AI Signal alerts

More alert controls will be added soon.`
      : `🔔 التنبيهات

قسم تنبيهات السوق جاهز.

الحالة الحالية:
🟢 تنبيهات فرص التداول
🟢 تنبيهات Smart Scanner
🟢 تنبيهات إشارات AI

سيتم إضافة تحكم كامل في التنبيهات قريبًا.`,
    keyboard(ctx)
  );
});
  bot.hears(['🎧 الدعم', '🎧 Support'], (ctx) => {
    const en = isEnglish(ctx);

    return ctx.reply(
      en
        ? `🎧 FOREX AI SUPPORT

Choose how you would like to continue:`
        : `🎧 دعم FOREX AI

اختر وسيلة التواصل:`,
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            en ? '💬 Technical Support' : '💬 الدعم الفني',
            'https://t.me/Axiomiexfx_support'
          )
        ],
        [
          Markup.button.url(
            en ? '👥 Main Group' : '👥 الجروب الرئيسي',
            'https://t.me/forexaichannel'
          )
        ]
      ])
    );
  });

  // Kept for users who still have the old keyboard cached in Telegram.
  bot.hears('ℹ️ المساعدة', (ctx) =>
    ctx.reply(
      isEnglish(ctx)
        ? 'ℹ️ Help\n\n/menu Main menu\n/vip VIP\n/ref Referral\n/status Account'
        : 'ℹ️ المساعدة\n\n/menu القائمة الرئيسية\n/vip اشتراك VIP\n/ref الإحالة\n/status الحساب',
      keyboard(ctx)
    )
  );

  bot.hears('👥 الجروب الرئيسي', async (ctx) => {
    const link = process.env.MAIN_GROUP_LINK;

    if (!link) {
      return ctx.reply(
        isEnglish(ctx)
          ? '❌ Main group link is not configured right now.'
          : '❌ رابط الجروب غير مضبوط حاليًا.',
        keyboard(ctx)
      );
    }

    return ctx.reply(
      isEnglish(ctx)
        ? '👥 Main Group\n\nUse the button below to join:'
        : '👥 الجروب الرئيسي\n\nاضغط الزر للدخول إلى الجروب:',
      Markup.inlineKeyboard([
        [Markup.button.url(isEnglish(ctx) ? '🚀 Join Group' : '🚀 دخول الجروب', link)]
      ])
    );
  });

  bot.hears('🎛️ لوحة الأدمن', async (ctx) => {
    const adminIds = (config.adminIds || []).map(String);

    if (
      !adminIds.includes(
        String(ctx.from?.id)
      )
    ) {
      return;
    }

    return ctx.reply(
      '🎛️ FOREX AI — Admin Control Center V2.1',
      adminV21Keyboard()
    );
  });

  Object.entries(plans).forEach(([key, plan]) => {
    bot.action(`vip_${key}`, async (ctx) => {
      createVipRequest(ctx.from.id, key);
      await ctx.answerCbQuery();

      await ctx.reply(
        isEnglish(ctx)
          ? `💳 Payment method: USDT — TRC20\n\nAfter payment, send the payment proof here.`
          : `💳 طريقة الدفع: USDT — TRC20\n\nبعد التحويل أرسل صورة إثبات الدفع هنا.`
      );

      // Wallet address must be sent alone for easy copy.
      return ctx.reply(config.paymentInfo);
    });
  });

  bot.on(['photo', 'document'], async (ctx) => {
    console.log('📥 Payment proof received:', ctx.from.id);

    const fileId =
      ctx.message.photo?.at(-1)?.file_id ||
      ctx.message.document?.file_id;

    const caption = ctx.message.caption || '';

    createVipRequest(
      ctx.from.id,
      'manual',
      fileId,
      caption
    );

    const info = `📥 طلب اشتراك VIP جديد

👤 الاسم: ${ctx.from.first_name || ''}

🆔 ID: ${ctx.from.id}

👤 Username: @${ctx.from.username || 'لا يوجد'}

📝 ملاحظة:
${caption || 'لا يوجد'}`;

    for (const adminId of config.adminIds) {
      try {
        await ctx.telegram.sendMessage(adminId, info);
        await ctx.telegram.forwardMessage(
          adminId,
          ctx.chat.id,
          ctx.message.message_id
        );
      } catch (error) {
        console.log(`Forward to ${adminId} failed:`, error.message);
      }
    }

    return ctx.reply(
      isEnglish(ctx)
        ? '✅ Payment proof received and sent to the administration.'
        : '✅ تم استلام إثبات الدفع وإرساله للإدارة.',
      keyboard(ctx)
    );
  });


  // =====================================================
  // COPILOT FEATURE HANDLERS
  // =====================================================

  bot.hears(
    ['🤖 راقب صفقتي', '🤖 Monitor My Trade'],
    async (ctx) => {
      const existing =
        getUserActiveCopilotTrade(ctx.from.id);

      // Existing active trade can always be opened
      // so the user can check or stop it.
      if (!existing) {
        const access =
          copilotAccess(ctx);

        if (!access.allowed) {
          return ctx.reply(
`🤖 AI TRADE COPILOT — VIP
━━━━━━━━━━━━━━━━━━

خلي البوت يراقب صفقتك معاك تلقائيًا:

📊 اتجاه السوق
⚡ الزخم
📍 حالة الدخول
📈 EMA
📊 RSI
💪 ADX
🎯 VWAP
🔔 تنبيه عند تغير حالة الصفقة

━━━━━━━━━━━━━━━━━━

🎁 استخدمت تجربتك المجانية بالفعل.

🔒 المتابعة المستمرة متاحة لأعضاء VIP.

💎 VIP — $29.99 / شهر`,
            vipKeyboard()
          );
        }

        if (access.isTrial) {
          await ctx.reply(
`🎁 تجربة مجانية — Trade Copilot

دي تجربتك المجانية الوحيدة للميزة.

🤖 البوت هيراقب صفقة XAUUSD معاك
وينبهك لما حالتها الفنية تتغير.

بعد انتهاء هذه المتابعة، الميزة ستكون متاحة من خلال VIP.`
          );
        }
      }

      if (existing) {
        return ctx.reply(
          `🤖 عندك صفقة تحت المتابعة بالفعل.

🥇 XAUUSD
${existing.action === 'BUY' ? '📈' : '📉'} ${existing.action}

🎯 الدخول:
${Number(existing.entry).toFixed(2)}

📊 الحالة:
${existing.health_status || 'NEW'}`,
          copilotControlKeyboard()
        );
      }

      copilotDrafts.set(
        String(ctx.from.id),
        { step: 'direction' }
      );

      return ctx.reply(
        `🤖 AI TRADE COPILOT

🥇 XAUUSD

اختر اتجاه صفقتك:`,
        copilotDirectionKeyboard()
      );
    }
  );


  bot.action('copilot_buy', async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);

    const existing =
      getUserActiveCopilotTrade(ctx.from.id);

    if (!existing) {
      const access =
        copilotAccess(ctx);

      if (!access.allowed) {
        return ctx.reply(
          '🔒 انتهت تجربتك المجانية لـ Trade Copilot. يلزم اشتراك VIP لاستخدام الميزة مرة أخرى.',
          vipKeyboard()
        );
      }
    }

    copilotDrafts.set(
      String(ctx.from.id),
      {
        step: 'entry',
        action: 'BUY'
      }
    );

    return ctx.reply(
      `📈 BUY

🎯 ابعت سعر دخولك فقط.

مثال:
4375.50`
    );
  });


  bot.action('copilot_sell', async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);

    const existing =
      getUserActiveCopilotTrade(ctx.from.id);

    if (!existing) {
      const access =
        copilotAccess(ctx);

      if (!access.allowed) {
        return ctx.reply(
          '🔒 انتهت تجربتك المجانية لـ Trade Copilot. يلزم اشتراك VIP لاستخدام الميزة مرة أخرى.',
          vipKeyboard()
        );
      }
    }

    copilotDrafts.set(
      String(ctx.from.id),
      {
        step: 'entry',
        action: 'SELL'
      }
    );

    return ctx.reply(
      `📉 SELL

🎯 ابعت سعر دخولك فقط.

مثال:
4375.50`
    );
  });


  bot.action('copilot_cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);

    copilotDrafts.delete(
      String(ctx.from.id)
    );

    return ctx.reply(
      '❌ تم إلغاء إعداد Trade Copilot.'
    );
  });


  bot.action('copilot_stop', async (ctx) => {
    await ctx.answerCbQuery().catch(() => null);

    stopUserCopilotTrades(
      ctx.from.id
    );

    copilotDrafts.delete(
      String(ctx.from.id)
    );

    return ctx.reply(
      '🛑 تم إيقاف متابعة الصفقة.'
    );
  });


  bot.action(
    'copilot_check_now',
    async (ctx) => {
      await ctx.answerCbQuery().catch(() => null);

      const userId =
        String(ctx.from?.id || '');

      if (!userId) {
        return;
      }

      // Prevent the same user from starting
      // multiple concurrent analyses.
      if (copilotRefreshRunning.has(userId)) {
        return ctx.reply(
          '⏳ التحليل شغال بالفعل، انتظر النتيجة.'
        );
      }

      const cooldown =
        copilotRefreshAllowed(userId);

      if (!cooldown.allowed) {
        const seconds =
          Math.max(
            1,
            Math.ceil(
              cooldown.remainingMs / 1000
            )
          );

        return ctx.reply(
          `⏳ آخر تحديث ما زال حديثًا.

يمكنك طلب تحديث جديد بعد ${seconds} ثانية.

🤖 المتابعة التلقائية مستمرة في الخلفية.`
        );
      }

      const trade =
        getUserActiveCopilotTrade(
          ctx.from.id
        );

      if (!trade) {
        return ctx.reply(
          'ℹ️ لا توجد صفقة تحت المتابعة حاليًا.'
        );
      }

      copilotRefreshRunning.add(userId);

      // Start cooldown BEFORE external work,
      // so repeated taps cannot create a burst.
      copilotRefreshCooldowns.set(
        userId,
        Date.now()
      );

      try {
        const result =
          await evaluateCopilotTrade(trade);

        updateCopilotHealth(
          trade.id,
          result.healthStatus,
          result.currentPrice,
          result.score,
          [
            ...result.critical,
            ...result.warnings
          ].slice(0, 3).join(' | ')
        );

        return ctx.reply(
          buildCopilotMessage(
            trade,
            result,
            trade.health_status
          ),
          copilotControlKeyboard()
        );

      } catch (error) {
        console.log(
          '❌ Copilot manual check:',
          error.message
        );

        return ctx.reply(
          '❌ تعذر تحديث التحليل حاليًا. المتابعة التلقائية ما زالت تعمل.'
        );

      } finally {
        copilotRefreshRunning.delete(userId);
      }
    }
  );


  bot.on('text', async (ctx, next) => {

    const userId =
      String(ctx.from?.id || '');

    const draft =
      copilotDrafts.get(userId);

    if (
      !draft ||
      draft.step !== 'entry'
    ) {
      return typeof next === 'function'
        ? next()
        : undefined;
    }

    const raw =
      String(ctx.message?.text || '')
        .trim()
        .replace(',', '.');

    const entry =
      Number(raw);

    if (
      !Number.isFinite(entry) ||
      entry < 1000 ||
      entry > 10000
    ) {
      return ctx.reply(
        `❌ السعر غير صحيح.

ابعت سعر الذهب فقط.

مثال:
4375.50`
      );
    }

    const action = draft.action;

    copilotDrafts.delete(userId);

    stopUserCopilotTrades(
      ctx.from.id
    );

    addCopilotTrade({
      telegram_id: ctx.from.id,
      action,
      entry
    });

    const trade =
      getUserActiveCopilotTrade(
        ctx.from.id
      );

    if (!trade) {
      return ctx.reply(
        '❌ تعذر تشغيل متابعة الصفقة.'
      );
    }

    await ctx.reply(
      `🤖 بدأت متابعة صفقتك

🥇 XAUUSD
${action === 'BUY' ? '📈' : '📉'} ${action}

🎯 دخولك:
${entry.toFixed(2)}

🧠 جاري تحليل السوق...`
    );

    try {

      const result =
        await evaluateCopilotTrade(trade);

      updateCopilotHealth(
        trade.id,
        result.healthStatus,
        result.currentPrice,
        result.score,
        [
          ...result.critical,
          ...result.warnings
        ].slice(0, 3).join(' | ')
      );

      return ctx.reply(
        buildCopilotMessage(
          trade,
          result,
          'NEW'
        ),
        copilotControlKeyboard()
      );

    } catch (error) {

      console.log(
        '❌ Copilot initial analysis:',
        error.message
      );

      return ctx.reply(
        `✅ المتابعة مفعلة.

⚠️ تعذر أول تحليل للسوق مؤقتًا.
سيحاول البوت تلقائيًا مرة أخرى.`,
        copilotControlKeyboard()
      );
    }
  });


}

module.exports = registerUserCommands;
