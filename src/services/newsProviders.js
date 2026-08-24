const axios = require('axios');
const crypto = require('crypto');
const { getOfficialCalendar } = require('./officialNewsProviders');

const PROVIDERS = {
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

let cache={time:0,data:[],providers:[],officialHealth:[]};
let inFlight=null;
const CACHE_MS=10*60*1000;
const FORCE_MIN_INTERVAL_MS=Number(process.env.NEWS_PROVIDER_FORCE_MIN_INTERVAL_MS)||45000;

async function getMultiSourceCalendar(forceRefresh=false){
  const now=Date.now();

  // Protect the provider layer itself, not only callers using newsCalendarGate.
  // Any direct caller now shares the same refresh instead of duplicating every
  // official/provider request in parallel.
  if(inFlight){
    console.log('⏳ Waiting existing provider calendar refresh');
    return inFlight;
  }

  if(cache.data.length){
    const age=now-cache.time;
    if(!forceRefresh&&age<CACHE_MS)return cache;
    if(forceRefresh&&age<FORCE_MIN_INTERVAL_MS)return cache;
  }

  inFlight=(async()=>{
    try{
      const started=new Date();
      const from=started.toISOString().slice(0,10);
      const to=new Date(started.getTime()+7*86400000).toISOString().slice(0,10);
      const collected=[];
      const providersUsed=[];
      let officialHealth=[];

      try{
        const official=await getOfficialCalendar();
        officialHealth=official.health||[];
        if(Array.isArray(official.events)&&official.events.length){
          collected.push(...official.events);
          providersUsed.push(...officialHealth.filter(x=>x.ok).map(x=>x.provider));
        }
      }catch(error){
        console.log('⚠️ Official calendar layer failed:',error.message);
      }

      for(const[name,provider]of Object.entries(PROVIDERS)){
        if(!provider.enabled())continue;
        try{
          const rows=await provider.fetch(from,to);
          const normalized=rows.map(item=>normalizeEvent(name,item)).filter(Boolean);
          if(normalized.length){
            collected.push(...normalized);
            providersUsed.push(name);
          }
          console.log(`📰 ${name}: ${normalized.length} events`);
        }catch(error){
          console.log(`⚠️ News provider ${name} failed:`,error.response?.status||'',error.message);
        }
      }

      const data=mergeEvents(collected);
      cache={time:Date.now(),data,providers:[...new Set(providersUsed)],officialHealth};
      return cache;
    }finally{
      inFlight=null;
    }
  })();

  return inFlight;
}
function isHighImpact(event){if(event.impact==='high')return true;const title=canonicalTitle(event.title),strongPatterns=['nonfarm payroll','non farm payroll','nfp','consumer price index','cpi','core cpi','fomc','interest rate','rate decision','federal funds rate','pce','core pce','gross domestic product','gdp','unemployment rate','jobless claims','retail sales','powell'];return strongPatterns.some(pattern=>title.includes(pattern));}
function eventHash(event){return crypto.createHash('sha1').update(eventKey(event)).digest('hex').slice(0,20);}
function affectedPairs(event){const c=event.currency,pairs=new Set();if(c==='USD')['XAUUSD','EURUSD','GBPUSD','USDJPY','BTCUSD'].forEach(x=>pairs.add(x));if(c==='EUR')['EURUSD','EURJPY'].forEach(x=>pairs.add(x));if(c==='GBP')['GBPUSD','GBPJPY'].forEach(x=>pairs.add(x));if(c==='JPY')['USDJPY','EURJPY','GBPJPY','CHFJPY'].forEach(x=>pairs.add(x));if(c==='CHF')['CHFJPY'].forEach(x=>pairs.add(x));return [...pairs];}
module.exports={getMultiSourceCalendar,isHighImpact,eventHash,affectedPairs};
