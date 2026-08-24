const axios = require('axios');

const translations = {
  'Federal Reserve': 'الاحتياطي الفيدرالي الأمريكي', 'Interest Rates': 'أسعار الفائدة', 'Interest Rate': 'قرار الفائدة',
  'CPI': 'مؤشر أسعار المستهلكين', 'Inflation': 'التضخم', 'NFP': 'تقرير الوظائف الأمريكي',
  'Non Farm Payrolls': 'الوظائف غير الزراعية', 'Non-Farm Payrolls': 'الوظائف غير الزراعية', 'GDP': 'الناتج المحلي الإجمالي',
  'Unemployment': 'البطالة', 'FOMC': 'الفيدرالي الأمريكي', 'European Central Bank': 'البنك المركزي الأوروبي',
  'Bank of England': 'بنك إنجلترا', 'Bank of Japan': 'بنك اليابان', 'Treasury': 'وزارة الخزانة',
  'Retail Sales': 'مبيعات التجزئة', 'Consumer Confidence': 'ثقة المستهلك', 'Consumer Sentiment': 'معنويات المستهلك',
  'Producer Price Index': 'مؤشر أسعار المنتجين', 'Consumer Price Index': 'مؤشر أسعار المستهلكين',
  'Jobless Claims': 'طلبات إعانة البطالة', 'PMI': 'مؤشر مديري المشتريات',
  'tariffs': 'الرسوم الجمركية', 'tariff': 'الرسوم الجمركية',
  'Bitcoin': 'بيتكوين', 'Ethereum': 'إيثريوم', 'crypto market': 'سوق العملات الرقمية',
  'crypto markets': 'أسواق العملات الرقمية', 'cryptocurrency': 'العملات الرقمية', 'cryptocurrencies': 'العملات الرقمية',
  'stablecoin': 'عملة مستقرة', 'stablecoins': 'عملات مستقرة', 'exchange': 'منصة تداول', 'exchanges': 'منصات التداول',
  'ETF': 'صندوق متداول', 'ETFs': 'صناديق متداولة', 'hack': 'اختراق', 'hacked': 'تعرّض للاختراق',
  'hacker': 'مخترق', 'hackers': 'مخترقون', 'exploit': 'ثغرة', 'exploits': 'ثغرات', 'security breach': 'اختراق أمني',
  'breach': 'اختراق', 'attack': 'هجوم', 'attacks': 'هجمات', 'vault': 'خزينة', 'governance': 'الحوكمة',
  'protocol': 'بروتوكول', 'network': 'شبكة', 'blockchain': 'بلوكتشين', 'wallet': 'محفظة', 'wallets': 'محافظ',
  'token': 'عملة رقمية', 'tokens': 'عملات رقمية', 'price': 'سعر', 'prices': 'الأسعار', 'rises': 'يرتفع',
  'rise': 'ارتفاع', 'surges': 'يقفز', 'surge': 'قفزة', 'jumps': 'يقفز', 'jump': 'قفزة', 'gains': 'مكاسب',
  'gain': 'مكسب', 'falls': 'يتراجع', 'fall': 'تراجع', 'drops': 'ينخفض', 'drop': 'انخفاض', 'slumps': 'يهوي',
  'slump': 'هبوط حاد', 'loses': 'يخسر', 'lost': 'خسر', 'losses': 'خسائر', 'loss': 'خسارة', 'estimated': 'تُقدّر بنحو',
  'million': 'مليون', 'billion': 'مليار', 'trillion': 'تريليون', 'investors': 'المستثمرون', 'investor': 'مستثمر',
  'traders': 'المتداولون', 'trader': 'متداول', 'regulation': 'التنظيم', 'regulator': 'الجهة التنظيمية',
  'regulators': 'الجهات التنظيمية', 'approval': 'موافقة', 'approved': 'تمت الموافقة على', 'launches': 'يطلق',
  'launch': 'إطلاق', 'announces': 'يعلن', 'announced': 'أعلن', 'announcement': 'إعلان', 'partnership': 'شراكة',
  'acquisition': 'استحواذ', 'lawsuit': 'دعوى قضائية', 'settlement': 'تسوية', 'liquidation': 'تصفية',
  'liquidations': 'تصفيات', 'volume': 'حجم التداول', 'market cap': 'القيمة السوقية', 'record high': 'مستوى قياسي',
  'all-time high': 'أعلى مستوى تاريخي', 'record low': 'مستوى قياسي منخفض'
};

const cache = new Map();
const CACHE_LIMIT = 800;
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NEWS_TRANSLATE_MIN_INTERVAL_MS) || 5000;
const GOOGLE_COOLDOWN_MS = Number(process.env.NEWS_TRANSLATE_429_COOLDOWN_MS) || 30 * 60 * 1000;
const SECONDARY_MIN_INTERVAL_MS = Number(process.env.NEWS_TRANSLATE_SECONDARY_MIN_INTERVAL_MS) || 2500;
let translateQueue = Promise.resolve();
let lastGoogleRequestAt = 0;
let lastSecondaryRequestAt = 0;
let googleCooldownUntil = 0;
let googleCooldownLogged = false;

