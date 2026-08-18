const axios = require('axios');
const crypto = require('crypto');
const { allUsers } = require('../database/users');
const db = require('../database/db');
const config = require('../config');
const { getBoolSetting } = require('../database/adminControl');

const DEFAULT_CHANNELS = [
  'https://t.me/s/ForexBreakingNews',
  'https://t.me/s/fxstreetforex',
  'https://t.me/s/fbsanalytics',
  'https://t.me/s/brokerexness'
];

const IMPORTANT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY']);

const HIGH_IMPACT_KEYWORDS = [
  'adp','employment','nonfarm','nfp','cpi','inflation','ppi','pce','gdp',
  'fomc','interest rate','rate decision','powell','jobless claims',
  'unemployment','retail sales','durable goods','ism','pmi',
  'consumer confidence','consumer sentiment','jolts','trade balance',
  'import price','import prices','import price index','export price','export prices','export price index',
  'housing starts','building permits','industrial production','capacity utilization',
  'empire state','philadelphia fed','philly fed','business inventories','factory orders',
  'معدل التوظيف','الوظائف','البطالة','التضخم','الفائدة',
  'الناتج المحلي','مبيعات التجزئة','طلبات إعانة البطالة','مديري المشتريات',
  'أسعار الواردات','مؤشر أسعار الواردات','أسعار الصادرات','مؤشر أسعار الصادرات',
  'بدء بناء المنازل','تصاريح البناء','الإنتاج الصناعي','استغلال الطاقة الإنتاجية',
  'ثقة المستهلك','معنويات المستهلك'
];

