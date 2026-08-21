const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');
const config = require('../config');
const { translateToArabic } = require('./newsTranslator');

const POLL_MS = Number(process.env.CRYPTO_NEWS_POLL_MS) || 2 * 60 * 1000;
const MAX_ITEM_AGE_MS = Number(process.env.CRYPTO_NEWS_MAX_AGE_MS) || 6 * 60 * 60 * 1000;

const FEEDS = [
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' }
];

const CORE_ASSETS = [
  { symbol: 'BTC', re: /\b(bitcoin|btc)\b/i },
  { symbol: 'ETH', re: /\b(ethereum|ether|eth)\b/i },
  { symbol: 'SOL', re: /\b(solana|solana network)\b/i },
  { symbol: 'XRP', re: /\b(xrp|ripple)\b/i },
  { symbol: 'BNB', re: /\b(bnb|binance coin)\b/i }
];

// Only events with a realistic chance of moving the broad crypto market or a core asset.
const CRITICAL_EVENT_RE = new RegExp([
  'spot bitcoin etf','spot btc etf','spot ethereum etf','spot ether etf',
  'etf approved','etf approval','etf rejected','etf rejection',
  'sec approves','sec approved','sec rejects','sec rejected',
  'bitcoin reserve','strategic bitcoin reserve','crypto reserve',
  'government bitcoin','government btc',
  'fed rate','federal reserve','interest rate decision','fomc',
  'major hack','hacked','exploit','breach','stolen','drained',
  'withdrawals halted','withdrawal halt','suspends withdrawals','suspended withdrawals',
  'bankrupt','bankruptcy','insolvent','insolvency',
  'depeg','de-pegged','loses peg','lost peg',
  'network halt','network outage','blockchain halt',
  'trading halt','trading suspended',
  'binance hacked','coinbase hacked','bybit hacked','okx hacked','kraken hacked',
  'tether depeg','usdt depeg','usdc depeg',
  'binance bankruptcy','coinbase bankruptcy','bybit bankruptcy',
  'blackrock bitcoin','blackrock btc','fidelity bitcoin','fidelity btc',
  'strategy buys bitcoin','strategy bought bitcoin','microstrategy buys bitcoin','microstrategy bought bitcoin',
  'billion.*bitcoin','billion.*btc','billion.*ethereum','billion.*eth',
  'liquidations.*billion','billion.*liquidations'
].join('|'), 'i');

// Editorial/legal roundups, opinion pieces and routine company/regulatory stories must never alert.
const NOISE_RE = new RegExp([
  'price prediction','technical analysis','top altcoins','best crypto','presale','giveaway','sponsored','casino',
  'memecoin to buy','price target','opinion','interview','podcast','explainer','guide','how to',
  'this week','weekly roundup','week in review','what happened','legal news','legal roundup','in court',
  'onchain.*court','court.*this week','lawsuit update','case update',
  'files for','filing','seeks approval','proposal','proposes','could approve','may approve','might approve',
  'analyst says','analysts say','trader says','traders say','expert says','experts say',
  'whale moves','whale transfers','wallet moves','wallet transfers',
  'listing','delisting announcement','partnership','launches','announces'
].join('|'), 'i');

function targetChatId() {
  const id = config.mainGroupId;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

function parseFeed(xml, source) {
  const rows = [];
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const title = tag(item, 'title');
    const description = tag(item, 'description');
    const link = tag(item, 'link');
    const guid = tag(item, 'guid');
    const pubDate = tag(item, 'pubDate');
    const publishedAt = new Date(pubDate);
    if (!title) continue;
    rows.push({ source, title, description, link, guid, publishedAt: Number.isNaN(publishedAt.getTime()) ? null : publishedAt });
  }
  return rows;
}

function detectAssets(text) {
  return [...new Set(CORE_ASSETS.filter(x => x.re.test(text)).map(x => x.symbol))];
}

function classify(item) {
  const title = String(item.title || '');
  const text = `${title} ${item.description || ''}`;

  // Require the headline itself to carry a critical trigger. This prevents a generic article
  // from alerting merely because its description mentions SEC/court/hack/etc.
  if (NOISE_RE.test(title) || NOISE_RE.test(text)) return null;
  if (!CRITICAL_EVENT_RE.test(title)) return null;

  const assets = detectAssets(text);

  // Broad-market events can be tagged CRYPTO only when the headline is explicitly systemic.
  const systemic = /federal reserve|fomc|interest rate decision|strategic bitcoin reserve|crypto reserve|major hack|bankrupt|insolvent|depeg|withdrawals halted|network halt|trading halt|billion.*liquidations/i.test(title);
  if (!assets.length && !systemic) return null;

  return {
    assets: assets.length ? assets : ['CRYPTO'],
    severity: 'critical'
  };
}

function itemHash(item) {
  return crypto.createHash('sha1').update(`${item.source}|${item.guid || item.link || item.title}`).digest('hex').slice(0, 24);
}

function seen(key) {
  return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key));
}

function mark(key) {
  db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(key);
}

async function arabicTitle(title) {
  try {
    const translated = await translateToArabic(title);
    if (translated && /[\u0600-\u06FF]/.test(translated)) return translated;
  } catch {}
  return title;
}

async function fetchFeed(feed) {
  const { data } = await axios.get(feed.url, {
    timeout: 15000,
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0 ForexAIBot/1.0' }
  });
  return parseFeed(data, feed.name);
}

async function cycle(bot) {
  const chatId = targetChatId();
  if (!chatId) return;

  const now = Date.now();
  const all = [];
  for (const feed of FEEDS) {
    try {
      const rows = await fetchFeed(feed);
      all.push(...rows);
      console.log(`₿ Crypto news ${feed.name}: ${rows.length} items`);
    } catch (error) {
      console.log(`⚠️ Crypto news feed failed ${feed.name}:`, error.response?.status || '', error.message);
    }
  }

  all.sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));

  for (const item of all) {
    if (item.publishedAt && now - item.publishedAt.getTime() > MAX_ITEM_AGE_MS) continue;
    const meta = classify(item);
    if (!meta) continue;

    const key = `crypto_breaking_${itemHash(item)}`;
    if (seen(key)) continue;

    const title = await arabicTitle(item.title);
    const assets = meta.assets.map(x => `#${x}`).join(' ');
    const message = `🚨 <b>خبر شديد الأهمية في سوق العملات الرقمية</b>\n\n📰 <b>${title}</b>\n\n🪙 الأصول المتأثرة: ${assets}\n🏷️ المصدر: ${item.source}\n\n⚠️ حدث استثنائي قد يسبب حركة قوية أو تذبذبًا حادًا. تجنب مطاردة الحركة الأولى وانتظر تأكيد السعر.\n\n#CryptoNews #Bitcoin\n@Forexaitrade_bot`;

    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    mark(key);
    console.log(`₿ CRITICAL crypto news sent: ${item.title} | ${meta.assets.join(',')}`);
  }
}

function startCryptoNews(bot) {
  setTimeout(() => cycle(bot).catch(error => console.log('❌ Crypto news startup error:', error.message)), 20000);
  setInterval(() => cycle(bot).catch(error => console.log('❌ Crypto news cycle error:', error.message)), POLL_MS);
  console.log(`₿ Crypto news watcher every ${Math.round(POLL_MS / 1000)}s | CRITICAL ONLY | BTC ETH SOL XRP BNB + systemic market events`);
}

module.exports = { startCryptoNews, cycle };
