const { scanMarkets } = require('./smartScanner');
const { isPairMarketOpen } = require('../utils/marketHours');
const { getWatches, updateWatchState } = require('../database/opportunityRadar');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v) {
  return Math.max(0, Math.min(100, Number(v || 0)));
}

function getDirection(row) {
  const d = String(row.action || row.signal?.action || row.technicalDirection || row.direction || 'WAIT').toUpperCase();
  return ['BUY', 'SELL'].includes(d) ? d : 'WAIT';
}

function getScore(row) {
  return clamp(row.finalScore ?? row.score ?? row.smartScore ?? row.scalpMeta?.score ?? row.signal?.confidence ?? 0);
}

function evaluate(row) {
  const direction = getDirection(row);
  const i = row.indicators || row.analysis?.indicators || {};
  const ema20 = num(i.ema20);
  const ema50 = num(i.ema50);
  const rsi = num(i.rsi);
  const adx = num(i.adx);
  const macd = num(i.macd?.histogram ?? i.macdHistogram);
  const score = getScore(row);

  const checks = [
    { label: 'اتجاه السوق', ok: direction !== 'WAIT' },
    { label: 'تأكيد EMA', ok: ema20 !== null && ema50 !== null && ((direction === 'BUY' && ema20 > ema50) || (direction === 'SELL' && ema20 < ema50)) },
    { label: 'منطقة RSI', ok: rsi !== null && ((direction === 'BUY' && rsi >= 50 && rsi <= 75) || (direction === 'SELL' && rsi <= 50 && rsi >= 25)) },
    { label: 'زخم MACD', ok: macd !== null && ((direction === 'BUY' && macd > 0) || (direction === 'SELL' && macd < 0)) },
    { label: 'قوة ADX', ok: adx !== null && adx >= 20 },
    { label: 'جودة الفرصة', ok: score >= 80 }
  ];

  const passed = checks.filter(x => x.ok).length;
  return { checks, passed, total: checks.length, completion: Math.round((passed / checks.length) * 100) };
}

function validExecutionLevels(row) {
  const direction = String(row?.direction || '').toUpperCase();
  const entry = num(row?.entry);
  const sl = num(row?.sl);
  const tp1 = num(row?.tp1);
  const tp2 = num(row?.tp2);

  if (!['BUY', 'SELL'].includes(direction)) return false;
  if ([entry, sl, tp1, tp2].some(v => v === null || v <= 0)) return false;

  return direction === 'BUY'
    ? sl < entry && entry < tp1 && tp1 < tp2
    : sl > entry && entry > tp1 && tp1 > tp2;
}

function normalize(row) {
  const pair = String(row.pair || row.symbol || '').toUpperCase();
  const result = evaluate(row);
  const normalized = {
    pair,
    direction: getDirection(row),
    score: getScore(row),
    passed: result.passed,
    total: result.total,
    completion: result.completion,
    missing: result.checks.filter(x => !x.ok).map(x => x.label),
    ready: result.passed === result.total,
    entry: row.entry ?? row.signal?.entry ?? row.levels?.entry ?? null,
    sl: row.stop_loss ?? row.sl ?? row.signal?.sl ?? row.levels?.sl ?? row.levels?.stop_loss ?? null,
    tp1: row.target1 ?? row.tp1 ?? row.signal?.tp1 ?? row.levels?.tp1 ?? null,
    tp2: row.target2 ?? row.tp2 ?? row.signal?.tp2 ?? row.levels?.tp2 ?? null
  };
  normalized.executionReady = validExecutionLevels(normalized);
  return normalized;
}

async function buildOpportunityRadar() {
  const rows = await scanMarkets();
  return (rows || [])
    .filter(row => {
      const pair = String(row.pair || row.symbol || '').toUpperCase();
      return pair && isPairMarketOpen(pair);
    })
    .map(normalize)
    .sort((a, b) => b.passed !== a.passed ? b.passed - a.passed : b.score - a.score)
    .slice(0, 8);
}

function getState(row) {
  if (!row) return 'WEAK';
  if (row.passed >= row.total) return row.executionReady ? 'CONFIRMED' : 'WAIT_EXECUTION_LEVELS';
  if (row.passed === 5) return 'ALMOST_READY';
  if (row.passed === 4) return 'FORMING';
  return 'WEAK';
}

function radarText(rows) {
  if (!rows.length) return `📡 رادار الفرص\n\nلا توجد فرص نشطة حاليًا.`;
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const body = rows.slice(0, 5).map((r, i) => {
    const state = getState(r);
    const bars = '█'.repeat(r.passed) + '░'.repeat(Math.max(0, r.total - r.passed));
    let directionText = '⏳ لم يتم تأكيد اتجاه دخول';
    if (state === 'FORMING' || state === 'ALMOST_READY' || state === 'WAIT_EXECUTION_LEVELS') {
      directionText = r.direction === 'BUY' ? '🧭 الميل الحالي: صعودي' : r.direction === 'SELL' ? '🧭 الميل الحالي: هبوطي' : '🧭 الميل الحالي: غير محسوم';
    }
    if (state === 'CONFIRMED') directionText = r.direction === 'BUY' ? '📈 إشارة مؤكدة: BUY' : '📉 إشارة مؤكدة: SELL';

    let stateText = '⏳ تحت المراقبة';
    if (state === 'FORMING') stateText = '🟡 الفرصة تتكوّن';
    if (state === 'ALMOST_READY') stateText = '👀 باقي شرط واحد فقط';
    if (state === 'WAIT_EXECUTION_LEVELS') stateText = '⏳ الشروط مكتملة — انتظار مستويات تنفيذ صالحة';
    if (state === 'CONFIRMED') stateText = '🔥 الفرصة اكتملت';

    const missing = state === 'WAIT_EXECUTION_LEVELS'
      ? 'الناقص: Entry / SL / TP1 / TP2 صالحة ومرتبة'
      : r.missing?.length ? `الناقص: ${r.missing[0]}` : '✅ كل الشروط الفنية مؤكدة';

    return `${medals[i] || '•'} ${r.pair}\n\n${directionText}\n\n${bars} ${r.passed}/${r.total}\n\n⭐ Score: ${r.score}/100\n\n${stateText}\n\n${missing}`;
  }).join('\n\n');

  return `📡 FOREX AI — رادار الفرص\n━━━━━━━━━━━━━━━━━━\n\n${body}\n\n━━━━━━━━━━━━━━━━━━\n\nℹ️ BUY / SELL لا يظهر كإشارة دخول إلا بعد اكتمال الشروط ووجود مستويات تنفيذ صالحة.\n\n⚠️ التحليل فني ومعلوماتي ولا يضمن نتائج التداول.`;
}

