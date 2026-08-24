const axios = require('axios');

const translations = {
  'Federal Reserve': 'الاحتياطي الفيدرالي الأمريكي',
  'Interest Rates': 'أسعار الفائدة',
  'Interest Rate': 'قرار الفائدة',
  'CPI': 'مؤشر أسعار المستهلكين',
  'Inflation': 'التضخم',
  'NFP': 'تقرير الوظائف الأمريكي',
  'Non Farm Payrolls': 'الوظائف غير الزراعية',
  'Non-Farm Payrolls': 'الوظائف غير الزراعية',
  'GDP': 'الناتج المحلي الإجمالي',
  'Unemployment': 'البطالة',
  'FOMC': 'الفيدرالي الأمريكي',
  'European Central Bank': 'البنك المركزي الأوروبي',
  'Bank of England': 'بنك إنجلترا',
  'Bank of Japan': 'بنك اليابان',
  'Treasury': 'وزارة الخزانة',
  'Retail Sales': 'مبيعات التجزئة',
  'Consumer Confidence': 'ثقة المستهلك',
  'Consumer Sentiment': 'معنويات المستهلك',
  'Producer Price Index': 'مؤشر أسعار المنتجين',
  'Consumer Price Index': 'مؤشر أسعار المستهلكين',
  'Jobless Claims': 'طلبات إعانة البطالة',
  'PMI': 'مؤشر مديري المشتريات',
  'tariffs': 'الرسوم الجمركية',
  'tariff': 'الرسوم الجمركية',

  // Common crypto / market-news vocabulary. Keeping project names, tickers and
  // numbers untouched gives readable Arabic without calling a remote translator.
  'Bitcoin': 'بيتكوين',
  'Ethereum': 'إيثريوم',
  'crypto market': 'سوق العملات الرقمية',
  'crypto markets': 'أسواق العملات الرقمية',
  'cryptocurrency': 'العملات الرقمية',
  'cryptocurrencies': 'العملات الرقمية',
  'stablecoin': 'عملة مستقرة',
  'stablecoins': 'عملات مستقرة',
  'exchange': 'منصة تداول',
  'exchanges': 'منصات التداول',
  'ETF': 'صندوق متداول',
  'ETFs': 'صناديق متداولة',
  'hack': 'اختراق',
  'hacked': 'تعرّض للاختراق',
  'hacker': 'مخترق',
  'hackers': 'مخترقون',
  'exploit': 'ثغرة',
  'exploits': 'ثغرات',
  'security breach': 'اختراق أمني',
  'breach': 'اختراق',
  'attack': 'هجوم',
  'attacks': 'هجمات',
  'vault': 'خزينة',
  'governance': 'الحوكمة',
  'protocol': 'بروتوكول',
  'network': 'شبكة',
  'blockchain': 'بلوكتشين',
  'wallet': 'محفظة',
  'wallets': 'محافظ',
  'token': 'عملة رقمية',
  'tokens': 'عملات رقمية',
  'price': 'سعر',
  'prices': 'الأسعار',
  'rises': 'يرتفع',
  'rise': 'ارتفاع',
  'surges': 'يقفز',
  'surge': 'قفزة',
  'jumps': 'يقفز',
  'jump': 'قفزة',
  'gains': 'مكاسب',
  'gain': 'مكسب',
  'falls': 'يتراجع',
  'fall': 'تراجع',
  'drops': 'ينخفض',
  'drop': 'انخفاض',
  'slumps': 'يهوي',
  'slump': 'هبوط حاد',
  'loses': 'يخسر',
  'lost': 'خسر',
  'losses': 'خسائر',
  'loss': 'خسارة',
  'estimated': 'تُقدّر بنحو',
  'million': 'مليون',
  'billion': 'مليار',
  'trillion': 'تريليون',
  'investors': 'المستثمرون',
  'investor': 'مستثمر',
  'traders': 'المتداولون',
  'trader': 'متداول',
  'regulation': 'التنظيم',
  'regulator': 'الجهة التنظيمية',
  'regulators': 'الجهات التنظيمية',
  'approval': 'موافقة',
  'approved': 'تمت الموافقة على',
  'launches': 'يطلق',
  'launch': 'إطلاق',
  'announces': 'يعلن',
  'announced': 'أعلن',
  'announcement': 'إعلان',
  'partnership': 'شراكة',
  'acquisition': 'استحواذ',
  'lawsuit': 'دعوى قضائية',
  'settlement': 'تسوية',
  'liquidation': 'تصفية',
  'liquidations': 'تصفيات',
  'volume': 'حجم التداول',
  'market cap': 'القيمة السوقية',
  'record high': 'مستوى قياسي',
  'all-time high': 'أعلى مستوى تاريخي',
  'record low': 'مستوى قياسي منخفض'
};

