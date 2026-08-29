const { analyzePair } = require('./analysisService');
const { scanGoldScalp } = require('./goldScalper');
const { getPrice } = require('./marketService');
const { getOpenTrades, getManagedOpenTrades } = require('../database/trades');
const { isForexWeekend } = require('../utils/marketHours');

function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function directionFromAnalysis(a){const x=String(a?.signal?.action||'').toUpperCase();if(x==='BUY'||x==='SELL')return x;const e20=finite(a?.indicators?.ema20),e50=finite(a?.indicators?.ema50);return e20!==null&&e50!==null?(e20>=e50?'BUY':'SELL'):'WAIT';}
function marketMode(i={}){const adx=finite(i.adx),atr=finite(i.atr);if(adx!==null&&adx>=30)return'TRENDING';if(adx!==null&&adx<20)return'RANGE';if(atr!==null&&atr>=8)return'VOLATILE';return'MIXED';}
function strengthScore(a){const c=finite(a?.signal?.confidence),adx=finite(a?.indicators?.adx);if(c!==null)return Math.max(0,Math.min(100,Math.round(c)));if(adx!==null)return Math.max(0,Math.min(100,Math.round(adx*2)));return null;}
async function safe(label,fn,fallback){try{return await fn();}catch(error){console.log(`⚠️ COMMAND CENTER ${label}:`,error.message);return fallback;}}
function safeSync(fn,fallback){try{return fn();}catch{return fallback;}}

async function getTradingCommandCenterSnapshot(){
 const generatedAt=new Date(),weekend=isForexWeekend();
 const [analysis,scalp,price]=await Promise.all([safe('ANALYSIS',()=>analyzePair('XAUUSD'),null),safe('STRATEGIES',()=>scanGoldScalp(),{strategyChecks:[],readyResults:[]}),safe('PRICE',()=>getPrice('XAUUSD'),null)]);
 const checks=Array.isArray(scalp?.strategyChecks)?scalp.strategyChecks:[],readyResults=Array.isArray(scalp?.readyResults)?scalp.readyResults:[],readyById=new Map(readyResults.map(x=>[String(x.strategyId||'').toUpperCase(),x]));
 const strategies=checks.map(item=>{const ready=readyById.get(String(item.strategyId||'').toUpperCase());return{id:item.strategyId,label:item.strategyLabel,ready:Boolean(item.ready),status:item.status||'WAIT',direction:ready?.direction||null,score:finite(ready?.score)};});
 const managedOpen=safeSync(()=>getManagedOpenTrades(),[]),allOpen=safeSync(()=>getOpenTrades(),[]);
 return{generatedAt:generatedAt.toISOString(),marketOpen:!weekend,pair:'XAUUSD',price:finite(price),bias:directionFromAnalysis(analysis),strength:strengthScore(analysis),mode:marketMode(analysis?.indicators||{}),indicators:{rsi:finite(analysis?.indicators?.rsi),adx:finite(analysis?.indicators?.adx),atr:finite(analysis?.indicators?.atr),ema20:finite(analysis?.indicators?.ema20),ema50:finite(analysis?.indicators?.ema50)},strategies,consensus:{total:strategies.length,ready:strategies.filter(x=>x.ready).length,buy:strategies.filter(x=>x.ready&&x.direction==='BUY').length,sell:strategies.filter(x=>x.ready&&x.direction==='SELL').length,wait:strategies.filter(x=>!x.ready).length},portfolio:{managedOpen:managedOpen.length,allOpen:allOpen.length,maxManagedGold:2,remainingSlots:Math.max(0,2-managedOpen.length),trades:managedOpen.slice(0,5).map(t=>({id:t.id,source:t.telegram_id,action:t.action,entry:finite(t.entry),status:t.status}))},health:{analysis:Boolean(analysis),strategies:strategies.length>0,price:finite(price)!==null}};
}