function escapeRegExp(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function translateNews(text) {
  let result = String(text || '');
  const entries = Object.entries(translations).sort((a,b) => b[0].length-a[0].length);
  for (const [key,value] of entries) result = result.replace(new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi'), value);
  return result.replace(/\s{2,}/g,' ').trim();
}
function hasArabic(text) { return /[\u0600-\u06FF]/.test(String(text||'')); }
function latinWordCount(text) { return (String(text||'').match(/[A-Za-z]{2,}/g)||[]).length; }
function isCompleteArabic(text) {
  const s=String(text||'').trim();
  if (!s || !hasArabic(s)) return false;
  const latin=(s.match(/[A-Za-z]/g)||[]).length;
  const arabic=(s.match(/[\u0600-\u06FF]/g)||[]).length;
  return latinWordCount(s) <= 6 && latin <= Math.max(24, Math.floor(arabic*0.35));
}
function cleanForTranslation(text) {
  return String(text||'').replace(/https?:\/\/\S+/gi,'').replace(/\bRead\s+More\s*👈?/gi,'').replace(/\bRead\s+More\b/gi,'')
    .replace(/Telegram\.me\/\S+/gi,'').replace(/t\.me\/\S+/gi,'').replace(/\s*\.\.\.\s*$/g,'').replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n').trim();
}
function cacheSet(key,value){ if(cache.size>=CACHE_LIMIT){const first=cache.keys().next().value;if(first)cache.delete(first);} cache.set(key,value); }
function localTranslation(clean){ const local=translateNews(clean); if(local && isCompleteArabic(local)){cacheSet(clean,local);return local;} return null; }
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function secondaryTranslate(clean) {
  const waitMs=Math.max(0,SECONDARY_MIN_INTERVAL_MS-(Date.now()-lastSecondaryRequestAt));
  if(waitMs>0) await sleep(waitMs);
  lastSecondaryRequestAt=Date.now();
  try {
    const {data}=await axios.get('https://api.mymemory.translated.net/get', {
      timeout:Number(process.env.NEWS_TRANSLATE_TIMEOUT_MS)||8000,
      params:{q:clean,langpair:'en|ar'},
      headers:{'User-Agent':'ForexAIBot/1.0'}
    });
    const translated=String(data?.responseData?.translatedText||'').trim();
    if(!isCompleteArabic(translated)) throw new Error('Secondary translation returned incomplete Arabic text');
    cacheSet(clean,translated);
    console.log('✅ News Arabic translation via secondary provider');
    return translated;
  } catch(error) {
    console.log('⚠️ Secondary Arabic translation failed:', error.response?.status || error.message);
    return null;
  }
}

async function googleTranslate(clean){
  if(Date.now()<googleCooldownUntil) return null;
  const waitMs=Math.max(0,MIN_REQUEST_INTERVAL_MS-(Date.now()-lastGoogleRequestAt)); if(waitMs>0)await sleep(waitMs); lastGoogleRequestAt=Date.now();
  try{
    const {data}=await axios.get('https://translate.googleapis.com/translate_a/single',{timeout:Number(process.env.NEWS_TRANSLATE_TIMEOUT_MS)||8000,
      params:{client:'gtx',sl:'auto',tl:'ar',dt:'t',q:clean},headers:{'User-Agent':'Mozilla/5.0 (compatible; ForexAIBot/1.0)'}});
    const translated=Array.isArray(data?.[0])?data[0].map(p=>Array.isArray(p)?p[0]:'').filter(Boolean).join('').trim():'';
    if(!isCompleteArabic(translated)) throw new Error('Google translation returned incomplete Arabic text');
    googleCooldownLogged=false; cacheSet(clean,translated); return translated;
  }catch(error){
    const status=Number(error.response?.status||0);
    if(status===429){googleCooldownUntil=Date.now()+GOOGLE_COOLDOWN_MS;if(!googleCooldownLogged){googleCooldownLogged=true;console.log(`⚠️ Google news translation cooldown ${Math.round(GOOGLE_COOLDOWN_MS/60000)}m; secondary provider active`);}}
    else console.log('⚠️ Google Arabic translation failed:',error.message);
    return null;
  }
}

async function remoteTranslate(clean){
  // Prefer Google while healthy, then immediately fail over to a second provider.
  const google=await googleTranslate(clean);
  if(google) return google;
  return secondaryTranslate(clean);
}

async function translateToArabic(text){
  const clean=cleanForTranslation(text); if(!clean)return '';
  if(isCompleteArabic(clean))return clean;
  if(cache.has(clean))return cache.get(clean);
  const local=localTranslation(clean); if(local)return local;
  const task=translateQueue.then(()=>{if(cache.has(clean))return cache.get(clean);const again=localTranslation(clean);if(again)return again;return remoteTranslate(clean);});
  translateQueue=task.catch(()=>null); return task;
}
module.exports={translateNews,translateToArabic,cleanForTranslation,isCompleteArabic};
