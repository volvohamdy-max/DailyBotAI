const db = require('../database/db');
const config = require('../config');
const {
  getMultiSourceCalendar,
  isHighImpact,
  eventHash,
  affectedPairs
} = require('./newsCalendarGate');
const { translateNews, translateToArabic } = require('./newsTranslator');

const IMPORTANT_NEWS_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF']);

function newsGroupId() {
  const id = config.mainGroupId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function seen(key) {
  return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key));
}

function mark(key) {
  db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(key);
}

function minutesUntil(event) {
  return (new Date(event.date).getTime() - Date.now()) / 60000;
}

function formatLocalTime(event) {
  const d = new Date(event.date);
  return Number.isNaN(d.getTime())
    ? event.date
    : d.toLocaleString('ar-EG', {
        timeZone: process.env.NEWS_TIMEZONE || 'Africa/Cairo',
        hour12: true
      });
}

function currencyArabic(currency) {
  const code = String(currency || '').toUpperCase();
  const names = {
    USD: '🇺🇸 الدولار الأمريكي',
    EUR: '🇪🇺 اليورو',
    GBP: '🇬🇧 الجنيه الإسترليني',
    JPY: '🇯🇵 الين الياباني',
    CHF: '🇨🇭 الفرنك السويسري'
  };
  return names[code] || code || '-';
}

function assetsArabic(event) {
  const c = String(event.currency || '').toUpperCase();
  if (c === 'USD') return '🥇 الذهب XAUUSD\n💵 الدولار الأمريكي\n🇪🇺 EURUSD\n🇬🇧 GBPUSD\n🇯🇵 USDJPY';
  if (c === 'EUR') return '🇪🇺 اليورو\n📊 EURUSD\n📊 EURJPY\n📊 EURGBP';
  if (c === 'GBP') return '🇬🇧 الجنيه الإسترليني\n📊 GBPUSD\n📊 GBPJPY\n📊 EURGBP';
  if (c === 'JPY') return '🇯🇵 الين الياباني\n📊 USDJPY\n📊 EURJPY\n📊 GBPJPY';
  const pairs = affectedPairs(event);
  return pairs.length ? pairs.join(', ') : '—';
}

function sourceLine(event) {
  return Number(event.sourceCount) >= 2
    ? `✅ مؤكد من ${event.sourceCount} مصادر`
    : '⚠️ متاح من مصدر واحد';
}

async function translatedEconomicTitle(title) {
  const raw = String(title || '').trim();
  const t = raw.toLowerCase();
  const rules = [
    ['consumer price index', 'مؤشر أسعار المستهلكين'], ['core cpi', 'مؤشر أسعار المستهلكين الأساسي'], ['cpi', 'مؤشر أسعار المستهلكين'],
    ['producer price index', 'مؤشر أسعار المنتجين'], ['ppi', 'مؤشر أسعار المنتجين'],
    ['nonfarm payrolls', 'الوظائف غير الزراعية'], ['non-farm payrolls', 'الوظائف غير الزراعية'], ['nfp', 'الوظائف غير الزراعية'],
    ['unemployment rate', 'معدل البطالة'], ['jobless claims', 'طلبات إعانة البطالة'],
    ['retail sales', 'مبيعات التجزئة'], ['gdp', 'الناتج المحلي الإجمالي'],
    ['interest rate decision', 'قرار سعر الفائدة'], ['fomc', 'الاحتياطي الفيدرالي'],
    ['manufacturing pmi', 'مؤشر مديري المشتريات الصناعي'], ['services pmi', 'مؤشر مديري المشتريات الخدمي']
  ];
  for (const [en, ar] of rules) if (t.includes(en)) return ar;
  try {
    const translated = translateNews(raw);
    if (translated && translated !== raw) return translated;
  } catch (_) {}
  try {
    return (await translateToArabic(raw)) || 'خبر اقتصادي مهم';
  } catch (_) {
    return 'خبر اقتصادي مهم';
  }
}

async function sendAndMark(bot, key, message) {
  const chatId = newsGroupId();
  if (!chatId) {
    console.log('⚠️ Upcoming news not sent: MAIN_GROUP_ID is not configured');
    return false;
  }

  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
    mark(key);
    return true;
  } catch (error) {
    console.log(`Upcoming news send failed ${chatId}:`, error.message);
    return false;
  }
}

async function checkUpcomingNewsReliable(bot) {
  const { data, providers } = await getMultiSourceCalendar();

  if (!providers.length) {
    console.log('⚠️ No economic-calendar provider available');
    return;
  }

  for (const event of data) {
    if (!IMPORTANT_NEWS_CURRENCIES.has(String(event.currency || '').toUpperCase())) continue;
    if (!isHighImpact(event)) continue;

    const diff = minutesUntil(event);
    if (!Number.isFinite(diff) || diff <= 0 || diff > 35) continue;

    const id = eventHash(event);
    let stage;
    let label;

    // The 5-minute warning has priority and is deliberately wide enough
    // to survive a delayed provider or a cron cycle that runs a little late.
    if (diff <= 7) {
      stage = '5m';
      label = `${Math.max(1, Math.round(diff))} دقائق`;
    } else {
      // Any newly discovered high-impact event inside 35 minutes gets the
      // advance warning once, even if the provider did not expose it at T-30.
      stage = '30m';
      label = `${Math.max(8, Math.round(diff))} دقيقة`;
    }

    const key = `news_${stage}_${id}`;
    if (seen(key)) continue;

    const urgent = stage === '5m';
    const message = `
${urgent ? '🔴 <b>وضع خطر الأخبار</b>' : '🚨 <b>تنبيه خبر اقتصادي قوي</b>'}

💱 العملة: <b>${currencyArabic(event.currency)}</b>
📰 الخبر: <b>${await translatedEconomicTitle(event.title)}</b>
⏰ الموعد: ${formatLocalTime(event)}
⏳ باقي حوالي: <b>${label}</b>

🔴 التأثير: مرتفع

📊 الأصول المتأثرة:
${assetsArabic(event)}

${sourceLine(event)}

${urgent
  ? '🛑 يفضل عدم فتح صفقات جديدة على الأصول المتأثرة قبل صدور الخبر مباشرة.'
  : '⚠️ استعد لاحتمال ارتفاع التذبذب قبل وبعد الخبر.'}

#forexNews
@Forexaitrade_bot
`;

    const sent = await sendAndMark(bot, key, message);
    if (sent) console.log(`✅ Reliable upcoming news ${stage}: ${event.title} | T-${diff.toFixed(1)}m`);
  }
}

module.exports = { checkUpcomingNewsReliable };
