const Parser = require('rss-parser');
const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');
const config = require('../config');
const { translateToArabic, cleanForTranslation } = require('./newsTranslator');

const parser = new Parser();
const REQUEST_TIMEOUT = Number(process.env.FED_LIVE_TIMEOUT_MS) || 15000;

const FEEDS = [
  { id: 'fed_monetary', label: 'السياسة النقدية', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml' },
  { id: 'fed_speeches', label: 'تصريحات وخطابات الفيدرالي', url: 'https://www.federalreserve.gov/feeds/speeches_and_testimony.xml' }
];

const IMPACT_KEYWORDS = [
  'fomc','minutes','monetary policy','interest rate','rates','inflation','price stability',
  'employment','labor market','jobs','economic outlook','economy','growth','recession','dollar',
  'balance sheet','quantitative tightening','quantitative easing','federal funds','policy framework',
  'press conference','statement'
];

let initialized = false;
function channelId(){ const id=config.mainGroupId; return id!=null&&String(id).trim()?String(id).trim():null; }
function keyFor(feedId,item){ const raw=[feedId,item.guid||'',item.link||'',item.isoDate||item.pubDate||'',item.title||''].join('|'); return `fedlive_v2_${crypto.createHash('sha1').update(raw).digest('hex').slice(0,20)}`; }
function alreadySent(key){ return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(key)); }
function markSent(key){ db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(key); }
function isRelevant(item){ const text=`${item.title||''} ${item.contentSnippet||''} ${item.content||''}`.toLowerCase(); return IMPACT_KEYWORDS.some(k=>text.includes(k)); }
function cleanSnippet(item){ const raw=item.contentSnippet||item.content||item.summary||''; return cleanForTranslation(raw).replace(/\s+/g,' ').trim().slice(0,900); }
async function arabicText(text,fallback){ const translated=await translateToArabic(text); if(translated&&/[\u0600-\u06FF]/.test(translated)) return translated; return fallback; }
function escapeHtml(text){ return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function buildArabicMessage(feed,item){ const title=await arabicText(item.title||'','تحديث مهم من الاحتياطي الفيدرالي الأمريكي'); const snippetRaw=cleanSnippet(item); const snippet=snippetRaw?await arabicText(snippetRaw,'صدر تحديث جديد مهم من الاحتياطي الفيدرالي الأمريكي.'):'صدر تحديث جديد مهم من الاحتياطي الفيدرالي الأمريكي.'; const isMinutes=/minutes/i.test(String(item.title||'')); const header=isMinutes?'🟥 محضر اجتماع مجلس الاحتياطي الفيدرالي 🇺🇸':'🟥 تحديث مباشر من الاحتياطي الفيدرالي 🇺🇸'; return `${header}\n\n🏛️ <b>${escapeHtml(title)}</b>\n\n${escapeHtml(snippet)}\n\n📌 المصدر: مجلس الاحتياطي الفيدرالي الأمريكي`; }
async function fetchFeed(feed){ const {data}=await axios.get(feed.url,{timeout:REQUEST_TIMEOUT,responseType:'text',headers:{'User-Agent':'Mozilla/5.0 (compatible; ForexAIBot/1.0; Federal Reserve RSS monitor)','Accept':'application/rss+xml,application/xml,text/xml,text/plain,*/*'}}); const parsed=await parser.parseString(String(data||'')); return Array.isArray(parsed?.items)?parsed.items:[]; }

// Startup must be completely silent. Everything already present in the FED feeds
// is baseline history, regardless of its timestamp. Only items appearing after
// this baseline may be delivered by the live watcher.
async function seedBaseline(){
  for(const feed of FEEDS){
    try{
      const items=await fetchFeed(feed);
      for(const item of items.slice(0,30)) markSent(keyFor(feed.id,item));
      console.log(`🏛️ FED LIVE baseline ${feed.id}: ${items.length} item(s) | startup baseline=silent`);
    }catch(error){ console.log(`⚠️ FED LIVE baseline failed ${feed.id}:`,error.response?.status||error.message); }
  }
  initialized=true;
}

async function checkFedLiveNews(bot){
  const target=channelId(); if(!target){console.log('⚠️ FED LIVE skipped: MAIN_GROUP_ID is not configured');return;}
  if(!initialized){ await seedBaseline(); return; }
  for(const feed of FEEDS){
    try{
      const items=await fetchFeed(feed);
      const candidates=items.filter(isRelevant).slice(0,12).reverse();
      for(const item of candidates){
        const key=keyFor(feed.id,item); if(alreadySent(key)) continue;
        const message=await buildArabicMessage(feed,item);
        try{ await bot.telegram.sendMessage(target,message,{parse_mode:'HTML',disable_web_page_preview:true}); markSent(key); console.log(`🟥 FED LIVE sent: ${item.title||'untitled'}`); }
        catch(error){ console.log('⚠️ FED LIVE Telegram send failed:',error.message); }
      }
    }catch(error){ console.log(`⚠️ FED LIVE feed failed ${feed.id}:`,error.response?.status||error.message); }
  }
}

function startFedLiveNews(bot){ const intervalMs=Number(process.env.FED_LIVE_INTERVAL_MS)||60*1000; setTimeout(()=>{ checkFedLiveNews(bot).catch(error=>console.log('⚠️ FED LIVE initial check failed:',error.message)); setInterval(()=>{checkFedLiveNews(bot).catch(error=>console.log('⚠️ FED LIVE loop failed:',error.message));},intervalMs); console.log(`🏛️ FED LIVE Watch every ${Math.round(intervalMs/1000)} seconds | Arabic only | startup baseline=silent`); },7000); }
module.exports={checkFedLiveNews,startFedLiveNews};
