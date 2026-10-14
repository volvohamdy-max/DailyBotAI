const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
const { getPrice } = require('../services/marketService');
const { getMultiSourceCalendar, isHighImpact } = require('../services/newsCalendarGate');

const TIMEFRAMES = [
  { key: '5min', label: 'M5', weight: 1 },
  { key: '15min', label: 'M15', weight: 2 },
  { key: '1h', label: 'H1', weight: 3 }
];
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
  return groups.map(g => ({ price:g.mean, touches:g.values.length, distancePct:pctDistance(price,g.mean) }))
    .filter(g => Number.isFinite(g.distancePct)).sort((a,b)=>a.distancePct-b.distancePct);
}
async function getNewsRisk() {
  try {
    const cal = await getMultiSourceCalendar(false);
    const now = Date.now();
    const events = (cal?.data || []).map(e => ({ ...e, ts:new Date(e.date).getTime() })).filter(e => {
      const cur = String(e.currency || '').toUpperCase();
      return cur === 'USD' && Number.isFinite(e.ts) && e.ts >= now - 15*60*1000 && e.ts <= now + 60*60*1000 && isHighImpact(e);
    }).sort((a,b)=>a.ts-b.ts);
    if (!events.length) return { blocked:false, event:null, minutes:null };
    const event = events[0];
    return { blocked:event.ts >= now, event, minutes:Math.max(0,Math.round((event.ts-now)/60000)) };
  } catch (error) {
    console.log('⚠️ GOLD RADAR NEWS FILTER:', error.message);
    return { blocked:false, event:null, minutes:null, unavailable:true };
  }
}
function buildTradeScenario(price, setup, directions, rsi, adx, newsRisk) {
  if (!setup) return null;
  const side = setup.side;
  const aligned = directions.filter(x=>x.trend===side).length;
  let score = 45 + aligned*12;
  score += Math.min(15, setup.zone.frames.size*5);
  score += Math.min(12, setup.zone.touches*2);
  if (adx != null) score += adx >= 25 ? 8 : adx >= 18 ? 4 : -4;
  if (rsi != null) {
    if (side === 'BUY' && rsi >= 45 && rsi <= 68) score += 5;
    if (side === 'SELL' && rsi >= 32 && rsi <= 55) score += 5;
  }
  if (newsRisk?.blocked) score -= 30;
  score = clamp(Math.round(score), 0, 100);
  const zone = setup.zone.price;
  const distance = Math.max(Math.abs(price-zone), price*0.00055);
  const entry = price;
  const slDistance = Math.max(distance*1.6, price*0.0010);
  const sl = side === 'BUY' ? entry-slDistance : entry+slDistance;
  const risk = Math.abs(entry-sl);
  const tp1 = side === 'BUY' ? entry+risk*1.5 : entry-risk*1.5;
  const tp2 = side === 'BUY' ? entry+risk*2.2 : entry-risk*2.2;
  const status = newsRisk?.blocked ? 'NEWS_BLOCK' : score >= 75 ? 'READY' : score >= 62 ? 'WAIT_CONFIRMATION' : 'WEAK';
  return { side, score, status, entry, sl, tp1, tp2, rr1:1.5, rr2:2.2 };
}
async function buildRadar() {
  const [priceRaw, candles5, candles15, candles1h] = await Promise.all([
    getPrice('XAUUSD'), getGoldCandlesResilient('5min',150), getGoldCandlesResilient('15min',150), getGoldCandlesResilient('1h',150)
  ]);
  const price = num(priceRaw);
  if (!(price > 0)) throw new Error('Invalid live gold price');
  const [a5,a15,a1h,newsRisk] = await Promise.all([
    analyzePair('XAUUSD','5min'), analyzePair('XAUUSD','15min'), analyzePair('XAUUSD','1h'), getNewsRisk()
  ]);
  const analyses=[a5,a15,a1h], candles=[candles5,candles15,candles1h], candidates=[];
  for (let idx=0;idx<candles.length;idx++) {
    const tf=TIMEFRAMES[idx], extremes=localExtremes(candles[idx]);
    for (const level of clusterLevels(extremes.supports,price).slice(0,8)) candidates.push({...level,side:'BUY',timeframe:tf.label,weight:tf.weight});
    for (const level of clusterLevels(extremes.resistances,price).slice(0,8)) candidates.push({...level,side:'SELL',timeframe:tf.label,weight:tf.weight});
  }
  const zones=[];
  for (const c of candidates.sort((a,b)=>a.distancePct-b.distancePct)) {
    let z=zones.find(x=>x.side===c.side&&pctDistance(x.price,c.price)<=0.12);
    if(!z){z={side:c.side,price:c.price,touches:0,frames:new Set(),nearestPct:c.distancePct,strength:0};zones.push(z);}
    z.price=(z.price*z.touches+c.price)/(z.touches+1);z.touches+=c.touches;z.frames.add(c.timeframe);z.nearestPct=Math.min(z.nearestPct,c.distancePct);
    z.strength=z.touches*5+z.frames.size*12+Math.max(0,25-z.nearestPct*100);
  }
  const nearby=zones.filter(z=>z.nearestPct<=0.65).sort((a,b)=>b.strength-a.strength).slice(0,6);
  const directions=analyses.map((a,i)=>({tf:TIMEFRAMES[i].label,trend:trendOf(a),indicators:a?.indicators||{}}));
  const buyVotes=directions.filter(x=>x.trend==='BUY').length, sellVotes=directions.filter(x=>x.trend==='SELL').length;
  const overall=buyVotes>=2?'BUY':sellVotes>=2?'SELL':'NEUTRAL';
  const currentRsi=num(directions[1].indicators.rsi), currentAdx=num(directions[1].indicators.adx);
  const support=nearby.filter(z=>z.side==='BUY').sort((a,b)=>a.nearestPct-b.nearestPct)[0];
  const resistance=nearby.filter(z=>z.side==='SELL').sort((a,b)=>a.nearestPct-b.nearestPct)[0];
  let setup=null;
  if(support&&support.nearestPct<=0.18&&overall!=='SELL'&&(currentRsi==null||currentRsi>=42)) setup={side:'BUY',zone:support,reason:'السعر قريب من دعم متعدد الفريمات مع عدم وجود تعارض هابط واضح.'};
  if(resistance&&resistance.nearestPct<=0.18&&overall!=='BUY'&&(currentRsi==null||currentRsi<=62)) if(!setup||resistance.strength>setup.zone.strength) setup={side:'SELL',zone:resistance,reason:'السعر قريب من مقاومة متعددة الفريمات مع عدم وجود تعارض صاعد واضح.'};
  const scenario=buildTradeScenario(price,setup,directions,currentRsi,currentAdx,newsRisk);
  return {price,directions,overall,currentRsi,currentAdx,nearby,support,resistance,setup,scenario,newsRisk};
}
function formatRadar(r) {
  const trend=x=>x==='BUY'?'🟢 صاعد':x==='SELL'?'🔴 هابط':'⚪ محايد';
  const zoneText=z=>z?`${fmt(z.price)} | بُعد ${z.nearestPct.toFixed(3)}% | ${z.frames.size} فريم | قوة ${Math.round(z.strength)}`:'لا توجد منطقة قريبة كفاية';
  const s=r.scenario;
  const news=r.newsRisk?.blocked?`🚨 فلتر الأخبار: إيقاف الدخول — ${String(r.newsRisk.event?.title||'خبر USD قوي')} خلال ${r.newsRisk.minutes} دقيقة.`:r.newsRisk?.unavailable?'⚠️ فلتر الأخبار: المصدر غير متاح مؤقتًا.':'📰 فلتر الأخبار: لا يوجد خبر USD عالي التأثير خلال الساعة القادمة.';
  const scenario=!s?'⏳ لا يوجد سيناريو دخول حاليًا. انتظر وصول السعر لمنطقة قوية مع تأكيد.':s.status==='NEWS_BLOCK'?`🚨 المنطقة قوية لكن الدخول موقوف بسبب خبر USD عالي التأثير قريب.\n📍 المنطقة: ${fmt(r.setup.zone.price)} | ${s.side}`:`🎯 سيناريو الصفقة\n${s.side==='BUY'?'🟢 BUY':'🔴 SELL'} | تأكيد ${s.score}/100\n📍 Entry: ${fmt(s.entry)}\n🛑 SL: ${fmt(s.sl)}\n🎯 TP1: ${fmt(s.tp1)} | R:R 1:${s.rr1}\n🎯 TP2: ${fmt(s.tp2)} | R:R 1:${s.rr2}\n${s.status==='READY'?'✅ التأكيد قوي — السيناريو جاهز للمراقبة والتنفيذ وفق إدارة المخاطر.':s.status==='WAIT_CONFIRMATION'?'🟡 انتظر شمعة تأكيد قبل الدخول.':'⚪ التأكيد ضعيف — لا تدخل الآن.'}`;
  return ['🚨 رادار مناطق الذهب الذكي — XAUUSD','━━━━━━━━━━━━━━━━━━',`💵 السعر اللحظي: ${fmt(r.price)}`,`🧭 الاتجاه العام M5/M15/H1: ${trend(r.overall)}`,`📊 RSI M15: ${r.currentRsi==null?'—':r.currentRsi.toFixed(1)} | ADX M15: ${r.currentAdx==null?'—':r.currentAdx.toFixed(1)}`,'','🧱 أقرب المناطق القوية:',`🟢 دعم: ${zoneText(r.support)}`,`🔴 مقاومة: ${zoneText(r.resistance)}`,'',news,'',scenario,'','🔎 توافق الفريمات:',...r.directions.map(x=>`• ${x.tf}: ${trend(x.trend)}`),'','⚠️ التحليل للمساعدة في القرار وليس ضمانًا للربح.'].join('\n');
}
function formatAutoAlert(r) {
  const s=r.scenario;
  if(!s||s.status==='WEAK') return null;
  if(s.status==='NEWS_BLOCK') return `🚨 تنبيه رادار الذهب\n━━━━━━━━━━━━━━━━━━\n📍 الذهب وصل لمنطقة ${s.side==='BUY'?'دعم للشراء':'مقاومة للبيع'} قوية قرب ${fmt(r.setup.zone.price)}\n🚫 الدخول موقوف حاليًا بسبب خبر USD عالي التأثير خلال ${r.newsRisk.minutes} دقيقة.\n⏳ انتظر انتهاء الخبر وهدوء الحركة.`;
  return `🚨 تنبيه رادار مناطق الذهب\n━━━━━━━━━━━━━━━━━━\n${s.side==='BUY'?'🟢 BUY ZONE':'🔴 SELL ZONE'}\n💵 السعر: ${fmt(r.price)}\n📍 المنطقة: ${fmt(r.setup.zone.price)}\n⭐ التأكيد: ${s.score}/100\n📍 Entry: ${fmt(s.entry)}\n🛑 SL: ${fmt(s.sl)}\n🎯 TP1: ${fmt(s.tp1)} | R:R 1:${s.rr1}\n🎯 TP2: ${fmt(s.tp2)} | R:R 1:${s.rr2}\n${s.status==='READY'?'✅ تأكيد قوي على M5/M15/H1.':'🟡 المنطقة نشطة لكن يفضل انتظار شمعة تأكيد.'}\n⚠️ استخدم إدارة مخاطر مناسبة.`;
}
module.exports={buildRadar,formatRadar,formatAutoAlert};