const axios = require('axios');

const BASE_URL = 'https://www.investing.com/economic-calendar';

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(final|prelim|preliminary|revised|flash)\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countryToCurrency(text) {
  const t = String(text || '').toUpperCase();
  if (/\bUSD\b|\bUS\b|UNITED STATES/.test(t)) return 'USD';
  if (/\bEUR\b|EURO|GERMAN|FRANCE|ITALY|SPAIN/.test(t)) return 'EUR';
  if (/\bGBP\b|UNITED KINGDOM|\bUK\b/.test(t)) return 'GBP';
  if (/\bJPY\b|JAPAN/.test(t)) return 'JPY';
  if (/\bCHF\b|SWITZERLAND|SWISS/.test(t)) return 'CHF';
  return null;
}

// Economic values must be a compact numeric token, never article prose.
// Examples accepted: -0.2%, 3.5, 250K, 1.2B, $12.3B, 4.50%
function validEconomicValue(value) {
  if (value == null) return false;
  const s = cleanText(value);
  if (!s || s === '-' || s.length > 24) return false;
  if (/\s{2,}/.test(s)) return false;
  return /^[≈~<>]?\s*[+\-]?(?:[$€£¥]\s*)?\d[\d,.]*(?:\s*(?:%|K|M|B|T|k|m|b|t|bp|bps))?$/.test(s);
}

function parseRows(html) {
  const rows = [];
  const trs = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trs) {
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRegex.exec(tr))) cells.push(cleanText(m[1]));
    if (cells.length < 5) continue;

    const joined = cells.join(' | ');
    const currency = countryToCurrency(joined);
    if (!currency) continue;

    // Only compact economic-value cells are candidates. This prevents prose
    // such as market articles containing a number from becoming Actual.
    const valueCells = cells.filter(validEconomicValue);

    const titleCandidate = cells.find(x =>
      x &&
      !/^\d{1,2}:\d{2}/.test(x) &&
      !/^(USD|EUR|GBP|JPY|CHF)$/i.test(x) &&
      /[A-Za-z]/.test(x) &&
      !validEconomicValue(x) &&
      x.length <= 140
    );

    if (!titleCandidate) continue;

    const actual = valueCells.length >= 3 ? valueCells[valueCells.length - 3] : null;
    const forecast = valueCells.length >= 2 ? valueCells[valueCells.length - 2] : null;
    const previous = valueCells.length >= 1 ? valueCells[valueCells.length - 1] : null;

    rows.push({ currency, title: titleCandidate, actual, forecast, previous });
  }

  return rows;
}

function titlesMatch(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Avoid matching tiny/generic fragments to unrelated calendar rows.
  if (Math.min(x.length, y.length) < 8) return false;
  return x.includes(y) || y.includes(x);
}

async function getInvestingFallback(event) {
  try {
    const { data } = await axios.get(BASE_URL, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const rows = parseRows(data);
    const match = rows.find(row =>
      row.currency === String(event.currency || '').toUpperCase() &&
      titlesMatch(row.title, event.title)
    );

    if (!match || !validEconomicValue(match.actual)) return null;

    return {
      provider: 'investing_fallback',
      actual: match.actual,
      forecast: validEconomicValue(match.forecast) ? match.forecast : null,
      previous: validEconomicValue(match.previous) ? match.previous : null
    };
  } catch (error) {
    console.log('⚠️ Investing fallback failed:', error.response?.status || '', error.message);
    return null;
  }
}

module.exports = { getInvestingFallback, validEconomicValue };