const cache = new Map();
const CACHE_LIMIT = 800;
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NEWS_TRANSLATE_MIN_INTERVAL_MS) || 5000;
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.NEWS_TRANSLATE_429_COOLDOWN_MS) || 30 * 60 * 1000;

let translateQueue = Promise.resolve();
let lastRemoteRequestAt = 0;
let rateLimitUntil = 0;
let rateLimitLogged = false;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translateNews(text) {
  let result = String(text || '');

  // Longest phrases first so "Interest Rates" is not partially consumed by
  // "Interest Rate", and multi-word market terms stay natural.
  const entries = Object.entries(translations)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, value] of entries) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi'), value);
  }

  return result
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text || ''));
}

function cleanForTranslation(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\bRead\s+More\s*👈?/gi, '')
    .replace(/\bRead\s+More\b/gi, '')
    .replace(/Telegram\.me\/\S+/gi, '')
    .replace(/t\.me\/\S+/gi, '')
    .replace(/\s*\.\.\.\s*$/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, value);
}

function localTranslation(clean) {
  const local = translateNews(clean);
  if (local && hasArabic(local)) {
    cacheSet(clean, local);
    return local;
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function remoteTranslate(clean) {
  if (Date.now() < rateLimitUntil) {
    return localTranslation(clean);
  }

  const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRemoteRequestAt));
  if (waitMs > 0) await sleep(waitMs);
  lastRemoteRequestAt = Date.now();

  try {
    const { data } = await axios.get(
      'https://translate.googleapis.com/translate_a/single',
      {
        timeout: Number(process.env.NEWS_TRANSLATE_TIMEOUT_MS) || 8000,
        params: {
          client: 'gtx',
          sl: 'auto',
          tl: 'ar',
          dt: 't',
          q: clean
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ForexAIBot/1.0)'
        }
      }
    );

    const translated = Array.isArray(data?.[0])
      ? data[0]
          .map(part => Array.isArray(part) ? part[0] : '')
          .filter(Boolean)
          .join('')
          .trim()
      : '';

    if (!translated || !hasArabic(translated)) {
      throw new Error('Translation returned no Arabic text');
    }

    rateLimitLogged = false;
    cacheSet(clean, translated);
    return translated;
  } catch (error) {
    const status = Number(error.response?.status || 0);

    if (status === 429) {
      rateLimitUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      if (!rateLimitLogged) {
        rateLimitLogged = true;
        console.log(
          `⚠️ News translation remote cooldown ${Math.round(RATE_LIMIT_COOLDOWN_MS / 60000)}m; local Arabic fallback active`
        );
      }
    } else {
      console.log('⚠️ News Arabic translation failed:', error.message);
    }

    return localTranslation(clean);
  }
}

async function translateToArabic(text) {
  const clean = cleanForTranslation(text);
  if (!clean) return '';

  if (hasArabic(clean) && !/[A-Za-z]{25,}/.test(clean)) {
    return clean;
  }

  if (cache.has(clean)) return cache.get(clean);

  // Most economic and crypto headlines are handled locally first. This avoids
  // unnecessary external calls and makes translation deterministic during
  // provider outages/rate limits.
  const local = localTranslation(clean);
  if (local) return local;

  if (Date.now() < rateLimitUntil) return null;

  const task = translateQueue.then(() => {
    if (cache.has(clean)) return cache.get(clean);
    const again = localTranslation(clean);
    if (again) return again;
    return remoteTranslate(clean);
  });

  translateQueue = task.catch(() => null);
  return task;
}

module.exports = {
  translateNews,
  translateToArabic,
  cleanForTranslation
};
