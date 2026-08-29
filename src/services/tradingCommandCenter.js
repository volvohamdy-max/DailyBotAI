const { analyzePair } = require('./analysisService');
const { scanGoldScalp } = require('./goldScalper');
const { getPrice } = require('./marketService');
const { getOpenTrades, getManagedOpenTrades } = require('../database/trades');
const { isForexWeekend } = require('../utils/marketHours');

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function directionFromAnalysis(analysis) {
  const action = String(analysis?.signal?.action || '').toUpperCase();
  if (action === 'BUY' || action === 'SELL') return action;
  const ema20 = finite(analysis?.indicators?.ema20);
  const ema50 = finite(analysis?.indicators?.ema50);
  if (ema20 !== null && ema50 !== null) return ema20 >= ema50 ? 'BUY' : 'SELL';
  return 'WAIT';
}

function marketMode(indicators = {}) {
  const adx = finite(indicators.adx);
  const atr = finite(indicators.atr);
  if (adx !== null && adx >= 30) return 'TRENDING';
  if (adx !== null && adx < 20) return 'RANGE';
  if (atr !== null && atr >= 8) return 'VOLATILE';
  return 'MIXED';
}

function strengthScore(analysis) {
  const confidence = finite(analysis?.signal?.confidence);
  const adx = finite(analysis?.indicators?.adx);
  if (confidence !== null) return Math.max(0, Math.min(100, Math.round(confidence)));
  if (adx !== null) return Math.max(0, Math.min(100, Math.round(adx * 2)));
  return null;
}

async function safe(label, fn, fallback) {
  try { return await fn(); }
  catch (error) {
    console.log(`⚠️ COMMAND CENTER ${label}:`, error.message);
    return fallback;
  }
}

async function getTradingCommandCenterSnapshot() {
  const generatedAt = new Date();
  const weekend = isForexWeekend();
  const [analysis, scalp, price] = await Promise.all([
    safe('ANALYSIS', () => analyzePair('XAUUSD'), null),
    safe('STRATEGIES', () => scanGoldScalp(), { strategyChecks: [], readyResults: [] }),
    safe('PRICE', () => getPrice('XAUUSD'), null)
  ]);

  const strategyChecks = Array.isArray(scalp?.strategyChecks) ? scalp.strategyChecks : [];
  const readyResults = Array.isArray(scalp?.readyResults) ? scalp.readyResults : [];
  const readyById = new Map(readyResults.map(x => [String(x.strategyId || '').toUpperCase(), x]));
  const strategies = strategyChecks.map(item => {
    const ready = readyById.get(String(item.strategyId || '').toUpperCase());
    return {
      id: item.strategyId,
      label: item.strategyLabel,
      ready: Boolean(item.ready),
      status: item.status || 'WAIT',
      direction: ready?.direction || null,
      score: finite(ready?.score)
    };
  });

  const buyReady = strategies.filter(x => x.ready && x.direction === 'BUY').length;
  const sellReady = strategies.filter(x => x.ready && x.direction === 'SELL').length;
  const managedOpen = safeSync(() => getManagedOpenTrades(), []);
  const allOpen = safeSync(() => getOpenTrades(), []);

  return {
    generatedAt: generatedAt.toISOString(),
    marketOpen: !weekend,
    pair: 'XAUUSD',
    price: finite(price),
    bias: directionFromAnalysis(analysis),
    strength: strengthScore(analysis),
    mode: marketMode(analysis?.indicators || {}),
    indicators: {
      rsi: finite(analysis?.indicators?.rsi),
      adx: finite(analysis?.indicators?.adx),
      atr: finite(analysis?.indicators?.atr),
      ema20: finite(analysis?.indicators?.ema20),
      ema50: finite(analysis?.indicators?.ema50)
    },
    strategies,
    consensus: {
      total: strategies.length,
      ready: strategies.filter(x => x.ready).length,
      buy: buyReady,
      sell: sellReady,
      wait: strategies.filter(x => !x.ready).length
    },
    portfolio: {
      managedOpen: managedOpen.length,
      allOpen: allOpen.length,
      maxManagedGold: 2,
      remainingSlots: Math.max(0, 2 - managedOpen.length),
      trades: managedOpen.slice(0, 5).map(t => ({
        id: t.id,
        source: t.telegram_id,
        action: t.action,
        entry: finite(t.entry),
        status: t.status
      }))
    },
    health: {
      analysis: Boolean(analysis),
      strategies: strategies.length > 0,
      price: finite(price) !== null
    }
  };
}

function safeSync(fn, fallback) {
  try { return fn(); }
  catch (error) { return fallback; }
}

function fmt(value) { return finite(value) === null ? '—' : finite(value).toFixed(2); }
function biasIcon(bias) { return bias === 'BUY' ? '📈 BUY' : bias === 'SELL' ? '📉 SELL' : '⏳ WAIT'; }
function modeText(mode, en) {
  const map = en ? { TRENDING: 'Trending', RANGE: 'Range', VOLATILE: 'Volatile', MIXED: 'Mixed' } : { TRENDING: 'اتجاهي', RANGE: 'عرضي', VOLATILE: 'متذبذب', MIXED: 'مختلط' };
  return map[mode] || mode;
}

