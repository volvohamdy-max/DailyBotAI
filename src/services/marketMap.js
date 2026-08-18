const { scanTrends } = require('./trendHunter');
const { getBestTrade } = require('./bestTrade');

function rankStatus(status) {
  const map = {
    ENTRY_READY: 5,
    WAIT_PULLBACK: 4,
    TREND_FOUND: 3,
    NO_TREND: 2,
    NO_DATA: 1,
    ERROR: 0
  };
  return map[status] ?? 0;
}

function sessionInfo() {
  const hour = new Date().getUTCHours();

  if (hour >= 0 && hour < 7) {
    return { key: 'asia', ar: 'الجلسة الآسيوية', en: 'Asian Session' };
  }
  if (hour >= 7 && hour < 13) {
    return { key: 'london', ar: 'جلسة لندن', en: 'London Session' };
  }
  if (hour >= 13 && hour < 21) {
    return { key: 'newyork', ar: 'جلسة نيويورك', en: 'New York Session' };
  }
  return { key: 'late', ar: 'الفترة الهادئة', en: 'Late Session' };
}

function sessionBonus(pair, session) {
  const bonuses = {
    asia: { USDJPY: 6, EURJPY: 5, GBPJPY: 5, CHFJPY: 4, XAUUSD: 2 },
    london: { EURUSD: 6, GBPUSD: 6, GBPJPY: 5, EURJPY: 4, XAUUSD: 3 },
    newyork: { XAUUSD: 7, EURUSD: 5, GBPUSD: 5, USDJPY: 4, BTCUSD: 3 },
    late: { BTCUSD: 4, XAUUSD: 1 }
  };
  return bonuses[session.key]?.[pair] || 0;
}

function decisionScore(item, session) {
  let score = Number(item.score) || 0;

  const status = String(item.status || '');
  const ai = Number(item.aiConfidence);
  const adx = Number(item.adx);

  // ==========================================
  // 5M / ENTRY QUALITY — أهم عنصر للسكالبينج
  // ==========================================

  if (status === 'ENTRY_READY') {
    score += 18;
  } else if (status === 'WAIT_PULLBACK') {
    score -= 6;
  } else if (status === 'TREND_FOUND') {
    // الترند وحده ليس إشارة دخول
    score -= 10;
  } else if (
    status === 'WAIT' ||
    status === 'VOLATILITY_TOO_LOW'
  ) {
    score -= 15;
  } else if (status === 'REJECT') {
    score -= 25;
  }

  // ==========================================
  // AI CONFIDENCE
  // ==========================================

  if (Number.isFinite(ai)) {
    if (ai >= 70) {
      score += 10;
    } else if (ai >= 65) {
      score += 7;
    } else if (ai >= 60) {
      score += 4;
    } else {
      // أقل من الحد المطلوب للدخول
      score -= 18;
    }
  } else {
    score -= 15;
  }

  // ==========================================
  // ADX — عامل مساعد فقط
  // ==========================================

  if (Number.isFinite(adx)) {
    if (adx >= 25 && adx <= 38) {
      score += 4;
    } else if (adx >= 20) {
      score += 2;
    } else {
      score -= 4;
    }
  }

  // الجلسة Bonus صغير فقط
  score += Math.min(
    sessionBonus(item.pair, session),
    4
  );

  // ==========================================
  // HARD CAPS
  // ==========================================

  // AI أقل من 60% لا يجوز أن تظهر الفرصة Elite
  if (!Number.isFinite(ai) || ai < 60) {
    score = Math.min(score, 59);
  }

  // مجرد TREND بدون دخول جاهز
  if (status === 'TREND_FOUND') {
    score = Math.min(score, 64);
  }

  if (status === 'WAIT_PULLBACK') {
    score = Math.min(score, 69);
  }

  if (
    status === 'WAIT' ||
    status === 'VOLATILITY_TOO_LOW'
  ) {
    score = Math.min(score, 55);
  }

  if (status === 'REJECT') {
    score = Math.min(score, 40);
  }

  return Math.round(
    Math.max(0, Math.min(100, score))
  );
}

async function buildMarketMap() {
  const session = sessionInfo();
  const trends = await scanTrends();

  const ranked = trends
    .map((item) => ({
      ...item,
      marketScore: decisionScore(item, session)
    }))
    .sort((a, b) => {
      // Scalping First:
      // التقييم الفعلي أهم من مجرد وجود ترند
      if (b.marketScore !== a.marketScore) {
        return b.marketScore - a.marketScore;
      }

      return rankStatus(b.status) - rankStatus(a.status);
    });

  let bestTrade = null;
  try {
    bestTrade = await getBestTrade();
  } catch (error) {
    console.log('Market Map bestTrade error:', error.message);
  }

  return { session, ranked, bestTrade };
}

module.exports = { buildMarketMap, sessionInfo };
