const axios = require('axios');

const USER_AGENT =
  'Mozilla/5.0 (compatible; ForexAIBot/1.0; Telegram economic calendar bot)';

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsFromTable(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(stripHtml(cellMatch[1]));
    }

    if (cells.length) rows.push(cells);
  }

  return rows;
}

function monthNumber(name) {
  const map = {
    january: 0, february: 1, march: 2, april: 3,
    may: 4, june: 5, july: 6, august: 7,
    september: 8, october: 9, november: 10, december: 11
  };
  return map[String(name || '').toLowerCase()];
}

function parseUsEasternDate(dateText, timeText) {
  const match = String(dateText).match(
    /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i
  );

  if (!match) return null;

  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!Number.isInteger(month) || !day || !year) return null;

  const tm = String(timeText || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hour = tm ? Number(tm[1]) : 8;
  const minute = tm ? Number(tm[2]) : 30;
  const ampm = tm ? tm[3].toUpperCase() : 'AM';

  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  let utc = Date.UTC(year, month, day, hour, minute, 0);

  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(utc));

    const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const rendered = Date.UTC(
      Number(obj.year),
      Number(obj.month) - 1,
      Number(obj.day),
      Number(obj.hour),
      Number(obj.minute)
    );
    const wanted = Date.UTC(year, month, day, hour, minute);
    utc += wanted - rendered;
  }

  return new Date(utc);
}

function futureOnly(events, daysBack = 1, daysAhead = 370) {
  const min = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const max = Date.now() + daysAhead * 24 * 60 * 60 * 1000;

  return events.filter((e) => {
    const ts = new Date(e.date).getTime();
    return Number.isFinite(ts) && ts >= min && ts <= max;
  });
}

function classifyBls(title) {
  const t = title.toLowerCase();

  if (t.includes('consumer price index')) {
    return { impact: 'high', currency: 'USD', category: 'CPI' };
  }
  if (t.includes('employment situation')) {
    return { impact: 'high', currency: 'USD', category: 'NFP' };
  }
  if (t.includes('producer price index')) {
    return { impact: 'high', currency: 'USD', category: 'PPI' };
  }
  if (
    t.includes('job openings and labor turnover survey') &&
    !t.includes('state job openings')
  ) {
    return { impact: 'high', currency: 'USD', category: 'JOLTS' };
  }
  if (t.includes('employment cost index')) {
    return { impact: 'medium', currency: 'USD', category: 'ECI' };
  }

  return { impact: 'low', currency: 'USD', category: 'BLS' };
}

async function fetchBlsOfficial() {
  const year = new Date().getUTCFullYear();
  const url = `https://www.bls.gov/schedule/${year}/home.htm`;

  const { data: html } = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': USER_AGENT }
  });

  const events = [];

  for (const cells of rowsFromTable(html)) {
    if (cells.length < 3) continue;

    const dateText = cells[0];
    const timeText = cells[1];
    const title = cells.slice(2).join(' ');
    const when = parseUsEasternDate(dateText, timeText);
    if (!when || !title) continue;

    const meta = classifyBls(title);
    if (meta.impact === 'low') continue;

    events.push({
      provider: 'bls_official',
      title,
      currency: meta.currency,
      country: 'United States',
      impact: meta.impact,
      date: when.toISOString(),
      actual: null,
      forecast: null,
      previous: null,
      category: meta.category,
      sourceUrl: url
    });
  }

  return futureOnly(events, 1, 370);
}

function classifyBea(title) {
  const t = title.toLowerCase();

  if (
    t.includes('personal income and outlays') ||
    t.includes('personal income and outlays,')
  ) {
    return { impact: 'high', currency: 'USD', category: 'PCE' };
  }
  if (
    t.includes('gross domestic product') ||
    /\bgdp\b/i.test(title)
  ) {
    return { impact: 'high', currency: 'USD', category: 'GDP' };
  }
  if (t.includes('international trade in goods and services')) {
    return { impact: 'medium', currency: 'USD', category: 'TradeBalance' };
  }

  return { impact: 'low', currency: 'USD', category: 'BEA' };
}

