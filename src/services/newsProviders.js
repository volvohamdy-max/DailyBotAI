const axios = require('axios');
const crypto = require('crypto');
const { getOfficialCalendar } = require('./officialNewsProviders');

const PROVIDERS = {
  // Forex-native fallback. FXStreet exposes a dedicated economic-calendar API
  // and does not require us to scrape its website. Enabled by default; set
  // ENABLE_FXSTREET_NEWS=false if it ever needs to be disabled operationally.
  fxstreet: {
    enabled: () => process.env.ENABLE_FXSTREET_NEWS !== 'false',
    async fetch(from, to) {
      const fromUtc = `${from}T00:00:00Z`;
      const toUtc = `${to}T23:59:59Z`;
      const url = `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${encodeURIComponent(fromUtc)}/${encodeURIComponent(toUtc)}`;
      const { data } = await axios.get(url, {
        timeout: 15000,
        headers: { Accept: 'application/json' }
      });
      const rows = Array.isArray(data) ? data : Array.isArray(data?.eventDates) ? data.eventDates : Array.isArray(data?.data) ? data.data : [];
      return rows.map((x) => ({
        ...x,
        event: x.event?.name || x.event?.title || x.name || x.title || x.eventName,
        date: x.dateUtc || x.date || x.datetime || x.eventDate,
        country: x.country?.name || x.countryName || x.country,
        currency: x.currency?.code || x.currencyCode || x.currency,
        impact: x.volatility || x.impact || x.potency,
        actual: x.actual ?? x.actualValue,
        forecast: x.consensus ?? x.forecast ?? x.consensusValue,
        previous: x.previous ?? x.previousValue,
        id: x.id || x.eventDateId
      }));
    }
  },

  fmp: {
    enabled: () => process.env.ENABLE_FMP_NEWS === 'true' && Boolean(process.env.FMP_API_KEY),
    async fetch(from, to) {
      const url = 'https://financialmodelingprep.com/stable/economic-calendar';
      const { data } = await axios.get(url, { params: { from, to, apikey: process.env.FMP_API_KEY }, timeout: 15000 });
      return Array.isArray(data) ? data : [];
    }
  },
  tradingEconomics: {
    enabled: () => process.env.ENABLE_TRADING_ECONOMICS_NEWS === 'true' && Boolean(process.env.TRADING_ECONOMICS_KEY),
    async fetch(from, to) {
      const url = 'https://api.tradingeconomics.com/calendar/country/all';
      const { data } = await axios.get(url, { params: { c: process.env.TRADING_ECONOMICS_KEY, d1: from, d2: to }, timeout: 15000 });
      return Array.isArray(data) ? data : [];
    }
  },
  finnhub: {
    enabled: () => process.env.ENABLE_FINNHUB_NEWS === 'true' && Boolean(process.env.FINNHUB_API_KEY),
    async fetch(from, to) {
      const url = 'https://finnhub.io/api/v1/calendar/economic';
      const { data } = await axios.get(url, { params: { from, to, token: process.env.FINNHUB_API_KEY }, timeout: 15000 });
      return Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
    }
  },
  eodhd: {
    enabled: () => process.env.ENABLE_EODHD_NEWS === 'true' && Boolean(process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN),
    async fetch(from, to) {
      const token = process.env.EODHD_API_KEY || process.env.EODHD_API_TOKEN;
      const { data } = await axios.get('https://eodhd.com/api/economic-events', { params: { api_token: token, from, to, fmt: 'json' }, timeout: 15000 });
      return Array.isArray(data) ? data : [];
    }
  }
};

function safeDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function normalizeImpact(value) {
  const text = String(value ?? '').trim().toLowerCase(); if (!text) return 'unknown';
  if (['3','3.0'].includes(text) || text.includes('high') || text.includes('maximum')) return 'high';
  if (['2','2.0'].includes(text) || text.includes('medium') || text.includes('moderate')) return 'medium';
  if (['1','1.0'].includes(text) || text.includes('low') || text.includes('minimum')) return 'low';
  return text;
}
function normalizeCurrency(item) {
  const raw=String(item.currency||item.Currency||item.country||item.Country||'').toUpperCase();
  const map={'UNITED STATES':'USD','US':'USD','USA':'USD','UNITED KINGDOM':'GBP','UK':'GBP','EURO AREA':'EUR','EUROZONE':'EUR','JAPAN':'JPY','SWITZERLAND':'CHF'};
  if(map[raw])return map[raw]; if(/^[A-Z]{3}$/.test(raw))return raw; return raw;
}
function normalizeEvent(provider,item){
  const title=String(item.event||item.Event||item.title||item.name||item.indicator||item.Indicator||'').trim();
  const date=safeDate(item.date||item.Date||item.datetime||item.time||item.releaseDate||item.release_date); if(!title||!date)return null;
  return {provider,providerId:String(item.id||item.event_id||item.CalendarId||item.calendarId||''),title,currency:normalizeCurrency(item),country:String(item.country||item.Country||''),impact:normalizeImpact(item.impact||item.Importance||item.importance||item.volatility),date:date.toISOString(),actual:item.actual??item.Actual??null,forecast:item.forecast??item.estimate??item.Forecast??item.Consensus??null,previous:item.previous??item.prev??item.Previous??null,raw:item};
}
function canonicalTitle(title){return String(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\b(final|prelim|preliminary|revised|flash)\b/g,'').replace(/\s+/g,' ').trim();}
function eventKey(event){const d=new Date(event.date),bucket=Math.floor(d.getTime()/(10*60*1000));return `${event.currency}|${canonicalTitle(event.title)}|${bucket}`;}
function mergeEvents(events){const map=new Map();for(const event of events){const key=eventKey(event);if(!map.has(key)){map.set(key,{...event,sources:[event.provider],sourceCount:1});continue;}const e=map.get(key);e.sources=[...new Set([...e.sources,event.provider])];e.sourceCount=e.sources.length;if(!e.actual&&event.actual!=null)e.actual=event.actual;if(!e.forecast&&event.forecast!=null)e.forecast=event.forecast;if(!e.previous&&event.previous!=null)e.previous=event.previous;if(e.impact!=='high'&&event.impact==='high')e.impact='high';}return [...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));}
let cache={time:0,data:[],providers:[],officialHealth:[]}; const CACHE_MS=10*60*1000;
async function getMultiSourceCalendar(forceRefresh=false){
  if(!forceRefresh&&cache.data.length&&Date.now()-cache.time<CACHE_MS)return cache;
  if(forceRefresh)console.log('🔄 Force refreshing economic calendar...');
  const now=new Date(),from=now.toISOString().slice(0,10),to=new Date(now.getTime()+7*86400000).toISOString().slice(0,10),collected=[],providersUsed=[];let officialHealth=[];
  try{const official=await getOfficialCalendar();officialHealth=official.health||[];if(Array.isArray(official.events)&&official.events.length){collected.push(...official.events);providersUsed.push(...officialHealth.filter(x=>x.ok).map(x=>x.provider));}}catch(error){console.log('⚠️ Official calendar layer failed:',error.message);}
  for(const[name,provider]of Object.entries(PROVIDERS)){if(!provider.enabled())continue;try{const rows=await provider.fetch(from,to),normalized=rows.map(item=>normalizeEvent(name,item)).filter(Boolean);if(normalized.length){collected.push(...normalized);providersUsed.push(name);}console.log(`📰 ${name}: ${normalized.length} events`);}catch(error){console.log(`⚠️ News provider ${name} failed:`,error.response?.status||'',error.message);}}
  const data=mergeEvents(collected);cache={time:Date.now(),data,providers:[...new Set(providersUsed)],officialHealth};return cache;
}
function isHighImpact(event){if(event.impact==='high')return true;const title=canonicalTitle(event.title),strongPatterns=['nonfarm payroll','non farm payroll','nfp','consumer price index','cpi','core cpi','fomc','interest rate','rate decision','federal funds rate','pce','core pce','gross domestic product','gdp','unemployment rate','jobless claims','retail sales','powell'];return strongPatterns.some(pattern=>title.includes(pattern));}
function eventHash(event){return crypto.createHash('sha1').update(eventKey(event)).digest('hex').slice(0,20);}
function affectedPairs(event){const c=event.currency,pairs=new Set();if(c==='USD')['XAUUSD','EURUSD','GBPUSD','USDJPY','BTCUSD'].forEach(x=>pairs.add(x));if(c==='EUR')['EURUSD','EURJPY'].forEach(x=>pairs.add(x));if(c==='GBP')['GBPUSD','GBPJPY'].forEach(x=>pairs.add(x));if(c==='JPY')['USDJPY','EURJPY','GBPJPY','CHFJPY'].forEach(x=>pairs.add(x));if(c==='CHF')['CHFJPY'].forEach(x=>pairs.add(x));return [...pairs];}
module.exports={getMultiSourceCalendar,isHighImpact,eventHash,affectedPairs};
