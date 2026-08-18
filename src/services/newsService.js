const db = require('../database/db');
const config = require('../config');
const { translateNews, translateToArabic } = require('./newsTranslator');
const { analyzeNews } = require('../ai/newsAI');
const {
  getMultiSourceCalendar,
  isHighImpact,
  eventHash,
  affectedPairs
} = require('./newsCalendarGate');
const { getInvestingFallback } = require('./investingFallback');

function newsGroupId() {
  const id = config.mainGroupId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

async function broadcast(bot, message) {
  const chatId = newsGroupId();

  if (!chatId) {
    console.log('⚠️ News not sent: MAIN_GROUP_ID is not configured');
    return;
  }

  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.log(`News group send failed ${chatId}:`, error.message);
  }
}

function seen(key) {
  return Boolean(
    db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key)
  );
}

function mark(key) {
  db.prepare(
    'INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)'
  ).run(key);
}

function sourceLine(event) {
  return event.sourceCount >= 2
    ? `✅ مؤكد من ${event.sourceCount} مصادر`
    : `⚠️ متاح من مصدر واحد`;
}

function assetsLine(event) {
  const pairs = affectedPairs(event);
  return pairs.length ? pairs.join(', ') : '—';
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

// ==========================================
// العملات الرئيسية التي يهتم بها البوت
// ==========================================

const IMPORTANT_NEWS_CURRENCIES =
  new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF']);

function isImportantCurrency(event) {
  return IMPORTANT_NEWS_CURRENCIES.has(
    String(event.currency || '').toUpperCase()
  );
}

function currencyArabic(currency) {
  const code =
    String(currency || '').toUpperCase();

  const names = {
    USD: '🇺🇸 الدولار الأمريكي',
    EUR: '🇪🇺 اليورو',
    GBP: '🇬🇧 الجنيه الإسترليني',
    JPY: '🇯🇵 الين الياباني',
    CHF: '🇨🇭 الفرنك السويسري'
  };

  return names[code] || code || '-';
}

// ==========================================
// ترجمة أهم الأخبار الاقتصادية
// ==========================================

function translateNewsArabic(title) {
  const raw = String(title || '').trim();
  const t = raw.toLowerCase();

  const rules = [
    ['consumer price index', 'مؤشر أسعار المستهلكين'],
    ['core consumer price index', 'مؤشر أسعار المستهلكين الأساسي'],
    ['core cpi', 'مؤشر أسعار المستهلكين الأساسي'],
    ['cpi', 'مؤشر أسعار المستهلكين'],

    ['producer price index', 'مؤشر أسعار المنتجين'],
    ['core ppi', 'مؤشر أسعار المنتجين الأساسي'],
    ['ppi', 'مؤشر أسعار المنتجين'],

    ['nonfarm payrolls', 'الوظائف غير الزراعية'],
    ['non-farm payrolls', 'الوظائف غير الزراعية'],
    ['non farm payrolls', 'الوظائف غير الزراعية'],
    ['nfp', 'الوظائف غير الزراعية'],

    ['unemployment rate', 'معدل البطالة'],
    ['unemployment claims', 'طلبات إعانة البطالة'],
    ['initial jobless claims', 'طلبات إعانة البطالة الأولية'],
    ['jobless claims', 'طلبات إعانة البطالة'],

    ['average hourly earnings', 'متوسط الأجور في الساعة'],
    ['employment change', 'التغير في التوظيف'],

    ['gross domestic product', 'الناتج المحلي الإجمالي'],
    ['gdp', 'الناتج المحلي الإجمالي'],

    ['retail sales', 'مبيعات التجزئة'],
    ['core retail sales', 'مبيعات التجزئة الأساسية'],

    ['interest rate decision', 'قرار سعر الفائدة'],
    ['interest rate', 'سعر الفائدة'],
    ['rate decision', 'قرار سعر الفائدة'],

    ['fomc statement', 'بيان الاحتياطي الفيدرالي'],
    ['fomc minutes', 'محضر اجتماع الاحتياطي الفيدرالي'],
    ['fed chair', 'رئيس الاحتياطي الفيدرالي'],
    ['federal reserve', 'الاحتياطي الفيدرالي'],

    ['ecb interest rate decision', 'قرار البنك المركزي الأوروبي بشأن الفائدة'],
    ['ecb press conference', 'المؤتمر الصحفي للبنك المركزي الأوروبي'],
    ['ecb', 'البنك المركزي الأوروبي'],

    ['boe interest rate decision', 'قرار بنك إنجلترا بشأن الفائدة'],
    ['bank of england', 'بنك إنجلترا'],
    ['boe', 'بنك إنجلترا'],

    ['boj interest rate decision', 'قرار بنك اليابان بشأن الفائدة'],
    ['bank of japan', 'بنك اليابان'],
    ['boj', 'بنك اليابان'],

    ['manufacturing pmi', 'مؤشر مديري المشتريات الصناعي'],
    ['services pmi', 'مؤشر مديري المشتريات الخدمي'],
    ['composite pmi', 'مؤشر مديري المشتريات المركب'],
    ['pmi', 'مؤشر مديري المشتريات'],

    ['ism manufacturing', 'مؤشر ISM الصناعي'],
    ['ism services', 'مؤشر ISM الخدمي'],

    ['consumer confidence', 'ثقة المستهلك'],
    ['consumer sentiment', 'معنويات المستهلك'],
    ['business confidence', 'ثقة الأعمال'],

    ['industrial production', 'الإنتاج الصناعي'],
    ['manufacturing production', 'الإنتاج التصنيعي'],

    ['trade balance', 'الميزان التجاري'],
    ['current account', 'الحساب الجاري'],

    ['durable goods orders', 'طلبات السلع المعمرة'],
    ['factory orders', 'طلبات المصانع'],

    ['housing starts', 'بدء بناء المنازل'],
    ['building permits', 'تصاريح البناء'],
    ['existing home sales', 'مبيعات المنازل القائمة'],
    ['new home sales', 'مبيعات المنازل الجديدة'],

    ['wage growth', 'نمو الأجور'],
    ['inflation rate', 'معدل التضخم']
  ];

  for (const [english, arabic] of rules) {
    if (t.includes(english)) {
      return arabic;
    }
  }

  // لو عندك translateNews القديمة وترجمت العنوان بالفعل
  try {
    const translated = translateNews(raw);

    if (
      translated &&
      translated !== raw
    ) {
      return translated;
    }
  } catch {}

  // ما نعرضش عنوان إنجليزي طويل للمستخدم
  return 'خبر اقتصادي مهم';
}



async function translatedEconomicTitle(title) {
  const local = translateNewsArabic(title);

  // Known calendar events already have curated Arabic wording.
  if (local && local !== 'خبر اقتصادي مهم') return local;

  const translated = await translateToArabic(title);
  return translated || 'خبر اقتصادي مهم';
}



function isImportantNewsCurrency(event) {
  return IMPORTANT_NEWS_CURRENCIES.has(
    String(event.currency || '').toUpperCase()
  );
}

function translateEconomicTitle(title) {
  const raw = String(title || '').trim();
  const t = raw.toLowerCase();

  const rules = [
    ['core consumer price index', 'مؤشر أسعار المستهلكين الأساسي'],
    ['consumer price index', 'مؤشر أسعار المستهلكين'],
    ['core cpi', 'مؤشر أسعار المستهلكين الأساسي'],
    ['cpi', 'مؤشر أسعار المستهلكين'],

    ['core producer price index', 'مؤشر أسعار المنتجين الأساسي'],
    ['producer price index', 'مؤشر أسعار المنتجين'],
    ['core ppi', 'مؤشر أسعار المنتجين الأساسي'],
    ['ppi', 'مؤشر أسعار المنتجين'],

    ['nonfarm payrolls', 'الوظائف غير الزراعية'],
    ['non-farm payrolls', 'الوظائف غير الزراعية'],
    ['non farm payrolls', 'الوظائف غير الزراعية'],
    ['nfp', 'الوظائف غير الزراعية'],

    ['unemployment rate', 'معدل البطالة'],
    ['initial jobless claims', 'طلبات إعانة البطالة الأولية'],
    ['jobless claims', 'طلبات إعانة البطالة'],
    ['unemployment claims', 'طلبات إعانة البطالة'],

    ['average hourly earnings', 'متوسط الأجور في الساعة'],
    ['employment change', 'التغير في التوظيف'],

    ['gross domestic product', 'الناتج المحلي الإجمالي'],
    ['gdp', 'الناتج المحلي الإجمالي'],

    ['core retail sales', 'مبيعات التجزئة الأساسية'],
    ['retail sales', 'مبيعات التجزئة'],

    ['interest rate decision', 'قرار سعر الفائدة'],
    ['rate decision', 'قرار سعر الفائدة'],

    ['fomc statement', 'بيان الاحتياطي الفيدرالي'],
    ['fomc minutes', 'محضر اجتماع الاحتياطي الفيدرالي'],
    ['federal reserve', 'الاحتياطي الفيدرالي'],

    ['ecb press conference', 'المؤتمر الصحفي للبنك المركزي الأوروبي'],
    ['ecb interest rate', 'قرار فائدة البنك المركزي الأوروبي'],

    ['boe interest rate', 'قرار فائدة بنك إنجلترا'],
    ['bank of england', 'بنك إنجلترا'],

    ['boj interest rate', 'قرار فائدة بنك اليابان'],
    ['bank of japan', 'بنك اليابان'],

    ['manufacturing pmi', 'مؤشر مديري المشتريات الصناعي'],
    ['services pmi', 'مؤشر مديري المشتريات الخدمي'],
    ['composite pmi', 'مؤشر مديري المشتريات المركب'],
    ['pmi', 'مؤشر مديري المشتريات'],

    ['ism manufacturing', 'مؤشر ISM الصناعي'],
    ['ism services', 'مؤشر ISM الخدمي'],

    ['consumer confidence', 'ثقة المستهلك'],
    ['consumer sentiment', 'معنويات المستهلك'],

    ['industrial production', 'الإنتاج الصناعي'],
    ['manufacturing production', 'الإنتاج التصنيعي'],

    ['trade balance', 'الميزان التجاري'],
    ['current account', 'الحساب الجاري'],

    ['durable goods orders', 'طلبات السلع المعمرة'],
    ['factory orders', 'طلبات المصانع'],

    ['housing starts', 'بدء بناء المنازل'],
    ['building permits', 'تصاريح البناء'],
    ['existing home sales', 'مبيعات المنازل القائمة'],
    ['new home sales', 'مبيعات المنازل الجديدة'],

    ['inflation rate', 'معدل التضخم'],
    ['wage growth', 'نمو الأجور']
  ];

  for (const [en, ar] of rules) {
    if (t.includes(en)) {
      return ar;
    }
  }

  try {
    const translated = translateNews(raw);

    if (
      translated &&
      translated !== raw
    ) {
      return translated;
    }
  } catch {}

  return 'خبر اقتصادي مهم';
}

function assetsArabic(event) {
  const c =
    String(event.currency || '').toUpperCase();

  if (c === 'USD') {
    return `🥇 الذهب XAUUSD
💵 الدولار الأمريكي
🇪🇺 EURUSD
🇬🇧 GBPUSD
🇯🇵 USDJPY`;
  }

  if (c === 'EUR') {
    return `🇪🇺 اليورو
📊 EURUSD
📊 EURJPY
📊 EURGBP`;
  }

  if (c === 'GBP') {
    return `🇬🇧 الجنيه الإسترليني
📊 GBPUSD
📊 GBPJPY
📊 EURGBP`;
  }

  if (c === 'JPY') {
    return `🇯🇵 الين الياباني
📊 USDJPY
📊 EURJPY
📊 GBPJPY`;
  }

  return assetsLine(event);
}


function isValidEconomicActual(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  const text =
    String(value).trim();

  if (
    !text ||
    text === '-' ||
    text.length > 80
  ) {
    return false;
  }

  /*
   * Economic releases are normally numeric:
   * 3.75%
   * 250K
   * -0.2%
   * 4.1
   * $12.3B
   *
   * Reject article paragraphs / outlook text.
   */
  return /[-+]?\d/.test(text);
}


function buildNewsAnalysisPrompt(event) {
  return `
حلل الخبر الاقتصادي التالي باللغة العربية فقط وباختصار.

العملة:
${event.currency || '-'}

الخبر:
${event.title || '-'}

Actual:
${event.actual ?? '-'}

Forecast:
${event.forecast ?? '-'}

Previous:
${event.previous ?? '-'}

المطلوب:
- هل النتيجة أقوى أم أضعف من المتوقع؟
- التأثير المحتمل على العملة.
- إذا كانت العملة USD اذكر التأثير المحتمل على الذهب XAUUSD.
- لا تعط ضمان ربح.
- اجعل الإجابة في 3 إلى 5 سطور واضحة.
`.trim();
}


async function checkUpcomingNews(bot) {
  const { data, providers } = await getMultiSourceCalendar();

  if (!providers.length) {
    console.log('⚠️ No economic-calendar provider available');
    return;
  }

  for (const event of data) {
    if (!isImportantCurrency(event)) continue;
    if (!isHighImpact(event)) continue;

    const diff = minutesUntil(event);
    const id = eventHash(event);

    let stage = null;
    let label = null;

    if (diff > 27 && diff <= 33) {
      stage = '30m';
      label = '30 دقيقة';
    } else if (diff > 3 && diff <= 7) {
      stage = '5m';
      label = '5 دقائق';
    }

    if (!stage) continue;

    const key = `news_${stage}_${id}`;
    if (seen(key)) continue;

    mark(key);

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

    await broadcast(bot, message);
    console.log(`✅ Upcoming news ${stage}: ${event.title}`);
  }
}

async function checkEconomicNews(bot) {
  const { data, providers } = await getMultiSourceCalendar();

  if (!providers.length) return;

  for (const event of data) {
    if (!isImportantCurrency(event)) continue;
    if (!isHighImpact(event)) continue;

    const diff = minutesUntil(event);

    // Keep retrying release-data providers for up to 30 minutes.
    // No release message is sent until Actual exists.
    if (!(diff <= 0 && diff >= -30)) continue;

    const id = eventHash(event);
    const key = `news_released_${id}`;

    if (seen(key)) continue;

    // ==========================================
    // RELEASE DATA PROTECTION
    // Do not send the release until Actual exists.
    // Force-refresh providers because the normal
    // calendar cache may still contain pre-release data.
    // ==========================================

    const hasValue = (value) =>
      isValidEconomicActual(value);

    if (!hasValue(event.actual)) {
      console.log(
        `⏳ Released news waiting for Actual: ${event.title}`
      );

      try {
        const refreshed =
          await getMultiSourceCalendar(true);

        const normalize = (text) =>
          String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const targetTitle = normalize(event.title);

        const freshEvent = refreshed.data.find((candidate) => {
          if (
            String(candidate.currency || '').toUpperCase() !==
            String(event.currency || '').toUpperCase()
          ) {
            return false;
          }

          const candidateTitle = normalize(candidate.title);

          if (
            candidateTitle !== targetTitle &&
            !candidateTitle.includes(targetTitle) &&
            !targetTitle.includes(candidateTitle)
          ) {
            return false;
          }

          const a = new Date(candidate.date).getTime();
          const b = new Date(event.date).getTime();

          return (
            Number.isFinite(a) &&
            Number.isFinite(b) &&
            Math.abs(a - b) <= 15 * 60 * 1000
          );
        });

        if (freshEvent) {
          event.actual =
            freshEvent.actual ?? event.actual;

          event.forecast =
            freshEvent.forecast ?? event.forecast;

          event.previous =
            freshEvent.previous ?? event.previous;

          event.sources =
            freshEvent.sources ?? event.sources;

          event.sourceCount =
            freshEvent.sourceCount ?? event.sourceCount;
        }

      } catch (refreshError) {
        console.log(
          '⚠️ Released-news refresh failed:',
          refreshError.message
        );
      }

      
    // ==========================================
    // INVESTING.COM FALLBACK
    // Only used when primary providers still
    // have no Actual after force refresh.
    // ==========================================

    if (!hasValue(event.actual)) {
      try {
        console.log(
          `🌐 Trying Investing fallback: ${event.title}`
        );

        const investing =
          await getInvestingFallback(event);

        if (investing) {
          event.actual =
            investing.actual ?? event.actual;

          event.forecast =
            investing.forecast ?? event.forecast;

          event.previous =
            investing.previous ?? event.previous;

          if (hasValue(event.actual)) {
            console.log(
              `🟢 Investing fallback matched: ${event.title} | Actual=${event.actual}`
            );
          } else {
            console.log(
              `🟡 Investing matched but Actual still missing: ${event.title}`
            );
          }
        } else {
          console.log(
            `🟡 Investing fallback no match: ${event.title}`
          );
        }

      } catch (error) {
        console.log(
          '⚠️ Investing fallback error:',
          error.response?.status || '',
          error.message
        );
      }
    }

if (!hasValue(event.actual)) {
        console.log(
          `⏳ Actual still unavailable, release deferred: ${event.title}`
        );

        // IMPORTANT:
        // Do NOT mark as seen.
        // Next news cycle will retry.
        continue;
      }
    }

    // Only mark once we have real release data.
    mark(key);

    let ai = '';
    try {
      ai = await analyzeNews(
        buildNewsAnalysisPrompt(event)
      );
    } catch (error) {
      console.log('News AI analysis failed:', error.message);
    }

    const message = `
✅ <b>صدر الخبر الاقتصادي</b>

💱 العملة: <b>${currencyArabic(event.currency)}</b>
📰 الخبر: <b>${await translatedEconomicTitle(event.title)}</b>

📊 الفعلي: ${event.actual ?? '-'}
📈 المتوقع: ${event.forecast ?? '-'}
📉 السابق: ${event.previous ?? '-'}

📊 الأصول المتأثرة:
${assetsArabic(event)}

${sourceLine(event)}

${ai ? `🤖 تحليل AI:\n${ai}\n` : ''}
⚠️ يفضل انتظار هدوء الحركة وإعادة تقييم السوق بعد الخبر.

#forexNews
@Forexaitrade_bot
`;

    await broadcast(bot, message);
    console.log(`✅ Released news sent: ${event.title}`);
  }
}

async function getEconomicCalendar() {
  const { data } = await getMultiSourceCalendar();
  return data;
}

module.exports = {
  checkEconomicNews,
  checkUpcomingNews,
  getEconomicCalendar
};