function extractBeaEventsFromText(html) {
  const text = stripHtml(html);
  const year = new Date().getUTCFullYear();

  // Match schedule-style fragments such as:
  // "August 26 8:30 AM Personal Income and Outlays, July 2026"
  const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.+?)(?=(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s+\d{1,2}:\d{2}\s*(?:AM|PM)|$)/gi;

  const events = [];
  let m;

  while ((m = re.exec(text))) {
    const month = m[1];
    const day = m[2];
    const time = m[3];
    const title = m[4].trim();

    const when = parseUsEasternDate(`${month} ${day}, ${year}`, time);
    if (!when || !title) continue;

    const meta = classifyBea(title);
    if (meta.impact === 'low') continue;

    events.push({
      provider: 'bea_official',
      title,
      currency: meta.currency,
      country: 'United States',
      impact: meta.impact,
      date: when.toISOString(),
      actual: null,
      forecast: null,
      previous: null,
      category: meta.category,
      sourceUrl: 'https://www.bea.gov/news/schedule'
    });
  }

  return events;
}

async function fetchBeaOfficial() {
  const url = 'https://www.bea.gov/news/schedule';

  const { data: html } = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': USER_AGENT }
  });

  let events = [];

  // First try normal table rows.
  for (const cells of rowsFromTable(html)) {
    if (cells.length < 2) continue;

    const joined = cells.join(' | ');
    const dateMatch = joined.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i
    );
    const timeMatch = joined.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);

    if (!dateMatch || !timeMatch) continue;

    const yearMatch = joined.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear();

    const titleCandidate = cells
      .filter((c) => !c.includes(dateMatch[0]) && !c.includes(timeMatch[0]))
      .join(' ')
      .trim();

    const meta = classifyBea(titleCandidate);
    if (meta.impact === 'low') continue;

    const when = parseUsEasternDate(
      `${dateMatch[1]} ${dateMatch[2]}, ${year}`,
      timeMatch[1]
    );
    if (!when) continue;

    events.push({
      provider: 'bea_official',
      title: titleCandidate,
      currency: meta.currency,
      country: 'United States',
      impact: meta.impact,
      date: when.toISOString(),
      actual: null,
      forecast: null,
      previous: null,
      category: meta.category,
      sourceUrl: url
    });
  }

  // Fallback for BEA's current rendered schedule structure.
  if (!events.length) {
    events = extractBeaEventsFromText(html);
  }

  return futureOnly(events, 1, 370);
}

function extractCurrentYearSection(text, year) {
  const yearIndex = text.indexOf(String(year));
  if (yearIndex === -1) return text;

  const nextYearIndex = text.indexOf(String(year + 1), yearIndex + 4);
  if (nextYearIndex === -1) return text.slice(yearIndex);

  return text.slice(yearIndex, nextYearIndex);
}

async function fetchFedOfficial() {
  const year = new Date().getUTCFullYear();
  const url =
    'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

  // Official FOMC meeting-end dates for 2026.
  // The scheduled statement is normally released at 2:00 PM ET
  // on the second/final day of each meeting.
  const official2026 = [
    ['January', 28],
    ['March', 18],
    ['April', 29],
    ['June', 17],
    ['July', 29],
    ['September', 16],
    ['October', 28],
    ['December', 9]
  ];

  let dates = [];

  try {
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': USER_AGENT }
    });

    const text = stripHtml(html);

    const re =
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:-(\d{1,2}))?/gi;

    let m;

    while ((m = re.exec(text))) {
      const month = m[1];
      const finalDay = Number(m[3] || m[2]);

      const when = parseUsEasternDate(
        `${month} ${finalDay}, ${year}`,
        '2:00 PM'
      );

      if (!when) continue;

      dates.push(when);
    }

    dates = dates.filter((d) => d.getUTCFullYear() === year);
  } catch (error) {
    console.log(
      '⚠️ FED live calendar parser failed, using official fallback:',
      error.message
    );
  }

  // If the live parser returns an implausible count, use the official fallback.
  if (dates.length < 4 || dates.length > 12) {
    if (year === 2026) {
      dates = official2026.map(([month, day]) =>
        parseUsEasternDate(
          `${month} ${day}, 2026`,
          '2:00 PM'
        )
      );
    } else {
      // For other years, keep only dates parsed from the live page.
      dates = dates.filter(Boolean);
    }
  }

  const events = dates
    .filter(Boolean)
    .map((when) => ({
      provider: 'fed_official',
      title: 'FOMC Interest Rate Decision / Statement',
      currency: 'USD',
      country: 'United States',
      impact: 'high',
      date: when.toISOString(),
      actual: null,
      forecast: null,
      previous: null,
      category: 'FOMC',
      sourceUrl: url
    }));

  const deduped = [
    ...new Map(events.map((e) => [e.date, e])).values()
  ];

  return futureOnly(deduped, 1, 370);
}


