const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');
const config = require('../config');
const { translateToArabic } = require('./newsTranslator');
const { getBoolSetting } = require('../database/adminControl');

const DEFAULT_FEEDS = [
  { name: 'Investing', url: 'https://www.investing.com/rss/news_25.rss' },
  { name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news' },
  // Kitco changed its old /rss/news endpoint. Keep the current RSS category endpoint.
  { name: 'Kitco', url: 'https://www.kitco.com/news/category/news/rss' }
];

const KEYWORDS = /gold|xau|bullion|dollar|usd|federal reserve|\bfed\b|fomc|powell|interest rate|inflation|cpi|pce|nfp|jobs|employment|treasury|yield|bond|ecb|boe|boj|oil|crude|opec|hormuz|tariff|sanction|trade war|geopolit|war|conflict|bitcoin|crypto/i;
const STRONG = /federal reserve|\bfed\b|fomc|powell|interest rate|inflation|cpi|pce|nfp|payroll|treasury|yield|ecb|boe|boj|gold|xau|oil|opec|hormuz|tariff|sanction|war|attack/i;

function feeds() {
  const custom = String(process.env.MARKET_INTELLIGENCE_FEEDS || '').split(',').map(x => x.trim()).filter(Boolean);
  return custom.length ? custom.map((url, i) => ({ name: `Feed ${i + 1}`, url })) : DEFAULT_FEEDS;
}
function decode(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block, name) { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? decode(m[1]) : ''; }
function parseFeed(xml, source) {
  const out = [];
  const blocks = String(xml || '').match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    const description = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const published = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    const linkMatch = b.match(/<link[^>]*(?:href=["']([^"']+)["'])?[^>]*>([^<]*)<\/link>|<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const link = decode(linkMatch?.[1] || linkMatch?.[2] || linkMatch?.[3] || '');
    if (title) out.push({ source, title, description, published, link });
  }
  return out;
}
function relevant(x) { return KEYWORDS.test(`${x.title} ${x.description}`); }
function recent(x) { if (!x.published) return true; const t = new Date(x.published).getTime(); return !Number.isFinite(t) || Date.now() - t < 6 * 60 * 60 * 1000; }
function canonical(x) { return `${x.title} ${x.description}`.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\u0600-\u06ff ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500); }
function key(x) { return `market_intel_${crypto.createHash('sha1').update(canonical(x)).digest('hex').slice(0, 20)}`; }
function seen(k) { return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(k)); }
function mark(k) { db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(k); }
function assets(text) {
  const a = [];
  if (/gold|xau|bullion/i.test(text)) a.push('XAUUSD');
  if (/dollar|usd|fed|fomc|powell|treasury|yield|inflation|cpi|pce|nfp/i.test(text)) a.push('XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY');
  if (/oil|crude|opec|hormuz/i.test(text)) a.push('USOIL / WTI', 'UKOIL / Brent', 'XAUUSD');
  if (/ecb|euro/i.test(text)) a.push('EURUSD', 'EURJPY');
  if (/boe|sterling|pound/i.test(text)) a.push('GBPUSD', 'GBPJPY');
  if (/boj|yen/i.test(text)) a.push('USDJPY', 'GBPJPY');
  if (/bitcoin|crypto/i.test(text)) a.push('BTCUSD');
  return [...new Set(a)].slice(0, 6);
}
function bias(text) {
  const t = text.toLowerCase();
  if (/rate cut|cuts rates|dovish|lower yields|yield falls|weaker dollar/.test(t)) return '📈 يميل لدعم الذهب إذا أكد السعر الحركة.';
  if (/rate hike|higher rates|hawkish|higher yields|yield rises|stronger dollar/.test(t)) return '📉 قد يضغط على الذهب إذا أكد الدولار والعوائد الحركة.';
  if (/war|attack|conflict|sanction|hormuz|geopolit/.test(t)) return '🛡️ تصاعد المخاطر قد يزيد الطلب على الملاذات الآمنة، مع مراقبة النفط.';
  return '🧭 الاتجاه يحتاج تأكيدًا من حركة السعر والدولار والعوائد.';
}
function escapeHtml(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function buildMessage(item) {
  const raw = `${item.title}. ${item.description}`.slice(0, 900);
  const ar = await translateToArabic(raw);
  if (!ar) return null;
  const list = assets(raw);
  return `🌍 <b>Market Intelligence</b>\n\n📰 ${escapeHtml(ar)}\n\n🧠 <b>قراءة السوق</b>\n${escapeHtml(bias(raw))}\n\n🎯 <b>الأصول تحت المراقبة</b>\n${escapeHtml(list.length ? list.join(' • ') : 'الذهب والدولار والأسواق العالمية')}\n\n🔎 المصدر: ${escapeHtml(item.source)}\n⚠️ التحليل إخباري وليس إشارة دخول.\n\n#MarketIntelligence\n@Forexaitrade_bot`;
}
async function fetchOne(feed) {
  const { data } = await axios.get(feed.url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ForexAIBot/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, */*' }, responseType: 'text' });
  return parseFeed(data, feed.name);
}
async function collect() {
  const all = [];
  for (const feed of feeds()) {
    try { const rows = await fetchOne(feed); all.push(...rows); console.log(`🌍 Market Intel ${feed.name}: ${rows.length} items`); }
    catch (e) { console.log(`⚠️ Market Intel source failed ${feed.name}:`, e.response?.status || '', e.message); }
  }
  return all.filter(relevant).filter(recent);
}
async function checkMarketIntelligence(bot) {
  if (!getBoolSetting('breaking_news_enabled', true)) return;
  const chatId = config.mainGroupId && String(config.mainGroupId).trim();
  if (!chatId) return;
  const rows = await collect();
  const candidates = rows.filter(x => STRONG.test(`${x.title} ${x.description}`)).slice(-20);
  let sent = 0;
  for (const item of candidates) {
    if (sent >= 2) break;
    const k = key(item); if (seen(k)) continue;
    const msg = await buildMessage(item); if (!msg) continue;
    try { await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }); mark(k); sent++; console.log(`🌍 Market Intelligence sent: ${item.source} | ${item.title}`); }
    catch (e) { console.log('Market Intelligence send failed:', e.message); }
  }
}
async function seed() { const rows = await collect(); for (const x of rows.slice(-40)) { const k = key(x); if (!seen(k)) mark(k); } }
function startMarketIntelligence(bot) {
  const ms = Number(process.env.MARKET_INTELLIGENCE_INTERVAL_MS) || 3 * 60 * 1000;
  setTimeout(async () => {
    try { await seed(); console.log('🌍 Market Intelligence baseline initialized'); } catch (e) { console.log('Market Intelligence baseline error:', e.message); }
    setInterval(() => checkMarketIntelligence(bot).catch(e => console.log('Market Intelligence loop error:', e.message)), ms);
    console.log(`🌍 Market Intelligence Watch every ${Math.round(ms / 1000)} seconds`);
  }, 9000);
}
module.exports = { startMarketIntelligence, checkMarketIntelligence };
