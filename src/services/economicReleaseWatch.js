const cron = require('node-cron');
const db = require('../database/db');
const config = require('../config');
const { getMultiSourceCalendar, eventHash, isHighImpact } = require('./newsCalendarGate');
const { translateToArabic } = require('./newsTranslator');
const { refreshDailyNewsBrief } = require('./dailyNewsBriefService');

const IMPORTANT = new Set(['USD','EUR','GBP','JPY','CHF']);
const TZ = 'Africa/Cairo';
let running = false;

function validActual(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return Boolean(s && s !== '-' && s.length <= 80 && /[-+]?\d/.test(s));
}
function seen(k) { return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(k)); }
function mark(k) { db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(k); }
function impact(e) {
  const x = String(e.impact || '').toLowerCase();
  return isHighImpact(e) || x === 'high' ? 'high' : (x === 'medium' || x === 'med' ? 'medium' : 'low');
}
function flag(e) {
  const c = String(e.currency || '').toUpperCase();
  const title = String(e.title || '').toLowerCase();
  if (c === 'EUR') {
    if (/german|germany/.test(title)) return '🇩🇪';
    if (/french|france/.test(title)) return '🇫🇷';
    if (/italian|italy/.test(title)) return '🇮🇹';
    if (/spanish|spain/.test(title)) return '🇪🇸';
    return '🇪🇺';
  }
  return ({USD:'🇺🇸',GBP:'🇬🇧',JPY:'🇯🇵',CHF:'🇨🇭'})[c] || '🌍';
}
function countryName(e) {
  const c = String(e.currency || '').toUpperCase();
  const title = String(e.title || '').toLowerCase();
  if (c === 'EUR') {
    if (/german|germany/.test(title)) return 'ألمانيا';
    if (/french|france/.test(title)) return 'فرنسا';
    if (/italian|italy/.test(title)) return 'إيطاليا';
    if (/spanish|spain/.test(title)) return 'إسبانيا';
    return 'منطقة اليورو';
  }
  return ({USD:'الولايات المتحدة',GBP:'المملكة المتحدة',JPY:'اليابان',CHF:'سويسرا'})[c] || c;
}
async function arabicTitle(title) {
  const t = String(title || '').toLowerCase();
  const rules = [
    ['producer price index','مؤشر أسعار المنتجين'],['ppi','مؤشر أسعار المنتجين'],
    ['consumer price index','مؤشر أسعار المستهلكين'],['cpi','مؤشر أسعار المستهلكين'],
    ['retail sales','مبيعات التجزئة'],['unemployment rate','معدل البطالة'],
    ['jobless claims','طلبات إعانة البطالة'],['nonfarm payroll','الوظائف غير الزراعية'],
    ['gross domestic product','الناتج المحلي الإجمالي'],['gdp','الناتج المحلي الإجمالي'],
    ['manufacturing pmi','مؤشر مديري المشتريات الصناعي'],['services pmi','مؤشر مديري المشتريات الخدمي'],
    ['fomc minutes','محضر اجتماع الاحتياطي الفيدرالي'],['interest rate','قرار سعر الفائدة']
  ];
  for (const [en, ar] of rules) if (t.includes(en)) return ar;
  try { return (await translateToArabic(String(title || ''))) || String(title || 'خبر اقتصادي'); } catch { return String(title || 'خبر اقتصادي'); }
}
function num(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g,'').match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function interpretation(e) {
  const a = num(e.actual), f = num(e.forecast), c = String(e.currency || '').toUpperCase();
  if (a == null || f == null) return `صدرت القراءة الجديدة؛ راقب تأثيرها الفعلي على ${c}.`;
  const title = String(e.title || '').toLowerCase();
  const higherPositive = /ppi|producer price|cpi|consumer price|gdp|retail sales|pmi|employment change|average hourly/.test(title);
  const lowerPositive = /unemployment rate|jobless claims|unemployment claims/.test(title);
  let positive = null;
  if (higherPositive) positive = a > f ? true : a < f ? false : null;
  if (lowerPositive) positive = a < f ? true : a > f ? false : null;
  if (positive === true) return `القراءة جاءت أفضل من المتوقع، وهو عامل إيجابي مبدئيًا لـ ${c}.`;
  if (positive === false) return `القراءة جاءت أضعف من المتوقع، وهو عامل سلبي مبدئيًا لـ ${c}.`;
  return `القراءة جاءت قريبة من المتوقع؛ التأثير يعتمد على تفاصيل الإصدار ورد فعل السوق.`;
}
async function cycle(bot) {
  if (running) return;
  running = true;
  try {
    const cal = await getMultiSourceCalendar(true);
    const now = Date.now();
    let sentAny = false;
    for (const e of cal.data || []) {
      const cur = String(e.currency || '').toUpperCase();
      if (!IMPORTANT.has(cur)) continue;
      const imp = impact(e);
      if (imp !== 'high' && imp !== 'medium') continue;
      const ts = new Date(e.date).getTime();
      if (!Number.isFinite(ts)) continue;
      const ageMin = (now - ts) / 60000;
      if (ageMin < -2 || ageMin > 180) continue;
      if (!validActual(e.actual)) continue;
      const key = `news_released_${eventHash(e)}`;
      if (seen(key)) continue;

      const title = await arabicTitle(e.title);
      const stars = imp === 'high' ? '⭐⭐⭐' : '⭐⭐';
      const icon = imp === 'high' ? '🔴' : '🟠';
      const msg = `${icon} <b>صدر الآن :</b>\n\n💠 <b>${countryName(e)} - ${flag(e)}</b>\n\n🔵 <b>${title}</b>\n\n🔖 درجة الأهمية ${stars}\n\n🕒 السابق : ${e.previous ?? '-'}\n🕞 التقدير : ${e.forecast ?? '-'}\n🕓 الحالي : <b>${e.actual}</b>\n\n👈 النتيجة : ${interpretation(e)}\n\n━━━━━━━━━━━━━━\n\n#ForexNews #EconomicNews\n@Forexaitrade_bot`;
      await bot.telegram.sendMessage(String(config.mainGroupId), msg, { parse_mode:'HTML', disable_web_page_preview:true });
      mark(key);
      sentAny = true;
      console.log(`📣 Economic release sent: ${e.title} | ${cur} | ${imp} | Actual=${e.actual}`);
    }

    if (sentAny) {
      await refreshDailyNewsBrief(bot);
    }
  } catch (err) {
    console.log('⚠️ Economic release watch error:', err.message);
  } finally { running = false; }
}
function startEconomicReleaseWatch(bot) {
  cron.schedule('* * * * *', () => cycle(bot), { timezone: TZ });
  setTimeout(() => cycle(bot), 15000);
  console.log('📣 Economic release watch every 1 minute | HIGH+MEDIUM | catch-up=3h | syncs pinned daily brief');
}
module.exports = { startEconomicReleaseWatch, cycle };
