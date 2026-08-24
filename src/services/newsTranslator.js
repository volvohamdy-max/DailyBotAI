const axios = require('axios');

const translations = {
  'Federal Reserve': 'الاحتياطي الفيدرالي الأمريكي',
  'Interest Rate': 'قرار الفائدة',
  'Interest Rates': 'أسعار الفائدة',
  'CPI': 'مؤشر أسعار المستهلكين',
  'Inflation': 'التضخم',
  'NFP': 'تقرير الوظائف الأمريكي',
  'Non Farm Payrolls': 'الوظائف غير الزراعية',
  'GDP': 'الناتج المحلي الإجمالي',
  'Unemployment': 'معدل البطالة',
  'FOMC': 'اجتماع الفيدرالي الأمريكي',
  'European Central Bank': 'البنك المركزي الأوروبي',
  'Bank of England': 'بنك إنجلترا',
  'Bank of Japan': 'بنك اليابان',
  'Treasury': 'وزارة الخزانة',
  'tariffs': 'الرسوم الجمركية',
  'tariff': 'الرسوم الجمركية'
};

const cache = new Map();
const CACHE_LIMIT = 400;
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NEWS_TRANSLATE_MIN_INTERVAL_MS) || 1200;
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.NEWS_TRANSLATE_429_COOLDOWN_MS) || 5 * 60 * 1000;

let translateQueue = Promise.resolve();
let lastRemoteRequestAt = 0;
let rateLimitUntil = 0;

function translateNews(text) {
  let result = String(text || '');

  for (const key in translations) {
    result = result.replace(
      new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      translations[key]
    );
  }

  return result;
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

function deterministicFallback(clean) {
  const fallback = translateNews(clean);
  if (hasArabic(fallback)) {
    cacheSet(clean, fallback);
    return fallback;
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function remoteTranslate(clean) {
  if (Date.now() < rateLimitUntil) {
    return deterministicFallback(clean);
  }

  const waitMs = Math.max(
    0,
    MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRemoteRequestAt)
  );
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

    cacheSet(clean, translated);
    return translated;
  } catch (error) {
    const status = Number(error.response?.status || 0);

    if (status === 429) {
      rateLimitUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      console.log(
        `⚠️ News Arabic translation rate-limited; cooldown ${Math.round(RATE_LIMIT_COOLDOWN_MS / 60000)}m`
      );
    } else {
      console.log('⚠️ News Arabic translation failed:', error.message);
    }

    return deterministicFallback(clean);
  }
}

async function translateToArabic(text) {
  const clean = cleanForTranslation(text);
  if (!clean) return '';

  // If the feed is already Arabic, do not rewrite it.
  if (hasArabic(clean) && !/[A-Za-z]{25,}/.test(clean)) {
    return clean;
  }

  if (cache.has(clean)) return cache.get(clean);

  // During a 429 cooldown, do not keep hitting the public Google endpoint.
  if (Date.now() < rateLimitUntil) {
    return deterministicFallback(clean);
  }

  // Serialize remote translations and space them out. This prevents a burst of
  // several news feeds/calendars from triggering Google's 429 protection.
  const task = translateQueue.then(() => {
    if (cache.has(clean)) return cache.get(clean);
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
