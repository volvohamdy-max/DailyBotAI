const { analyzePair } = require('./analysisService');
const { getCandles, getPrice } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');

const TYPES = {
  scalp: { labelAr: '⚡ سكالبينج', labelEn: '⚡ Scalping', timeframe: '5min', minScore: 68 },
  intraday: { labelAr: '📊 تداول يومي', labelEn: '📊 Intraday', timeframe: '15min', minScore: 65 },
  swing: { labelAr: '📈 سوينج', labelEn: '📈 Swing', timeframe: '4h', minScore: 62 },
  trend: { labelAr: '🧭 مع الاتجاه', labelEn: '🧭 Trend', timeframe: '1h', minScore: 65 },
  reversal: { labelAr: '🔄 انعكاس', labelEn: '🔄 Reversal', timeframe: '15min', minScore: 70 }
};

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function directionFrom(a){
  const i=a?.indicators||{};let buy=0,sell=0;
  const e20=n(i.ema20),e50=n(i.ema50),r=n(i.rsi),adx=n(i.adx),m=n(i.macd?.macd),ms=n(i.macd?.signal);
  if(e20!==null&&e50!==null){e20>e50?buy++:sell++;}
  if(r!==null){r>52?buy++:r<48?sell++:null;}
  if(m!==null&&ms!==null){m>ms?buy++:sell++;}
  if(adx!==null&&adx>=20){buy>sell?buy++:sell>buy?sell++:null;}
  if(buy===sell)return null;return buy>sell?'BUY':'SELL';
}
function scoreAnalysis(a,d,type){
  const i=a?.indicators||{};let score=0;
  const e20=n(i.ema20),e50=n(i.ema50),r=n(i.rsi),adx=n(i.adx),m=n(i.macd?.macd),ms=n(i.macd?.signal);
  if(e20!==null&&e50!==null&&((d==='BUY'&&e20>e50)||(d==='SELL'&&e20<e50)))score+=25;
  if(m!==null&&ms!==null&&((d==='BUY'&&m>ms)||(d==='SELL'&&m<ms)))score+=20;
  if(r!==null&&((d==='BUY'&&r>=50)||(d==='SELL'&&r<=50)))score+=15;
  if(adx!==null){if(adx>=25)score+=20;else if(adx>=18)score+=10;}
  if(a?.signal?.action===d)score+=10;
  const conf=n(a?.signal?.confidence);if(conf!==null)score+=Math.min(10,conf/10);
  if(type==='reversal'){
    const extreme=r!==null&&((d==='BUY'&&r<=42)||(d==='SELL'&&r>=58));
    if(extreme)score+=15;else score-=20;
  }
  return Math.max(0,Math.min(100,Math.round(score)));
}
async function candidate(type){
  const cfg=TYPES[type];if(!cfg)throw new Error('UNKNOWN_GOLD_TRADE_TYPE');
  const analysis=await analyzePair('XAUUSD',cfg.timeframe);
  if(!analysis?.indicators)return {type,cfg,available:false,reason:'DATA'};
  let direction=directionFrom(analysis);
  if(type==='reversal'){
    const r=n(analysis.indicators.rsi);
    if(r!==null&&r<=38)direction='BUY';else if(r!==null&&r>=62)direction='SELL';else return {type,cfg,available:false,reason:'NO_REVERSAL'};
  }
  if(!direction)return {type,cfg,available:false,reason:'NO_DIRECTION'};
  const score=scoreAnalysis(analysis,direction,type);
  if(score<cfg.minScore)return {type,cfg,available:false,reason:'WEAK',score,direction};
  const candles=await getCandles('XAUUSD',cfg.timeframe);
  if(!Array.isArray(candles)||candles.length<20)return {type,cfg,available:false,reason:'DATA'};
  let levels=calculateTradeLevels(candles,direction,'XAUUSD');
  if(!levels)return {type,cfg,available:false,reason:'LEVELS'};
  try{
    const live=n(await getPrice('XAUUSD')),old=n(levels.entry);
    if(live!==null&&old!==null){const shift=live-old;levels={...levels,entry:live,sl:n(levels.sl??levels.stopLoss)+shift,tp1:n(levels.tp1??levels.target1)+shift,tp2:n(levels.tp2??levels.target2)+shift};}
  }catch(e){}
  return {type,cfg,available:true,direction,score,confidence:n(analysis?.signal?.confidence)||0,levels};
}
async function getGoldTrade(type){return candidate(type);}
async function getBestGoldTrade(){
  const keys=Object.keys(TYPES);const results=[];
  for(const key of keys){try{results.push(await candidate(key));}catch(e){results.push({type:key,cfg:TYPES[key],available:false,reason:'ERROR'});}}
  const available=results.filter(x=>x.available).sort((a,b)=>b.score-a.score);
  return {best:available[0]||null,results};
}
function formatGoldTrade(result,lang='ar'){
  const en=lang==='en';
  if(!result?.available){
    const score=Number.isFinite(Number(result?.score))?`\n⭐ ${en?'Current score':'القوة الحالية'}: ${result.score}/100`:'';
    return en?`🔍 No suitable ${result?.cfg?.labelEn||'gold'} trade is available right now.${score}\n\n⏳ The bot will not force an entry when conditions are weak.`:`🔍 لا توجد صفقة ${result?.cfg?.labelAr||'ذهب'} مناسبة حاليًا.${score}\n\n⏳ البوت لن يجبر صفقة طالما شروط الدخول غير مكتملة.`;
  }
  const l=result.levels||{},entry=n(l.entry),sl=n(l.sl??l.stopLoss),tp1=n(l.tp1??l.target1),tp2=n(l.tp2??l.target2);
  const f=x=>x===null?'—':x.toFixed(2);const risk=entry!==null&&sl!==null?Math.abs(entry-sl):null;
  const rr1=risk&&tp1!==null?Math.abs(tp1-entry)/risk:null,rr2=risk&&tp2!==null?Math.abs(tp2-entry)/risk:null;
  const label=en?result.cfg.labelEn:result.cfg.labelAr;
  return en?`🥇 GOLD TRADE SUGGESTION\n━━━━━━━━━━━━━━━━━━\n⚙️ Type: ${label}\n⏱️ Timeframe: ${result.cfg.timeframe}\n📌 Direction: ${result.direction==='BUY'?'📈 BUY':'📉 SELL'}\n⭐ Strength: ${result.score}/100\n🤖 AI confidence: ${Math.round(result.confidence)}%\n\n💰 Entry: ${f(entry)}\n🛑 Stop Loss: ${f(sl)}\n🎯 TP1: ${f(tp1)}\n🏆 TP2: ${f(tp2)}\n⚖️ R:R TP1: ${rr1?`1:${rr1.toFixed(2)}`:'—'} | TP2: ${rr2?`1:${rr2.toFixed(2)}`:'—'}\n\n⚠️ Market analysis, not a guarantee of profit.`:`🥇 صفقة ذهب مقترحة\n━━━━━━━━━━━━━━━━━━\n⚙️ النوع: ${label}\n⏱️ الفريم: ${result.cfg.timeframe}\n📌 الاتجاه: ${result.direction==='BUY'?'📈 BUY':'📉 SELL'}\n⭐ قوة الفرصة: ${result.score}/100\n🤖 ثقة AI: ${Math.round(result.confidence)}%\n\n💰 الدخول: ${f(entry)}\n🛑 وقف الخسارة: ${f(sl)}\n🎯 الهدف الأول: ${f(tp1)}\n🏆 الهدف الثاني: ${f(tp2)}\n⚖️ العائد/المخاطرة TP1: ${rr1?`1:${rr1.toFixed(2)}`:'—'} | TP2: ${rr2?`1:${rr2.toFixed(2)}`:'—'}\n\n⚠️ تحليل لحظي للسوق وليس ضمانًا للربح.`;
}
module.exports={TYPES,getGoldTrade,getBestGoldTrade,formatGoldTrade};