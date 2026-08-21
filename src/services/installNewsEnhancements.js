const axios = require('axios');
const newsCalendarGate = require('./newsCalendarGate');
const newsProviders = require('./newsProviders');

const IMPORTANT = new Set(['USD','EUR','GBP','JPY','CHF']);
const FF_URL = process.env.FOREX_FACTORY_CALENDAR_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const TIMEOUT = Number(process.env.NEWS_PROVIDER_TIMEOUT_MS) || 15000;
const FF_CACHE_MS = Number(process.env.FOREX_FACTORY_CACHE_MS) || 15 * 60 * 1000;
const FF_RETRY_AFTER_429_MS = Number(process.env.FOREX_FACTORY_429_COOLDOWN_MS) || 30 * 60 * 1000;

let ffCache = [];
let ffCacheAt = 0;
let ffBlockedUntil = 0;

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeImpact(value) {
  const t = String(value || '').trim().toLowerCase();
  if (t.includes('high') || t === '3') return 'high';
  if (t.includes('medium') || t.includes('med') || t === '2') return 'medium';
  if (t.includes('low') || t === '1') return 'low';
  return t || 'unknown';
}

function normalizeForexFactory(row) {
  const currency = String(row.country || row.currency || '').trim().toUpperCase();
  const title = String(row.title || row.event || '').trim();
  const date = safeDate(row.date || row.datetime || row.time);
  if (!title || !date || !IMPORTANT.has(currency)) return null;
  return {
    provider: 'forex_factory_public',
    providerId: String(row.id || ''),
    title,
    currency,
    country: currency,
    impact: normalizeImpact(row.impact),
    date: date.toISOString(),
    actual: row.actual ?? null,
    forecast: row.forecast ?? null,
    previous: row.previous ?? null,
    category: 'ECONOMIC_CALENDAR',
    sourceUrl: 'https://www.forexfactory.com/calendar'
  };
}

async function fetchForexFactoryWeek(force = false) {
  const now = Date.now();

  if (!force && ffCache.length && now - ffCacheAt < FF_CACHE_MS) {
    return ffCache;
  }

  if (now < ffBlockedUntil) {
    if (ffCache.length) {
      console.log(`🗓️ ForexFactory cooldown active | using cached ${ffCache.length} event(s)`);
      return ffCache;
    }
    return [];
  }

  try {
    const { data } = await axios.get(FF_URL, {
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ForexAIBot/1.0)',
        'Accept': 'application/json,text/plain,*/*'
      }
    });
    const rows = Array.isArray(data) ? data : [];
    const events = rows.map(normalizeForexFactory).filter(Boolean);

    ffCache = events;
    ffCacheAt = now;
    ffBlockedUntil = 0;

    console.log(`🗓️ ForexFactory public calendar: ${events.length} event(s)`);
    return events;
  } catch (error) {
    const status = Number(error.response?.status || 0);

    if (status === 429) {
      ffBlockedUntil = Date.now() + FF_RETRY_AFTER_429_MS;
      console.log(
        `⚠️ ForexFactory public calendar rate limited: 429 | cooldown=${Math.round(FF_RETRY_AFTER_429_MS / 60000)}m`
      );
    } else {
      console.log('⚠️ ForexFactory public calendar failed:', error.response?.status || '', error.message);
    }

    if (ffCache.length) {
      console.log(`🗓️ ForexFactory stale-cache fallback: ${ffCache.length} event(s)`);
      return ffCache;
    }

    return [];
  }
}

function easternIso(year, month, day, hour = 14, minute = 0) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(utc));
    const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const rendered = Date.UTC(Number(obj.year), Number(obj.month)-1, Number(obj.day), Number(obj.hour), Number(obj.minute));
    const wanted = Date.UTC(year, month-1, day, hour, minute);
    utc += wanted - rendered;
  }
  return new Date(utc).toISOString();
}

function addDaysUtc(year, month, day, days) {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function fomcMinutesSchedule() {
  const schedules = {
    2026: [[1,28],[3,18],[4,29],[6,17],[7,29],[9,16],[10,28],[12,9]],
    2027: [[1,27],[3,17],[4,28],[6,9],[7,28],[9,15],[10,27],[12,8]]
  };
  const now = Date.now();
  const out = [];
  for (const [yearText, meetings] of Object.entries(schedules)) {
    const year = Number(yearText);
    for (const [month, day] of meetings) {
      const [y,m,d] = addDaysUtc(year, month, day, 21);
      const iso = easternIso(y,m,d,14,0);
      const ts = new Date(iso).getTime();
      if (ts < now - 36*60*60*1000 || ts > now + 370*24*60*60*1000) continue;
      out.push({
        provider: 'fed_minutes_schedule',
        title: 'FOMC Minutes',
        currency: 'USD',
        country: 'United States',
        impact: 'high',
        date: iso,
        actual: null,
        forecast: null,
        previous: null,
        category: 'FOMC_MINUTES',
        sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
      });
    }
  }
  return out;
}

function canonical(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

function merge(base, extra) {
  const all = [...base, ...extra].sort((a,b) => new Date(a.date) - new Date(b.date));
  const result = [];
  for (const e of all) {
    const ts = new Date(e.date).getTime();
    const duplicate = result.find(x =>
      x.currency === e.currency &&
      Math.abs(new Date(x.date).getTime() - ts) <= 10*60*1000 &&
      (canonical(x.title) === canonical(e.title) || canonical(x.title).includes(canonical(e.title)) || canonical(e.title).includes(canonical(x.title)))
    );
    if (duplicate) {
      duplicate.sources = [...new Set([...(duplicate.sources || [duplicate.provider]), e.provider])];
      duplicate.sourceCount = duplicate.sources.length;
      if (duplicate.actual == null && e.actual != null) duplicate.actual = e.actual;
      if (duplicate.forecast == null && e.forecast != null) duplicate.forecast = e.forecast;
      if (duplicate.previous == null && e.previous != null) duplicate.previous = e.previous;
      if (duplicate.impact !== 'high' && e.impact === 'high') duplicate.impact = 'high';
    } else {
      result.push({ ...e, sources: e.sources || [e.provider], sourceCount: e.sourceCount || 1 });
    }
  }
  return result;
}

if (!newsCalendarGate.__enhancedCalendarInstalled) {
  const nativeGet = newsCalendarGate.getMultiSourceCalendar.bind(newsCalendarGate);
  let cache = null;
  let cacheAt = 0;
  const CACHE_MS = 5 * 60 * 1000;

  newsCalendarGate.getMultiSourceCalendar = async function enhancedCalendar(forceRefresh = false) {
    if (!forceRefresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;

    // Force-refresh live/official sources for post-release Actual updates,
    // but do NOT hammer ForexFactory's weekly public file every minute.
    const base = forceRefresh
      ? await newsProviders.getMultiSourceCalendar(true)
      : await nativeGet();

    const ff = await fetchForexFactoryWeek(false);
    const minutes = fomcMinutesSchedule();
    cache = {
      ...base,
      data: merge(base.data || [], [...ff, ...minutes]),
      providers: [...new Set([...(base.providers || []), ...(ff.length ? ['forex_factory_public'] : []), 'fed_minutes_schedule'])]
    };
    cacheAt = Date.now();
    return cache;
  };

  Object.defineProperty(newsCalendarGate, '__enhancedCalendarInstalled', { value: true });
  console.log('📰 Enhanced news calendar READY | official + ForexFactory public + FOMC minutes + true force-refresh');
}

module.exports = newsCalendarGate;
