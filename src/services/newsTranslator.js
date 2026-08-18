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

async function translateToArabic(text) {
  const clean = cleanForTranslation(text);
  if (!clean) return '';

  // If the feed is already Arabic, do not rewrite it.
  if (hasArabic(clean) && !/[A-Za-z]{25,}/.test(clean)) {
    return clean;
  }

  if (cache.has(clean)) return cache.get(clean);

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
    console.log('⚠️ News Arabic translation failed:', error.message);

    // Deterministic fallback for short titles. Never publish a long raw
    // English article as if it were Arabic.
    const fallback = translateNews(clean);
    if (hasArabic(fallback)) {
      cacheSet(clean, fallback);
      return fallback;
    }

    return null;
  }
}

module.exports = {
  translateNews,
  translateToArabic,
  cleanForTranslation
};