function channels() {
  const configured = String(process.env.BREAKING_NEWS_CHANNELS || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_CHANNELS;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMessages(html) {
  const results = [];
  const messageRegex = /<div class="tgme_widget_message_wrap[^"]*"[\s\S]*?<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/div>\s*<\/div>/gi;
  let match;
  while ((match = messageRegex.exec(html))) {
    results.push({ postId: match[1], text: stripHtml(match[2]) });
  }
  return results;
}

function isImportantCurrency(currency) {
  return IMPORTANT_CURRENCIES.has(String(currency || '').toUpperCase());
}

function isRelevant(text) {
  const lower = String(text).toLowerCase();
  const currencyRelevant = /(?:USD|EUR|GBP|JPY|XAU|أمريكا|الولايات المتحدة|🇺🇸|الدولار|اليورو|الإسترليني|الين|الذهب)/i.test(text);
  const impactRelevant = HIGH_IMPACT_KEYWORDS.some(keyword => lower.includes(keyword));
  return currencyRelevant && impactRelevant;
}

function cleanMarketing(text) {
  return String(text).split('\n').filter(line => {
    const l = line.toLowerCase();
    return !l.includes('telegram.me/') &&
      !l.includes('t.me/') &&
      !l.includes('انضم للقناة') &&
      !l.includes('لمتابعة') &&
      !l.includes('join');
  }).join('\n').trim();
}

function valueAfter(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[ \\t]*[: ：]?[ \\t]*([^\\n]*)`, 'i');
    const m = text.match(re);
    if (m) {
      const value = m[1].replace(/[✅▪️⭕🟢🔴📈 📉]/g, '').trim();
      if (value) return value;
    }
  }
  return null;
}

function detectCurrency(text) {
  const t = String(text || '');
  if (/Bank of England|\bBoE\b|بنك إنجلترا/i.test(t)) return 'GBP';
  if (/European Central Bank|\bECB\b|المركزي الأوروبي/i.test(t)) return 'EUR';
  if (/Bank of Japan|\bBoJ\b|بنك اليابان/i.test(t)) return 'JPY';
  if (/\bADP\b|\bNFP\b|nonfarm|Federal Reserve|\bFed\b|FOMC|US CPI|U\.S\. CPI|US PPI|U\.S\. PPI|jobless claims|JOLTS|أمريكا|الولايات المتحدة|🇺🇸/i.test(t)) return 'USD';
  if (/GBP|الإسترليني|بريطانيا|🇬🇧/i.test(t)) return 'GBP';
  if (/EUR|اليورو|منطقة اليورو|🇪🇺/i.test(t)) return 'EUR';
  if (/JPY|الين|اليابان|🇯🇵/i.test(t)) return 'JPY';
  if (/USD|الدولار الأمريكي|🇺🇸/i.test(t)) return 'USD';
  return null;
}

function detectEvent(text) {
  const t = String(text || '');
  if (/\bADP\b/i.test(t)) return 'ADP Employment Change';
  if (/\bNFP\b|nonfarm payroll/i.test(t)) return 'Nonfarm Payrolls (NFP)';
  if (/consumer price|\bCPI\b|أسعار المستهلك|التضخم/i.test(t)) return 'Consumer Price Index (CPI)';
  if (/producer price|\bPPI\b/i.test(t)) return 'Producer Price Index (PPI)';
  if (/\bPCE\b|personal consumption/i.test(t)) return 'PCE Inflation';
  if (/\bGDP\b|gross domestic|الناتج المحلي/i.test(t)) return 'GDP';
  if (/Bank of England|\bBoE\b/i.test(t) && /rate|interest|فائدة/i.test(t)) return 'BoE Interest Rate Decision';
  if (/European Central Bank|\bECB\b/i.test(t) && /rate|interest|فائدة/i.test(t)) return 'ECB Interest Rate Decision';
  if (/Bank of Japan|\bBoJ\b/i.test(t) && /rate|interest|فائدة/i.test(t)) return 'BoJ Interest Rate Decision';
  if (/FOMC|Federal Reserve|Fed rate|interest rate decision|قرار الفائدة/i.test(t)) return 'FOMC Interest Rate Decision';
  if (/jobless claims|إعانة البطالة/i.test(t)) return 'Initial Jobless Claims';
  if (/retail sales|مبيعات التجزئة/i.test(t)) return 'Retail Sales';
  if (/durable goods|السلع المعمرة/i.test(t)) return 'Durable Goods Orders';
  if (/ISM.*manufact|manufact.*ISM/i.test(t)) return 'ISM Manufacturing PMI';
  if (/ISM.*service|service.*ISM/i.test(t)) return 'ISM Services PMI';
  if (/\bPMI\b|مديري المشتريات/i.test(t)) return 'PMI';
  if (/JOLTS|job openings/i.test(t)) return 'JOLTS Job Openings';
  if (/import prices?|import price index|أسعار الواردات|مؤشر أسعار الواردات/i.test(t)) return 'Import Price Index';
  if (/export prices?|export price index|أسعار الصادرات|مؤشر أسعار الصادرات/i.test(t)) return 'Export Price Index';
  if (/housing starts|بدء بناء المنازل|بدء بناء المساكن/i.test(t)) return 'Housing Starts';
  if (/building permits|تصاريح البناء/i.test(t)) return 'Building Permits';
  if (/industrial production|الإنتاج الصناعي/i.test(t)) return 'Industrial Production';
  if (/capacity utilization|استغلال الطاقة الإنتاجية|استخدام الطاقة الإنتاجية/i.test(t)) return 'Capacity Utilization';
  if (/consumer sentiment|university of michigan|u\.?s\.? michigan|معنويات المستهلك/i.test(t)) return 'Consumer Sentiment';
  if (/consumer confidence|ثقة المستهلك/i.test(t)) return 'Consumer Confidence';
  if (/empire state|new york fed manufacturing/i.test(t)) return 'Empire State Manufacturing Index';
  if (/philadelphia fed|philly fed/i.test(t)) return 'Philadelphia Fed Manufacturing Index';
  if (/factory orders|طلبات المصانع/i.test(t)) return 'Factory Orders';
  if (/business inventories|مخزونات الأعمال/i.test(t)) return 'Business Inventories';
  if (/unemployment|البطالة/i.test(t)) return 'Unemployment Rate';
  return 'Economic Release';
}

function eventArabic(event) {
  const e = String(event || '');
  const rules = [
    [/Nonfarm Payrolls|\bNFP\b/i, 'الوظائف الأمريكية بالقطاع غير الزراعي (NFP)'],
    [/ADP Employment/i, 'تغير وظائف القطاع الخاص الأمريكي (ADP)'],
    [/Consumer Price Index|\bCPI\b/i, 'مؤشر أسعار المستهلكين (CPI)'],
    [/Producer Price Index|\bPPI\b/i, 'مؤشر أسعار المنتجين (PPI)'],
    [/\bPCE\b|PCE Inflation/i, 'مؤشر التضخم المفضل للفيدرالي (PCE)'],
    [/\bGDP\b/i, 'الناتج المحلي الإجمالي'],
    [/Initial Jobless Claims/i, 'طلبات إعانة البطالة الأمريكية'],
    [/Unemployment Rate/i, 'معدل البطالة'],
    [/Retail Sales/i, 'مبيعات التجزئة'],
    [/Durable Goods Orders/i, 'طلبات السلع المعمرة'],
    [/ISM Manufacturing PMI/i, 'مؤشر مديري المشتريات الصناعي ISM'],
    [/ISM Services PMI/i, 'مؤشر مديري المشتريات الخدمي ISM'],
    [/JOLTS Job Openings/i, 'فرص العمل الشاغرة JOLTS'],
    [/Import Price Index/i, 'مؤشر أسعار الواردات'],
    [/Export Price Index/i, 'مؤشر أسعار الصادرات'],
    [/Housing Starts/i, 'بدء بناء المنازل'],
    [/Building Permits/i, 'تصاريح البناء'],
    [/Industrial Production/i, 'الإنتاج الصناعي'],
    [/Capacity Utilization/i, 'معدل استغلال الطاقة الإنتاجية'],
    [/Consumer Sentiment/i, 'معنويات المستهلك'],
    [/Consumer Confidence/i, 'ثقة المستهلك'],
    [/Empire State Manufacturing Index/i, 'مؤشر إمباير ستيت الصناعي'],
    [/Philadelphia Fed Manufacturing Index/i, 'مؤشر فيلادلفيا الفيدرالي الصناعي'],
    [/Factory Orders/i, 'طلبات المصانع'],
    [/Business Inventories/i, 'مخزونات الأعمال'],
    [/FOMC Interest Rate Decision/i, 'قرار الفائدة للاحتياطي الفيدرالي الأمريكي'],
    [/ECB Interest Rate Decision/i, 'قرار الفائدة للبنك المركزي الأوروبي'],
    [/BoE Interest Rate Decision/i, 'قرار الفائدة لبنك إنجلترا'],
    [/BoJ Interest Rate Decision/i, 'قرار الفائدة لبنك اليابان'],
    [/PMI/i, 'مؤشر مديري المشتريات'],
    [/Economic Release/i, 'بيانات اقتصادية مهمة']
  ];
  for (const [pattern, arabic] of rules) {
    if (pattern.test(e)) return arabic;
  }
  return e;
}

function currencyArabic(currency) {
  const map = {
    USD: '🇺🇸 الدولار الأمريكي',
    EUR: '🇪🇺 اليورو',
    GBP: '🇬🇧 الجنيه الإسترليني',
    JPY: '🇯🇵 الين الياباني'
  };
  return map[String(currency || '').toUpperCase()] || currency || '-';
}

function parseNumeric(value) {
  if (value == null) return null;

  // Telegram economic feeds sometimes format negatives as "%0.4-"
  // instead of "-0.4%". Normalize both forms before comparison.
  let text = String(value)
    .replace(/,/g, '')
    .replace(/[−–—]/g, '-')
    .trim()
    .toUpperCase();

  const trailingNegative = /-\s*%?\s*$/.test(text);
  const m = text.match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;

  let n = Number(m[0]);
  if (!Number.isFinite(n)) return null;

  if (trailingNegative && n > 0) n = -n;
  if (text.includes('K')) n *= 1000;
  if (text.includes('M')) n *= 1000000;

  return n;
}

function inferImpact(event, currency, actual, forecast) {
  const a = parseNumeric(actual);
  const f = parseNumeric(forecast);
  if (!Number.isFinite(a) || !Number.isFinite(f)) return null;

  const inverseEvent = /Unemployment Rate|Jobless Claims/i.test(String(event));
  const positiveForCurrency = inverseEvent ? a < f : a > f;

  if (currency === 'USD') {
    return positiveForCurrency ? 'USD_POSITIVE' : 'USD_NEGATIVE';
  }

  return positiveForCurrency
    ? `${currency}_POSITIVE`
    : `${currency}_NEGATIVE`;
}

function affectedPairs(currency) {
  const map = {
    USD: ['XAUUSD','EURUSD','GBPUSD','USDJPY','BTCUSD'],
    EUR: ['EURUSD','EURJPY'],
    GBP: ['GBPUSD','GBPJPY'],
    JPY: ['USDJPY','EURJPY','GBPJPY']
  };
  return map[currency] || [];
}

function extractNarrativeValues(text) {
  const out = { actual: null, forecast: null, previous: null };
  const t = String(text || '');
  let m = t.match(/came\s+in\s+at\s+([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+vs\.?\s+([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+(?:expected|forecast|consensus)/i);
  if (m) {
    out.actual = m[1];
    out.forecast = m[2];
  }

  if (!out.actual) {
    m = t.match(/(?:reported|printed|released)\s+(?:at\s+)?([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+vs\.?\s+([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+(?:expected|forecast|consensus)/i);
    if (m) {
      out.actual = m[1];
      out.forecast = m[2];
    }
  }

  if (!out.actual) {
    m = t.match(/(?:held|kept|left)\s+(?:its\s+)?(?:cash\s+)?(?:interest\s+)?rate\s+at\s+([+-]?\d[\d,.]*%)/i);
    if (m) out.actual = m[1];
  }

  m = t.match(/previous(?:ly)?\s*(?:at|was|:|—|-)?\s*([+-]?\d[\d,.]*(?:K|M|B|%)?)/i);
  if (m) out.previous = m[1];

  return out;
}

function hasKnownMacroEvent(text) {
  return /\bADP\b|\bNFP\b|nonfarm|consumer price|\bCPI\b|producer price|\bPPI\b|\bPCE\b|\bGDP\b|FOMC|interest rate|rate decision|jobless claims|unemployment|retail sales|durable goods|\bISM\b|\bPMI\b|JOLTS|employment|import prices?|import price index|export prices?|export price index|housing starts|building permits|industrial production|capacity utilization|consumer sentiment|consumer confidence|empire state|philadelphia fed|philly fed|factory orders|business inventories|التوظيف|الوظائف|البطالة|التضخم|الفائدة|الناتج المحلي|مبيعات التجزئة|إعانة البطالة|مديري المشتريات|أسعار الواردات|مؤشر أسعار الواردات|أسعار الصادرات|مؤشر أسعار الصادرات|بدء بناء المنازل|بدء بناء المساكن|تصاريح البناء|الإنتاج الصناعي|استغلال الطاقة الإنتاجية|استخدام الطاقة الإنتاجية|معنويات المستهلك|ثقة المستهلك|طلبات المصانع|مخزونات الأعمال/i.test(text);
}

function isReleasedDataPost(text, actual) {
  if (actual != null && String(actual).trim() !== '') return true;
  return /صدر الآن|released now|came in at|reported at|printed at|actual\s*:|current\s*:|الحالي\s*:|rate decision|kept .*rate at|cut .*rate to|raised .*rate to/i.test(text);
}

function extractEventSpecificValues(text, eventName) {
  const t = String(text || '');
  const e = String(eventName || '');

  function triple(labelPattern) {
    const re = new RegExp(
      labelPattern +
      '[^A-Za-z0-9+\\-]{0,20}Actual\\s*[—:-]?\\s*([+-]?\\d[\\d,.]*(?:K|M|B|%)?)' +
      '[\\s\\S]{0,45}?Expected\\s*[—:-]?\\s*([+-]?\\d[\\d,.]*(?:K|M|B|%)?)' +
      '[\\s\\S]{0,45}?Previous\\s*[—:-]?\\s*([+-]?\\d[\\d,.]*(?:K|M|B|%)?)',
      'i'
    );
    const m = t.match(re);
    return m ? { actual: m[1], forecast: m[2], previous: m[3] } : null;
  }

  if (/Nonfarm Payrolls|\bNFP\b/i.test(e)) {
    let x = triple('(?:\\bNFP\\s*(?:m\\/m)?\\s*:|Nonfarm Payrolls?\\s*:)');
    if (x) return x;
    const m = t.match(/(?:\bNFP\b|nonfarm payrolls?)[^.!?]{0,90}?came\s+in\s+at\s+([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+vs\.?\s+([+-]?\d[\d,.]*(?:K|M|B|%)?)\s+expected/i);
    if (m) return { actual: m[1], forecast: m[2], previous: null };
  }

  if (/ADP Employment/i.test(e)) {
    const x = triple('(?:ADP(?: Employment Change)?\\s*:)');
    if (x) return x;
  }

  if (/Consumer Price Index|CPI/i.test(e)) {
    const x = triple('(?:CPI(?: m\\/m| y\\/y)?\\s*:|Consumer Price Index\\s*:)');
    if (x) return x;
  }

  if (/Producer Price Index|PPI/i.test(e)) {
    const x = triple('(?:PPI(?: m\\/m| y\\/y)?\\s*:|Producer Price Index\\s*:)');
    if (x) return x;
  }

  if (/Unemployment Rate/i.test(e)) {
    const x = triple('(?:Unemployment Rate\\s*:)');
    if (x) return x;
  }

  return null;
}

function isCommentaryOnly(text) {
  const raw = String(text || '').trim();
  const t = raw.replace(/^[^A-Za-z0-9]+/, '').trim();

  if (/^(?:Aftermath|Preview|Outlook|Analysis|Technical Analysis)\b/i.test(t)) {
    return true;
  }

  if (/^Reaction\b/i.test(t)) {
    const hasRelease =
      /came\s+in\s+at\s+[+-]?\d[\d,.]*(?:K|M|B|%)?\s+vs\.?\s+[+-]?\d[\d,.]*(?:K|M|B|%)?\s+expected/i.test(t) ||
      /(?:held|kept|left)\s+(?:its\s+)?(?:cash\s+)?(?:interest\s+)?rate\s+at\s+[+-]?\d[\d,.]*%/i.test(t);
    return !hasRelease;
  }

  return false;
}

function parseBreakingPost(post, sourceUrl = '') {
  const text = cleanMarketing(post.text);

  if (!isRelevant(text)) return null;
  if (!hasKnownMacroEvent(text)) return null;
  if (isCommentaryOnly(text)) return null;

  const currency = detectCurrency(text);
  if (!currency || !isImportantCurrency(currency)) return null;

  const event = detectEvent(text);
  let previous = null;
  let forecast = null;
  let actual = null;

  const specific = extractEventSpecificValues(text, event);

  if (specific) {
    actual = specific.actual;
    forecast = specific.forecast;
    previous = specific.previous;
  } else {
    const narrative = extractNarrativeValues(text);
    actual = narrative.actual;
    forecast = narrative.forecast;
    previous = narrative.previous;

    if (!actual) {
      actual = valueAfter(text, ['الحالي', 'Actual', 'Current']);
    }
    if (!forecast) {
      forecast = valueAfter(text, ['التقدير', 'المتوقع', 'Forecast', 'Consensus']);
    }
    if (!previous) {
      previous = valueAfter(text, ['السابق', 'Previous']);
    }
  }

  if (!isReleasedDataPost(text, actual)) return null;

  const noisyFeed = /fxstreetforex|fbsanalytics/i.test(String(sourceUrl));
  if (noisyFeed && !actual) return null;

  const impact = inferImpact(event, currency, actual, forecast);

  return {
    postId: post.postId,
    sourceUrl,
    currency,
    event,
    previous,
    forecast,
    actual,
    impact,
    pairs: affectedPairs(currency)
  };
}

function eventDedupeKey(item) {
  const day = new Date().toISOString().slice(0, 10);
  const event = String(item.event || 'Economic Release')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .slice(0, 80);
  const currency = String(item.currency || 'NA').toUpperCase();
  const actual = String(item.actual || 'NA')
    .toUpperCase()
    .replace(/\s+/g, '');

  return `breaking_event_${crypto
    .createHash('sha1')
    .update(`${day}|${currency}|${event}|${actual}`)
    .digest('hex')
    .slice(0, 20)}`;
}

function dedupeKey(item) {
  return `breaking_${crypto
    .createHash('sha1')
    .update(String(item.postId))
    .digest('hex')
    .slice(0, 20)}`;
}

function alreadySent(key) {
  return Boolean(
    db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key)
  );
}

function markSent(key) {
  db.prepare(
    'INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)'
  ).run(key);
}

function recipients() {
  const ids = new Set();

  for (const user of allUsers()) {
    ids.add(String(user.telegram_id));
  }

  for (const adminId of config.adminIds || []) {
    ids.add(String(adminId));
  }

  if (config.mainGroupId) {
    ids.add(String(config.mainGroupId));
  }

  return [...ids];
}

function impactText(item) {
  switch (item.impact) {
    case 'USD_NEGATIVE':
      return '📉 القراءة الأولية: سلبية للدولار الأمريكي\n📈 وقد تكون داعمة للذهب';
    case 'USD_POSITIVE':
      return '📈 القراءة الأولية: إيجابية للدولار الأمريكي\n📉 وقد تضغط على الذهب';
    case 'EUR_POSITIVE':
      return '📈 القراءة الأولية: إيجابية لليورو';
    case 'EUR_NEGATIVE':
      return '📉 القراءة الأولية: سلبية لليورو';
    case 'GBP_POSITIVE':
      return '📈 القراءة الأولية: إيجابية للجنيه الإسترليني';
    case 'GBP_NEGATIVE':
      return '📉 القراءة الأولية: سلبية للجنيه الإسترليني';
    case 'JPY_POSITIVE':
      return '📈 القراءة الأولية: إيجابية للين الياباني';
    case 'JPY_NEGATIVE':
      return '📉 القراءة الأولية: سلبية للين الياباني';
    default:
      return '⚠️ يحتاج السوق إلى تقييم رد الفعل الفعلي بعد الإصدار';
  }
}

function message(item) {
  return `🟥 <b>صدر الآن — خبر اقتصادي مهم</b>

💱 العملة:
<b>${currencyArabic(item.currency)}</b>

📰 الخبر:
<b>${eventArabic(item.event)}</b>

📊 <b>بيانات الخبر</b>

▪️ السابق: ${item.previous || '-'}
▪️ المتوقع: ${item.forecast || '-'}
✅ الفعلي: ${item.actual || '-'}

${impactText(item)}

🎯 <b>الأصول المتأثرة</b>
${item.pairs.length ? item.pairs.join(', ') : '-'}

⚠️ قراءة الخبر لا تضمن اتجاه السعر، وقد تختلف استجابة السوق بسبب التسعير المسبق أو تفاصيل الإصدار.

🤖 Forex AI Bot`;
}

async function broadcast(bot, text) {
  for (const chatId of recipients()) {
    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (error) {
      console.log(`Breaking news send failed ${chatId}:`, error.message);
    }
  }
}

async function fetchChannel(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ForexAIBot/1.0)'
    }
  });

  return extractMessages(data);
}

async function checkBreakingNews(bot) {
  if (!getBoolSetting('breaking_news_enabled', true)) {
    console.log('⏸️ Breaking News disabled from Admin Control Center');
    return;
  }

  for (const url of channels()) {
    try {
      const posts = await fetchChannel(url);

      for (const post of posts.slice(-12)) {
        const item = parseBreakingPost(post, url);
        if (!item) continue;

        const key = dedupeKey(item);
        const eventKey = eventDedupeKey(item);

        if (alreadySent(key) || alreadySent(eventKey)) continue;

        markSent(key);
        markSent(eventKey);

        await broadcast(bot, message(item));
        console.log(`🟥 Breaking economic news sent: ${item.event}`);
      }
    } catch (error) {
      console.log(
        `⚠️ Breaking news source failed ${url}:`,
        error.response?.status || '',
        error.message
      );
    }
  }
}

async function seedBaseline() {
  for (const url of channels()) {
    const posts = await fetchChannel(url);

    for (const post of posts.slice(-12)) {
      const item = parseBreakingPost(post, url);
      if (!item) continue;

      const key = dedupeKey(item);
      const eventKey = eventDedupeKey(item);

      if (!alreadySent(key)) markSent(key);
      if (!alreadySent(eventKey)) markSent(eventKey);
    }
  }
}

function startBreakingNews(bot) {
  const intervalMs =
    Number(process.env.BREAKING_NEWS_INTERVAL_MS) || 60 * 1000;

  setTimeout(async () => {
    try {
      await seedBaseline();
      console.log('📰 Breaking news baseline initialized');
    } catch (error) {
      console.log('Breaking news baseline error:', error.message);
    }

    setInterval(() => {
      checkBreakingNews(bot).catch(error =>
        console.log('Breaking news loop error:', error.message)
      );
    }, intervalMs);

    console.log(
      `🟥 Breaking News Watch every ${Math.round(intervalMs / 1000)} seconds`
    );
  }, 5000);
}

module.exports = {
  checkBreakingNews,
  startBreakingNews,
  parseBreakingPost
};
