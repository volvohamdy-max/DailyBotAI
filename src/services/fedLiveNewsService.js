const Parser = require('rss-parser');
const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');
const config = require('../config');
const { translateToArabic, cleanForTranslation } = require('./newsTranslator');

const parser = new Parser();
const REQUEST_TIMEOUT = Number(process.env.FED_LIVE_TIMEOUT_MS) || 15000;
const CATCHUP_MS = Number(process.env.FED_LIVE_CATCHUP_MS) || 12 * 60 * 60 * 1000;

const FEEDS = [
  {
    id: 'fed_monetary',
    label: 'السياسة النقدية',
    url: 'https://www.federalreserve.gov/feeds/press_monetary.xml'
  },
  {
    id: 'fed_speeches',
    label: 'تصريحات وخطابات الفيدرالي',
    url: 'https://www.federalreserve.gov/feeds/speeches_and_testimony.xml'
  }
];

const IMPACT_KEYWORDS = [
  'fomc', 'minutes', 'monetary policy', 'interest rate', 'rates',
  'inflation', 'price stability', 'employment', 'labor market', 'jobs',
  'economic outlook', 'economy', 'growth', 'recession', 'dollar',
  'balance sheet', 'quantitative tightening', 'quantitative easing',
  'federal funds', 'policy framework', 'press conference', 'statement'
];

let initialized = false;

function channelId() {
  const id = config.mainGroupId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function keyFor(feedId, item) {
  const raw = [
    feedId,
    item.guid || '',
    item.link || '',
    item.isoDate || item.pubDate || '',
    item.title || ''
  ].join('|');

  // v2 intentionally bypasses the old startup-baseline marks once.
  // Old feed items are immediately re-baselined; only recent relevant
  // items stay unmarked and are eligible for catch-up delivery.
  return `fedlive_v2_${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20)}`;
}

function alreadySent(key) {
  return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key));
}

function markSent(key) {
  db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(key);
}

function isRelevant(item) {
  const text = `${item.title || ''} ${item.contentSnippet || ''} ${item.content || ''}`.toLowerCase();
  return IMPACT_KEYWORDS.some(k => text.includes(k));
}

function itemTime(item) {
  const d = new Date(item.isoDate || item.pubDate || item.date || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isRecent(item) {
  const ts = itemTime(item);
  return ts > 0 && Date.now() - ts >= 0 && Date.now() - ts <= CATCHUP_MS;
}

function cleanSnippet(item) {
  const raw = item.contentSnippet || item.content || item.summary || '';
  return cleanForTranslation(raw).replace(/\s+/g, ' ').trim().slice(0, 900);
}

async function arabicText(text, fallback) {
  const translated = await translateToArabic(text);
  if (translated && /[\u0600-\u06FF]/.test(translated)) return translated;
  return fallback;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function buildArabicMessage(feed, item) {
  const title = await arabicText(
    item.title || '',
    'تحديث مهم من الاحتياطي الفيدرالي الأمريكي'
  );

  const snippetRaw = cleanSnippet(item);
  const snippet = snippetRaw
    ? await arabicText(snippetRaw, 'صدر تحديث جديد مهم من الاحتياطي الفيدرالي الأمريكي.')
    : 'صدر تحديث جديد مهم من الاحتياطي الفيدرالي الأمريكي.';

  const isMinutes = /minutes/i.test(String(item.title || ''));
  const header = isMinutes
    ? '🟥 محضر اجتماع مجلس الاحتياطي الفيدرالي 🇺🇸'
    : '🟥 تحديث مباشر من الاحتياطي الفيدرالي 🇺🇸';

  return `${header}\n\n` +
    `🏛️ <b>${escapeHtml(title)}</b>\n\n` +
    `${escapeHtml(snippet)}\n\n` +
    `📌 المصدر: مجلس الاحتياطي الفيدرالي الأمريكي`;
}

async function fetchFeed(feed) {
  const { data } = await axios.get(feed.url, {
    timeout: REQUEST_TIMEOUT,
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ForexAIBot/1.0; Federal Reserve RSS monitor)',
      'Accept': 'application/rss+xml,application/xml,text/xml,text/plain,*/*'
    }
  });
  const parsed = await parser.parseString(String(data || ''));
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

async function seedBaseline() {
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      let preservedRecent = 0;
      for (const item of items.slice(0, 30)) {
        if (isRecent(item) && isRelevant(item)) {
          preservedRecent += 1;
          continue;
        }
        markSent(keyFor(feed.id, item));
      }
      console.log(`🏛️ FED LIVE baseline ${feed.id}: ${items.length} item(s) | recent catch-up=${preservedRecent}`);
    } catch (error) {
      console.log(`⚠️ FED LIVE baseline failed ${feed.id}:`, error.response?.status || error.message);
    }
  }
  initialized = true;
}

async function checkFedLiveNews(bot) {
  const target = channelId();
  if (!target) {
    console.log('⚠️ FED LIVE skipped: MAIN_GROUP_ID is not configured');
    return;
  }

  if (!initialized) {
    await seedBaseline();
    // Do not return here. Fresh relevant items deliberately left unmarked
    // must be processed immediately so a restart cannot bury FOMC minutes.
  }

  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      const candidates = items
        .filter(isRelevant)
        .slice(0, 12)
        .reverse();

      for (const item of candidates) {
        const key = keyFor(feed.id, item);
        if (alreadySent(key)) continue;

        // Never flood historical feed items during startup/version migration.
        if (!isRecent(item)) {
          markSent(key);
          continue;
        }

        const message = await buildArabicMessage(feed, item);

        try {
          await bot.telegram.sendMessage(target, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
          markSent(key);
          console.log(`🟥 FED LIVE sent: ${item.title || 'untitled'}`);
        } catch (error) {
          console.log('⚠️ FED LIVE Telegram send failed:', error.message);
        }
      }
    } catch (error) {
      console.log(`⚠️ FED LIVE feed failed ${feed.id}:`, error.response?.status || error.message);
    }
  }
}

function startFedLiveNews(bot) {
  const intervalMs = Number(process.env.FED_LIVE_INTERVAL_MS) || 60 * 1000;

  setTimeout(() => {
    checkFedLiveNews(bot).catch(error =>
      console.log('⚠️ FED LIVE initial check failed:', error.message)
    );

    setInterval(() => {
      checkFedLiveNews(bot).catch(error =>
        console.log('⚠️ FED LIVE loop failed:', error.message)
      );
    }, intervalMs);

    console.log(`🏛️ FED LIVE Watch every ${Math.round(intervalMs / 1000)} seconds | Arabic only | catch-up=${Math.round(CATCHUP_MS/3600000)}h`);
  }, 7000);
}

module.exports = {
  checkFedLiveNews,
  startFedLiveNews
};