function fmt(v){return finite(v)===null?'—':finite(v).toFixed(2);}
function biasArabic(b){return b==='BUY'?'📈 شراء':b==='SELL'?'📉 بيع':'⏳ انتظار';}
function biasEnglish(b){return b==='BUY'?'📈 BUY':b==='SELL'?'📉 SELL':'⏳ WAIT';}
function modeText(m,en=false){const ar={TRENDING:'سوق اتجاهي',RANGE:'سوق عرضي',VOLATILE:'تذبذب مرتفع',MIXED:'سوق مختلط'},eng={TRENDING:'Trending',RANGE:'Range',VOLATILE:'Volatile',MIXED:'Mixed'};return(en?eng:ar)[m]||m;}
function statusArabic(status){
 const s=String(status||'WAIT').toUpperCase();
 const exact={EXHAUSTION_BURST_TOO_SMALL:'الحركة الحالية غير قوية بما يكفي',RAPID_NO_BULLISH_H1_REGIME:'اتجاه الساعة لا يدعم الشراء السريع',GROK92_NO_EMA_RSI_TRIGGER:'لا يوجد تأكيد مناسب من EMA و RSI',PRO_BLOCKED_HOUR:'الاستراتيجية متوقفة في هذه الساعة',RANGE_MR_ADX_TOO_HIGH:'قوة الاتجاه مرتفعة والسوق غير مناسب للارتداد',SWEEP5_OUTSIDE_SESSION:'خارج جلسة عمل الاستراتيجية'};
 if(exact[s])return exact[s];
 if(s.includes('OUTSIDE_SESSION'))return'خارج جلسة عمل الاستراتيجية';
 if(s.includes('ADX'))return'شرط قوة الاتجاه غير مناسب';
 if(s.includes('RSI'))return'شرط RSI غير متحقق';
 if(s.includes('EMA'))return'شرط المتوسطات غير متحقق';
 if(s.includes('BLOCKED_HOUR'))return'الاستراتيجية متوقفة في هذه الساعة';
 if(s.includes('NO_')||s.includes('WAIT'))return'شروط الدخول غير مكتملة حاليًا';
 if(s.includes('ERROR'))return'حدث خطأ أثناء فحص الاستراتيجية';
 return'بانتظار اكتمال شروط الدخول';
}
function strategyName(x){return x.label||x.id||'استراتيجية';}
function healthArabic(s){return s.health.analysis&&s.health.strategies&&s.health.price?'🟢 جميع الأنظمة تعمل':'🟡 بعض البيانات غير متاحة';}

function renderVipCommandCenter(s,language='ar'){
 const en=language==='en';
 if(en)return`🧠 FOREX AI — LIVE MARKET INTELLIGENCE\n━━━━━━━━━━━━━━━━━━\n🥇 XAUUSD: ${fmt(s.price)}\n${s.marketOpen?'🟢 Market: OPEN':'🌙 Market: CLOSED'}\n📊 Market Bias: ${biasEnglish(s.bias)}\n🔥 Strength: ${s.strength??'—'}/100\n🌊 Market Mode: ${modeText(s.mode,true)}\n\n🤖 Strategy Consensus\n📈 BUY: ${s.consensus.buy}\n📉 SELL: ${s.consensus.sell}\n⏳ WAIT: ${s.consensus.wait}\n⚡ READY: ${s.consensus.ready}/${s.consensus.total}\n\n💼 Open managed trades: ${s.portfolio.managedOpen}/${s.portfolio.maxManagedGold}\n🎯 Available slots: ${s.portfolio.remainingSlots}\n\n🩺 System: ${s.health.analysis&&s.health.strategies&&s.health.price?'🟢 LIVE':'🟡 PARTIAL DATA'}\n🕒 Updated: ${new Date(s.generatedAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Cairo'})}`;
 return`🧠 FOREX AI — مركز ذكاء السوق\n━━━━━━━━━━━━━━━━━━\n🥇 الذهب XAUUSD: ${fmt(s.price)}\n${s.marketOpen?'🟢 السوق مفتوح':'🌙 السوق مغلق حاليًا'}\n📊 الميل الحالي: ${biasArabic(s.bias)}\n🔥 قوة الاتجاه: ${s.strength??'—'}/100\n🌊 حالة السوق: ${modeText(s.mode)}\n\n🤖 نظرة الاستراتيجيات\n📈 فرص شراء جاهزة: ${s.consensus.buy}\n📉 فرص بيع جاهزة: ${s.consensus.sell}\n⏳ في الانتظار: ${s.consensus.wait}\n⚡ الجاهز الآن: ${s.consensus.ready} من ${s.consensus.total}\n\n💼 الصفقات المفتوحة: ${s.portfolio.managedOpen} من ${s.portfolio.maxManagedGold}\n🎯 أماكن متاحة لصفقات جديدة: ${s.portfolio.remainingSlots}\n\n🩺 حالة النظام: ${healthArabic(s)}\n🕒 آخر تحديث: ${new Date(s.generatedAt).toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo'})}`;
}