function zonedIso(year, month, day, hour, minute, timeZone) {
  let utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0
  );

  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }
    ).formatToParts(new Date(utc));

    const obj = Object.fromEntries(
      parts.map(x => [x.type, x.value])
    );

    const rendered = Date.UTC(
      Number(obj.year),
      Number(obj.month) - 1,
      Number(obj.day),
      Number(obj.hour),
      Number(obj.minute),
      0
    );

    const wanted = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0
    );

    utc += wanted - rendered;
  }

  return new Date(utc).toISOString();
}


function officialEvent({
  provider,
  title,
  currency,
  country,
  category,
  date,
  sourceUrl
}) {
  return {
    provider,
    title,
    currency,
    country,
    impact: 'high',
    date,
    actual: null,
    forecast: null,
    previous: null,
    category,
    sourceUrl
  };
}


// =====================================================
// ECB — EUR
// 2026 confirmed monetary-policy decision dates.
// Decision normally published at 14:15 CET/CEST.
// =====================================================

async function fetchEcbOfficial() {
  const year =
    new Date().getUTCFullYear();

  const url =
    'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';

  const schedules = {
    2026: [
      [2, 5],
      [3, 19],
      [4, 30],
      [6, 11],
      [7, 23],
      [9, 10],
      [10, 29],
      [12, 17]
    ],
    2027: [
      [2, 4],
      [3, 18],
      [4, 29],
      [6, 10],
      [7, 22],
      [9, 9],
      [10, 28],
      [12, 16]
    ]
  };

  const dates =
    schedules[year] || [];

  const events =
    dates.map(([month, day]) =>
      officialEvent({
        provider:
          'ecb_official',

        title:
          'ECB Monetary Policy Decision',

        currency:
          'EUR',

        country:
          'Euro Area',

        category:
          'ECB_RATE_DECISION',

        date:
          zonedIso(
            year,
            month,
            day,
            14,
            15,
            'Europe/Frankfurt'
          ),

        sourceUrl:
          url
      })
    );

  return futureOnly(
    events,
    1,
    370
  );
}


// =====================================================
// BANK OF ENGLAND — GBP
// Confirmed MPC dates.
// =====================================================

async function fetchBoeOfficial() {
  const year =
    new Date().getUTCFullYear();

  const url =
    'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates';

  const schedules = {
    2026: [
      [2, 5],
      [3, 19],
      [4, 30],
      [6, 18],
      [7, 30],
      [9, 17],
      [11, 5],
      [12, 17]
    ],

    2027: [
      [2, 4],
      [3, 18],
      [4, 29],
      [6, 17],
      [7, 29],
      [9, 16],
      [11, 4],
      [12, 16]
    ]
  };

  const dates =
    schedules[year] || [];

  const events =
    dates.map(([month, day]) =>
      officialEvent({
        provider:
          'boe_official',

        title:
          'Bank of England Interest Rate Decision',

        currency:
          'GBP',

        country:
          'United Kingdom',

        category:
          'BOE_RATE_DECISION',

        /*
         * MPC announcements are normally
         * published at noon London time.
         */
        date:
          zonedIso(
            year,
            month,
            day,
            12,
            0,
            'Europe/London'
          ),

        sourceUrl:
          url
      })
    );

  return futureOnly(
    events,
    1,
    370
  );
}