function renderVipCommandCenter(s, language = 'ar') {
  const en = language === 'en';
  if (en) return `🧠 FOREX AI — LIVE MARKET INTELLIGENCE\n━━━━━━━━━━━━━━━━━━\n🥇 XAUUSD: ${fmt(s.price)}\n${s.marketOpen ? '🟢 Market: OPEN' : '🌙 Market: CLOSED'}\n📊 Market Bias: ${biasIcon(s.bias)}\n🔥 Strength: ${s.strength ?? '—'}/100\n🌊 Market Mode: ${modeText(s.mode, true)}\n\n🤖 Strategy Consensus\n📈 BUY: ${s.consensus.buy}\n📉 SELL: ${s.consensus.sell}\n⏳ WAIT: ${s.consensus.wait}\n⚡ READY: ${s.consensus.ready}/${s.consensus.total}\n\n💼 Open managed trades: ${s.portfolio.managedOpen}/${s.portfolio.maxManagedGold}\n🎯 Available slots: ${s.portfolio.remainingSlots}\n\n🩺 System: ${s.health.analysis && s.health.strategies && s.health.price ? '🟢 LIVE' : '🟡 PARTIAL DATA'}\n🕒 Updated: ${new Date(s.generatedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })}`;
  return `🧠 FOREX AI — مركز ذكاء السوق\n━━━━━━━━━━━━━━━━━━\n🥇 XAUUSD: ${fmt(s.price)}\n${s.marketOpen ? '🟢 السوق: مفتوح' : '🌙 السوق: مغلق'}\n📊 ميل السوق: ${biasIcon(s.bias)}\n🔥 قوة الاتجاه: ${s.strength ?? '—'}/100\n🌊 حالة السوق: ${modeText(s.mode, false)}\n\n🤖 إجماع الاستراتيجيات\n📈 BUY: ${s.consensus.buy}\n📉 SELL: ${s.consensus.sell}\n⏳ WAIT: ${s.consensus.wait}\n⚡ READY: ${s.consensus.ready}/${s.consensus.total}\n\n💼 الصفقات المدارة المفتوحة: ${s.portfolio.managedOpen}/${s.portfolio.maxManagedGold}\n🎯 أماكن متاحة: ${s.portfolio.remainingSlots}\n\n🩺 حالة النظام: ${s.health.analysis && s.health.strategies && s.health.price ? '🟢 LIVE' : '🟡 بيانات جزئية'}\n🕒 آخر تحديث: ${new Date(s.generatedAt).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo' })}`;
}

function renderAdminCommandCenter(s) {
  const strategyLines = s.strategies.length ? s.strategies.map(x => `${x.ready ? '🟢' : '🟡'} ${x.label || x.id} | ${x.ready ? (x.direction || 'READY') : 'WAIT'} | ${x.status}${x.score !== null ? ` | ${x.score}/100` : ''}`).join('\n') : '⚠️ لا توجد بيانات استراتيجيات';
  const tradeLines = s.portfolio.trades.length ? s.portfolio.trades.map(t => `#${t.id} ${t.action} @ ${fmt(t.entry)} | ${t.source} | ${t.status}`).join('\n') : 'لا توجد صفقات مدارة مفتوحة';
  return `🎛️ FOREX AI — TRADING COMMAND CENTER\n━━━━━━━━━━━━━━━━━━\n🥇 XAUUSD: ${fmt(s.price)}\n${s.marketOpen ? '🟢 MARKET OPEN' : '🌙 MARKET CLOSED'}\n📊 Bias: ${biasIcon(s.bias)} | Strength: ${s.strength ?? '—'}/100\n🌊 Mode: ${s.mode}\n📐 RSI ${fmt(s.indicators.rsi)} | ADX ${fmt(s.indicators.adx)} | ATR ${fmt(s.indicators.atr)}\n\n🤖 LIVE STRATEGIES (${s.consensus.ready}/${s.consensus.total} READY)\n${strategyLines}\n\n🛡️ PORTFOLIO\nManaged: ${s.portfolio.managedOpen}/${s.portfolio.maxManagedGold} | Slots: ${s.portfolio.remainingSlots}\n${tradeLines}\n\n🩺 HEALTH\nAnalysis: ${s.health.analysis ? '✅' : '❌'} | Strategies: ${s.health.strategies ? '✅' : '❌'} | Price: ${s.health.price ? '✅' : '❌'}\n🕒 Cairo: ${new Date(s.generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}\n\n🔒 Read-only monitoring — لا يغير قرارات الاستراتيجيات.`;
}

module.exports = { getTradingCommandCenterSnapshot, renderVipCommandCenter, renderAdminCommandCenter };
