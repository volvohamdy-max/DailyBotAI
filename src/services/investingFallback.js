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

  return null;
}

function parseRows(html) {
  const rows = [];

  const trRegex = /<tr[\s\S]*?<\/tr>/gi;
  const trs = String(html || '').match(trRegex) || [];

  for (const tr of trs) {
    const cells = [];

    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;

    while ((m = tdRegex.exec(tr))) {
      cells.push(cleanText(m[1]));
    }

    if (cells.length < 5) continue;

    const joined = cells.join(' | ');

    const currency =
      countryToCurrency(joined);

    if (!currency) continue;

    const numericCells =
      cells.filter(x =>
        /[-+]?\d/.test(x)
      );

    const titleCandidate =
      cells.find(x =>
        x &&
        !/^\d{1,2}:\d{2}/.test(x) &&
        !/^(USD|EUR|GBP|JPY)$/i.test(x) &&
        /[A-Za-z]/.test(x)
      );

    if (!titleCandidate) continue;

    const actual =
      numericCells.length >= 1
        ? numericCells[numericCells.length - 3] ?? null
        : null;

    const forecast =
      numericCells.length >= 2
        ? numericCells[numericCells.length - 2] ?? null
        : null;

    const previous =
      numericCells.length >= 3
        ? numericCells[numericCells.length - 1] ?? null
        : null;

    rows.push({
      currency,
      title: titleCandidate,
      actual,
      forecast,
      previous
    });
  }

  return rows;
}

function titlesMatch(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);

  if (!x || !y) return false;

  return (
    x === y ||
    x.includes(y) ||
    y.includes(x)
  );
}

async function getInvestingFallback(event) {
  try {
    const { data } = await axios.get(
      BASE_URL,
      {
        timeout: 12000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Safari/537.36',
          'Accept-Language':
            'en-US,en;q=0.9'
        }
      }
    );

    const rows = parseRows(data);

    const match = rows.find(row =>
      row.currency ===
        String(event.currency || '').toUpperCase() &&
      titlesMatch(
        row.title,
        event.title
      )
    );

    if (!match) {
      return null;
    }

    return {
      provider: 'investing_fallback',
      actual: match.actual ?? null,
      forecast: match.forecast ?? null,
      previous: match.previous ?? null
    };

  } catch (error) {
    console.log(
      '⚠️ Investing fallback failed:',
      error.response?.status || '',
      error.message
    );

    return null;
  }
}

module.exports = {
  getInvestingFallback
};