// =====================================================
// BANK OF JAPAN — JPY
// We use the FINAL day of each MPM.
// Exact statement time is not fixed, so we intentionally
// schedule a conservative morning marker.
// External calendar APIs can provide more precise timing.
// =====================================================

async function fetchBojOfficial() {
  const year =
    new Date().getUTCFullYear();

  const url =
    'https://www.boj.or.jp/en/mopo/mpmsche_minu/';

  const schedules = {
    2026: [
      [1, 23],
      [3, 19],
      [4, 28],
      [6, 16],
      [7, 31],
      [9, 18],
      [10, 30],
      [12, 18]
    ],

    2027: [
      [1, 22],
      [3, 18],
      [4, 28],
      [6, 11],
      [7, 22],
      [9, 22],
      [10, 29],
      [12, 17]
    ]
  };

  const dates =
    schedules[year] || [];

  const events =
    dates.map(([month, day]) =>
      officialEvent({
        provider:
          'boj_official',

        title:
          'Bank of Japan Monetary Policy Decision',

        currency:
          'JPY',

        country:
          'Japan',

        category:
          'BOJ_RATE_DECISION',

        date:
          zonedIso(
            year,
            month,
            day,
            12,
            0,
            'Asia/Tokyo'
          ),

        sourceUrl:
          url
      })
    );

  return futureOnly(
    events,
    1,
    370
  );
}


// =====================================================
// SWISS NATIONAL BANK — CHF
// Monetary policy assessment release times are published
// by SNB at 09:30 Swiss local time.
// =====================================================

async function fetchSnbOfficial() {
  const year =
    new Date().getUTCFullYear();

  const url =
    'https://www.snb.ch/en/services-events/digital-services/event-schedule';

  const schedules = {
    2026: [
      [3, 19],
      [6, 18],
      [9, 24],
      [12, 10]
    ],

    2027: [
      [3, 18],
      [6, 24],
      [9, 23],
      [12, 16]
    ]
  };

  const dates =
    schedules[year] || [];

  const events =
    dates.map(([month, day]) =>
      officialEvent({
        provider:
          'snb_official',

        title:
          'SNB Monetary Policy Assessment',

        currency:
          'CHF',

        country:
          'Switzerland',

        category:
          'SNB_RATE_DECISION',

        date:
          zonedIso(
            year,
            month,
            day,
            9,
            30,
            'Europe/Zurich'
          ),

        sourceUrl:
          url
      })
    );

  return futureOnly(
    events,
    1,
    370
  );
}


async function getOfficialCalendar() {
  const providers = [
    ['bls_official', fetchBlsOfficial],
    ['bea_official', fetchBeaOfficial],
    ['fed_official', fetchFedOfficial],

    ['ecb_official', fetchEcbOfficial],
    ['boe_official', fetchBoeOfficial],
    ['boj_official', fetchBojOfficial],
    ['snb_official', fetchSnbOfficial]
  ];

  const events = [];
  const health = [];

  for (const [name, fetcher] of providers) {
    try {
      const rows = await fetcher();
      events.push(...rows);

      health.push({
        provider: name,
        ok: true,
        events: rows.length
      });

      console.log(`🏛️ ${name}: ${rows.length} events`);
    } catch (error) {
      health.push({
        provider: name,
        ok: false,
        events: 0,
        error: error.response?.status || error.message
      });

      console.log(
        `⚠️ Official provider ${name} failed:`,
        error.response?.status || '',
        error.message
      );
    }
  }

  return {
    events: futureOnly(events, 1, 370),
    health
  };
}

module.exports = {
  getOfficialCalendar,

  fetchBlsOfficial,
  fetchBeaOfficial,
  fetchFedOfficial,

  fetchEcbOfficial,
  fetchBoeOfficial,
  fetchBojOfficial,
  fetchSnbOfficial
};
