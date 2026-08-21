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
  { symbol: 'SOL', re: /\b(solana|sol)\b/i },
  { symbol: 'XRP', re: /\b(xrp|ripple)\b/i },
  { symbol: 'BNB', re: /\b(bnb|binance coin)\b/i }
];

const MARKET_WIDE_RE = /\b(crypto|cryptocurrency|digital asset|stablecoin|defi|blockchain)\b/i;
const MAJOR_EVENT_RE = new RegExp([
  'spot etf','etf approval','etf filing','etf inflow','etf outflow',
  'sec','cftc','regulation','regulator','lawsuit','court','ban','approved','approval',
  'hack','hacked','exploit','breach','stolen','drain','attack','vulnerability',
  'bankrupt','bankruptcy','insolvent','insolvency','withdrawal halt','withdrawals halted',
  'outage','trading halt','delist','delisting','listing',
  'depeg','de-pegged','stablecoin',
  'liquidation','liquidations',
  'treasury','institutional','institution','whale','billion','million btc',
  'halving','hard fork','upgrade','mainnet','network halt','network outage',
  'binance','coinbase','kraken','bybit','okx','tether','usdt','usdc','circle',
  'microstrategy','strategy','blackrock','fidelity','grayscale'
].join('|'), 'i');

const NOISE_RE = /price prediction|technical analysis|top altcoins|best crypto|presale|giveaway|sponsored|casino|memecoin to buy|price target/i;

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
    rows.push({
      source,
      title,
      description,
      link,
      guid,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? null : publishedAt
    });
  }
  return rows;
}

function detectAssets(text) {
  const assets = CORE_ASSETS.filter(x => x.re.test(text)).map(x => x.symbol);
  return [...new Set(assets)];
}

function classify(item) {
  const text = `${item.title} ${item.description}`;
  if (NOISE_RE.test(text)) return null;
  const assets = detectAssets(text);
  const marketWide = MARKET_WIDE_RE.test(text);
  const major = MAJOR_EVENT_RE.test(text);
  if (!major || (!assets.length && !marketWide)) return null;

  let severity = 'high';
  if (/hack|hacked|exploit|breach|stolen|drain|bankrupt|insolven|depeg|withdrawal halt|network halt|outage|trading halt|sec|cftc|etf approval|approved/i.test(text)) {
    severity = 'critical';
  }

  return { assets: assets.length ? assets : ['CRYPTO'], severity };
}

function itemHash(item) {
  return crypto
    .createHash('sha1')
    .update(`${item.source}|${item.guid || item.link || item.title}`)
    .digest('hex')
    .slice(0, 24);
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
    const icon = meta.severity === 'critical' ? '🚨' : '🟠';
    const assets = meta.assets.map(x => `#${x}`).join(' ');
    const message = `${icon} <b>خبر مهم في سوق العملات الرقمية</b>\n\n📰 <b>${title}</b>\n\n🪙 الأصول المتأثرة: ${assets}\n🏷️ المصدر: ${item.source}\n\n⚠️ الخبر قد يرفع التذبذب بسرعة. يفضل انتظار تأكيد حركة السعر وعدم مطاردة الحركة الأولى.\n\n#CryptoNews #Bitcoin\n@Forexaitrade_bot`;

    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    mark(key);
    console.log(`₿ Crypto breaking sent: ${item.title} | ${meta.assets.join(',')}`);
  }
}

function startCryptoNews(bot) {
  setTimeout(() => cycle(bot).catch(error => console.log('❌ Crypto news startup error:', error.message)), 20000);
  setInterval(() => cycle(bot).catch(error => console.log('❌ Crypto news cycle error:', error.message)), POLL_MS);
  console.log(`₿ Crypto news watcher every ${Math.round(POLL_MS / 1000)}s | BTC ETH SOL XRP BNB + market-wide`);
}

module.exports = { startCryptoNews, cycle };