function renderAdminCommandCenter(s){
 const strategyLines=s.strategies.length?s.strategies.map(x=>`${x.ready?'🟢':'🟡'} ${strategyName(x)}\n   ${x.ready?`✅ فرصة جاهزة: ${biasArabic(x.direction)}`:`⏳ انتظار — ${statusArabic(x.status)}`}${x.score!==null?`\n   ⭐ التقييم: ${x.score}/100`:''}`).join('\n\n'):'⚠️ لا توجد بيانات للاستراتيجيات';
 const tradeLines=s.portfolio.trades.length?s.portfolio.trades.map(t=>`#${t.id} • ${biasArabic(t.action)} • دخول ${fmt(t.entry)} • ${t.status}`).join('\n'):'✅ لا توجد صفقات مدارة مفتوحة حاليًا';
 return`🎛️ FOREX AI — مركز قيادة التداول\n━━━━━━━━━━━━━━━━━━\n🥇 الذهب XAUUSD: ${fmt(s.price)}\n${s.marketOpen?'🟢 السوق مفتوح':'🌙 السوق مغلق حاليًا'}\n📊 ميل السوق: ${biasArabic(s.bias)}\n🔥 قوة الاتجاه: ${s.strength??'—'}/100\n🌊 حالة السوق: ${modeText(s.mode)}\n\n📐 المؤشرات الفنية\nRSI: ${fmt(s.indicators.rsi)}\nADX: ${fmt(s.indicators.adx)}\nATR: ${fmt(s.indicators.atr)}\n\n🤖 حالة الاستراتيجيات — الجاهز ${s.consensus.ready}/${s.consensus.total}\n━━━━━━━━━━━━━━━━━━\n${strategyLines}\n\n🛡️ إدارة الصفقات\n━━━━━━━━━━━━━━━━━━\n💼 صفقات مفتوحة: ${s.portfolio.managedOpen}/${s.portfolio.maxManagedGold}\n🎯 أماكن متاحة: ${s.portfolio.remainingSlots}\n${tradeLines}\n\n🩺 حالة أنظمة البوت\nتحليل السوق: ${s.health.analysis?'✅ يعمل':'❌ متوقف'}\nفحص الاستراتيجيات: ${s.health.strategies?'✅ يعمل':'❌ متوقف'}\nسعر الذهب: ${s.health.price?'✅ متصل':'❌ غير متاح'}\n\n🕒 آخر تحديث بتوقيت القاهرة: ${new Date(s.generatedAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}\n\n🔒 المركز للمراقبة والتشخيص فقط ولا يغير شروط أو قرارات الاستراتيجيات.`;
}

module.exports={getTradingCommandCenterSnapshot,renderVipCommandCenter,renderAdminCommandCenter};
