const cron = require('node-cron');
const db = require('../database/db');
const config = require('../config');
const { translateToArabic } = require('./newsTranslator');
const { getMultiSourceCalendar, isHighImpact } = require('./newsCalendarGate');

const TZ = 'Africa/Cairo';
const IMPORTANT = new Set(['USD','EUR','GBP','JPY','CHF']);

function chatId() {
  const id = config.mainGroupId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function cairoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function cairoDateKey(date = new Date()) {
  const p = cairoParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function sameCairoDay(iso, key) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return cairoDateKey(d) === key;
}

function timeCairo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('ar-EG', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

function currencyFlag(c) {
  return ({USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',JPY:'🇯🇵',CHF:'🇨🇭'})[String(c||'').toUpperCase()] || '🌍';
}

function impactIcon(e) {
  return isHighImpact(e) || e.impact === 'high' ? '🔴' : '🟠';
}

function curatedTitle(title) {
  const raw = String(title || '').trim();
  const t = raw.toLowerCase();
  const rules = [
    ['fomc minutes','محضر اجتماع الاحتياطي الفيدرالي'],
    ['fomc statement','بيان الاحتياطي الفيدرالي'],
    ['interest rate decision','قرار سعر الفائدة'],
    ['producer price index','مؤشر أسعار المنتجين'],
    ['ppi','مؤشر أسعار المنتجين'],
    ['consumer price index','مؤشر أسعار المستهلكين'],
    ['core cpi','مؤشر أسعار المستهلكين الأساسي'],
    ['cpi','مؤشر أسعار المستهلكين'],
    ['nonfarm payroll','الوظائف غير الزراعية'],
    ['unemployment rate','معدل البطالة'],
    ['jobless claims','طلبات إعانة البطالة'],
    ['retail sales','مبيعات التجزئة'],
    ['gross domestic product','الناتج المحلي الإجمالي'],
    ['gdp','الناتج المحلي الإجمالي'],
    ['pce','مؤشر نفقات الاستهلاك الشخصي'],
    ['manufacturing pmi','مؤشر مديري المشتريات الصناعي'],
    ['services pmi','مؤشر مديري المشتريات الخدمي'],
    ['consumer confidence','ثقة المستهلك'],
    ['powell','تصريحات رئيس الاحتياطي الفيدرالي'],
    ['fed chair','تصريحات رئيس الاحتياطي الفيدرالي'],
    ['ecb','البنك المركزي الأوروبي'],
    ['bank of england','بنك إنجلترا'],
    ['bank of japan','بنك اليابان'],
    ['snb','البنك الوطني السويسري']
  ];
  for (const [en, ar] of rules) if (t.includes(en)) return ar;
  return null;
}

async function arabicTitle(title) {
  const known = curatedTitle(title);
  if (known) return known;
  try {
    const ar = await translateToArabic(String(title || ''));
    if (ar && /[\u0600-\u06FF]/.test(ar)) return ar;
  } catch {}
  return String(title || 'خبر اقتصادي مهم');
}

function seen(key) {
  return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key));
}
function mark(key) {
  db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(key);
}

function hasValue(v) {
  return v != null && String(v).trim() !== '' && String(v).trim() !== '-';
}

async function buildDailyBriefMessage() {
  const day = cairoDateKey();
  const { data, providers } = await getMultiSourceCalendar(true);
  const events = (data || [])
    .filter(e => IMPORTANT.has(String(e.currency || '').toUpperCase()))
    .filter(e => sameCairoDay(e.date, day))
    .filter(e => isHighImpact(e) || e.impact === 'medium')
    .sort((a,b) => new Date(a.date) - new Date(b.date))
    .slice(0, 18);

  const dateLabel = new Date().toLocaleDateString('ar-EG', {
    timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let lines = [];
  for (const e of events) {
    const title = await arabicTitle(e.title);
    const released = hasValue(e.actual);
    const status = released ? '✅ صدر' : '⏳ منتظر';
    const forecast = hasValue(e.forecast) ? ` | المتوقع: ${e.forecast}` : '';
    const previous = hasValue(e.previous) ? ` | السابق: ${e.previous}` : '';
    const actual = released ? ` | <b>الفعلي: ${e.actual}</b>` : '';
    lines.push(`${impactIcon(e)} <b>${timeCairo(e.date)}</b> ${currencyFlag(e.currency)} <b>${title}</b>\n${status}${previous}${forecast}${actual}`);
  }

  if (!lines.length) {
    lines = ['🟢 لا توجد أخبار متوسطة أو عالية التأثير مسجلة اليوم على العملات الرئيسية حتى الآن.'];
  }

  const message = `📌 <b>أهم الأخبار الاقتصادية اليوم</b>\n\n📅 ${dateLabel}\n🕗 جميع المواعيد بتوقيت القاهرة\n\n${lines.join('\n\n')}\n\n🔴 تأثير مرتفع   🟠 تأثير متوسط\n✅ صدر   ⏳ منتظر\n⚠️ يفضل الحذر قبل الأخبار القوية وبعدها حتى يهدأ التذبذب.\n\n#EconomicCalendar\n@Forexaitrade_bot`;

  return { message, events, providers, day };
}

async function sendDailyNewsBrief(bot, { force = false } = {}) {
  const target = chatId();
  if (!target) return false;

  const day = cairoDateKey();
  const key = `daily_news_brief_${day}`;
  if (!force && seen(key)) return false;

  const { message, events, providers } = await buildDailyBriefMessage();
  const sent = await bot.telegram.sendMessage(target, message, {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });

  try {
    await bot.telegram.pinChatMessage(target, sent.message_id, { disable_notification: true });
    console.log(`📌 Daily economic brief pinned | ${day} | events=${events.length}`);
  } catch (error) {
    console.log('⚠️ Daily brief sent but pin failed:', error.message);
  }

  mark(key);
  console.log(`📰 Daily economic brief sent | providers=${(providers || []).join(',')}`);
  return true;
}

async function refreshDailyNewsBrief(bot) {
  const target = chatId();
  if (!target) return false;

  try {
    const chat = await bot.telegram.getChat(target);
    const pinned = chat?.pinned_message;
    if (!pinned?.message_id) {
      console.log('🟡 Daily brief refresh skipped: no pinned message');
      return false;
    }

    const currentText = String(pinned.text || pinned.caption || '');
    if (!currentText.includes('أهم الأخبار الاقتصادية اليوم')) {
      console.log('🟡 Daily brief refresh skipped: current pin is not daily economic brief');
      return false;
    }

    const { message, events } = await buildDailyBriefMessage();
    await bot.telegram.editMessageText(target, pinned.message_id, undefined, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    console.log(`🔄 Daily economic brief updated | events=${events.length}`);
    return true;
  } catch (error) {
    if (/message is not modified/i.test(String(error.message || ''))) return true;
    console.log('⚠️ Daily brief refresh failed:', error.message);
    return false;
  }
}

function startDailyNewsBrief(bot) {
  cron.schedule('0 8 * * *', () => {
    sendDailyNewsBrief(bot).catch(error => console.log('❌ Daily news brief error:', error.message));
  }, { timezone: TZ });

  setTimeout(() => {
    const p = cairoParts();
    const hour = Number(p.hour);
    if (hour >= 8 && hour < 12) {
      sendDailyNewsBrief(bot).catch(error => console.log('❌ Morning brief catch-up error:', error.message));
    }
  }, 12000);

  console.log('📌 Daily economic brief scheduled 08:00 Africa/Cairo + live pinned updates');
}

module.exports = { sendDailyNewsBrief, refreshDailyNewsBrief, startDailyNewsBrief };