async function monitorOpportunityRadar(bot) {
  const watches = getWatches();
  if (!watches.length) return;
  const rows = await buildOpportunityRadar();
  const map = new Map(rows.map(row => [row.pair, row]));

  for (const watch of watches) {
    try {
      const pair = String(watch.pair).toUpperCase();
      if (!isPairMarketOpen(pair)) continue;
      const row = map.get(pair);
      if (!row) continue;

      const state = getState(row);
      const previous = String(watch.last_state || 'WATCHING');
      const previousDirection = String(watch.last_direction || '').toUpperCase();
      const currentDirection = String(row.direction || '').toUpperCase();
      const wasActiveSetup = ['FORMING', 'ALMOST_READY', 'WAIT_EXECUTION_LEVELS'].includes(previous);
      const lostSetup = row.passed <= 3;
      const directionChanged = previousDirection && currentDirection && previousDirection !== currentDirection;
      let effectiveState = state;

      if (wasActiveSetup && (lostSetup || directionChanged)) effectiveState = 'CANCELLED';
      let message = null;

      if (effectiveState === 'FORMING' && previous !== 'FORMING') {
        message = `🟡 فرصة بدأت تتكوّن\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n${currentDirection === 'BUY' ? '🧭 الميل الحالي: صعودي' : currentDirection === 'SELL' ? '🧭 الميل الحالي: هبوطي' : '🧭 الميل الحالي: غير محسوم'}\n\n📡 الشروط: ${row.passed}/${row.total}\n\n⭐ Score: ${row.score}/100\n\n⚠️ لا توجد إشارة دخول مؤكدة حتى الآن.\n\nالرادار مستمر في المراقبة.`;
      }

      if (effectiveState === 'ALMOST_READY' && previous !== 'ALMOST_READY') {
        message = `👀 فرصة قوية تقترب من الاكتمال\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n${currentDirection === 'BUY' ? '🧭 الميل الحالي: صعودي' : currentDirection === 'SELL' ? '🧭 الميل الحالي: هبوطي' : '🧭 الميل الحالي: غير محسوم'}\n\n█████░ 5/6\n\n⭐ Score: ${row.score}/100\n\n⏳ الشرط المتبقي: ${row.missing?.[0] || '—'}\n\n🔒 اتجاه الدخول النهائي لم يتم تأكيده بعد.\n\n📡 الرادار مستمر في المتابعة.`;
      }

      if (effectiveState === 'WAIT_EXECUTION_LEVELS') {
        if (previous !== 'WAIT_EXECUTION_LEVELS') console.log(`⏳ RADAR WAITING FOR VALID EXECUTION LEVELS | ${pair}`);
        message = null;
      }

      if (effectiveState === 'CONFIRMED' && previous !== 'CONFIRMED') {
        const fmt = v => Number(v).toFixed(pair === 'XAUUSD' ? 2 : 5);
        message = `🔥 الفرصة اكتملت الآن\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n${currentDirection === 'BUY' ? '📈 BUY' : '📉 SELL'}\n\n██████ 6/6\n\n⭐ Score: ${row.score}/100\n\n💰 Entry: ${fmt(row.entry)}\n🛑 SL: ${fmt(row.sl)}\n🎯 TP1: ${fmt(row.tp1)}\n🏆 TP2: ${fmt(row.tp2)}\n\n✅ جميع شروط التأكيد ومستويات التنفيذ صالحة.\n\n⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
      }

      if (effectiveState === 'CANCELLED' && previous !== 'CANCELLED') {
        message = `⚠️ الفرصة السابقة لم تكتمل\n━━━━━━━━━━━━━━━━━━\n\n🥇 ${pair}\n\n📡 الرادار ألغى الفرصة قبل إصدار إشارة دخول مؤكدة.\n\n${directionChanged ? '🔄 السبب: تغيّر اتجاه السوق.' : '📉 السبب: فقدت الفرصة عددًا من شروط التأكيد.'}\n\n✅ No Trade = قرار.\n\nالرادار مستمر في البحث عن فرصة جديدة.`;
      }

      if (message) {
        try { await bot.telegram.sendMessage(watch.telegram_id, message); }
        catch (error) { console.log(`Radar alert send failed ${watch.telegram_id}:`, error.message); }
      }

      updateWatchState(watch.telegram_id, pair, effectiveState, row.score, currentDirection, row.completion);
    } catch (error) {
      console.log('Opportunity Radar state error:', error.message);
    }
  }
}

module.exports = { buildOpportunityRadar, radarText, monitorOpportunityRadar, validExecutionLevels };
