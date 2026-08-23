const legacyRegister = require('./userLegacy');
const config = require('../config');
const { findUser } = require('../database/users');
const { analyzePair } = require('../services/analysisService');
const { getCandles } = require('../services/marketService');
const { calculateTradeLevels } = require('../services/tradeEngine');
const { runSignalLab } = require('../services/signalLab');
const { mainKeyboard } = require('../keyboards/main');

function languageOf(ctx){const u=findUser(ctx.from?.id);return u&&u.language==='en'?'en':'ar';}
function isEnglish(ctx){return languageOf(ctx)==='en';}
function vipAllowed(ctx){const u=findUser(ctx.from?.id);const admins=(config.adminIds||[]).map(String);return admins.includes(String(ctx.from?.id))||Boolean(u&&u.is_vip);}
function keyboard(ctx){const u=findUser(ctx.from?.id);const admins=(config.adminIds||[]).map(String);return mainKeyboard(languageOf(ctx),admins.includes(String(ctx.from?.id)),Boolean(u&&u.is_vip));}
function fmt(v){return Number.isFinite(Number(v))?Number(v).toFixed(2):'—';}

function directionalMarketScore(analysis, selectedDirection){
  const i=analysis?.indicators||{};const e20=Number(i.ema20),e50=Number(i.ema50),rsi=Number(i.rsi),adx=Number(i.adx),m=Number(i.macd?.macd),ms=Number(i.macd?.signal);
  const marketDirection=analysis?.signal?.action==='BUY'||analysis?.signal?.action==='SELL'?analysis.signal.action:(Number.isFinite(e20)&&Number.isFinite(e50)?(e20>=e50?'BUY':'SELL'):'WAIT');
  let score=0;if(selectedDirection===marketDirection)score+=35;
  if(Number.isFinite(e20)&&Number.isFinite(e50)){if(selectedDirection==='BUY'&&e20>e50)score+=20;if(selectedDirection==='SELL'&&e20<e50)score+=20;}
  if(Number.isFinite(rsi)){if(selectedDirection==='BUY'&&rsi>=50&&rsi<=70)score+=15;if(selectedDirection==='SELL'&&rsi<=50&&rsi>=30)score+=15;}
  if(Number.isFinite(m)&&Number.isFinite(ms)){if(selectedDirection==='BUY'&&m>ms)score+=15;if(selectedDirection==='SELL'&&m<ms)score+=15;}
  if(Number.isFinite(adx)&&adx>=25)score+=15;
  return{score:Math.max(0,Math.min(100,score)),marketDirection};
}

function historicalText(lab,en){
  if(!lab||!lab.similarSetups){return en?`\n━━━━━━━━━━━━━━━━━━\n🧪 HISTORICAL SIGNAL LAB\n📚 No usable similar cases yet.\nℹ️ ${lab?.reason||'Gold history unavailable.'}`:`\n━━━━━━━━━━━━━━━━━━\n🧪 الحالات التاريخية المشابهة\n📚 لا توجد حالات كافية قابلة للمقارنة حاليًا.\nℹ️ ${lab?.reason||'تاريخ الذهب غير متاح.'}`;}
  const examples=(lab.examples||[]).slice(0,3).map(x=>`${x.date} • ${x.similarity}% • ${x.tp2Hit?'TP2':x.tp1Hit?'TP1':x.slHit?'SL':'—'}`).join('\n');
  return en?`\n━━━━━━━━━━━━━━━━━━\n🧪 HISTORICAL SIGNAL LAB — GOLD\n📚 Similar cases: ${lab.similarSetups}\n⭐ Historical score: ${lab.historicalScore}/100\n🎯 TP1 success: ${lab.tp1Rate}%\n🏆 TP2 success: ${lab.tp2Rate}%\n🛑 SL rate: ${lab.slRate}%\n${lab.approved?'✅ Historical behavior supports this direction.':'⚠️ Historical behavior does not strongly support this direction.'}${examples?`\n\nClosest examples:\n${examples}`:''}`:`\n━━━━━━━━━━━━━━━━━━\n🧪 الحالات التاريخية المشابهة — الذهب\n📚 عدد الحالات المشابهة: ${lab.similarSetups}\n⭐ التقييم التاريخي: ${lab.historicalScore}/100\n🎯 نسبة نجاح TP1: ${lab.tp1Rate}%\n🏆 نسبة نجاح TP2: ${lab.tp2Rate}%\n🛑 نسبة ضرب SL: ${lab.slRate}%\n${lab.approved?'✅ السلوك التاريخي يدعم الاتجاه الحالي.':'⚠️ السلوك التاريخي لا يعطي دعمًا قويًا للاتجاه الحالي.'}${examples?`\n\nأقرب أمثلة:\n${examples}`:''}`;
}

async function buildGoldCheck(ctx,type,direction){
  const en=isEnglish(ctx),timeframe=type==='scalp'?'5min':'15min';
  const [analysis,candles]=await Promise.all([analyzePair('XAUUSD'),getCandles('XAUUSD',timeframe)]);
  if(!analysis||!Array.isArray(candles)||candles.length<20)throw new Error('Insufficient market data');
  const levels=calculateTradeLevels(candles,direction,'XAUUSD');if(!levels)throw new Error('Unable to calculate trade levels');
  const {score,marketDirection}=directionalMarketScore(analysis,direction);const confidence=Number(analysis?.signal?.confidence||0);
  const entry=Number(levels.entry),sl=Number(levels.sl??levels.stopLoss),tp1=Number(levels.tp1??levels.target1),tp2=Number(levels.tp2??levels.target2);
  const risk=Number.isFinite(entry)&&Number.isFinite(sl)?Math.abs(entry-sl):0;const rr1=risk>0&&Number.isFinite(tp1)?Math.abs(tp1-entry)/risk:null;const rr2=risk>0&&Number.isFinite(tp2)?Math.abs(tp2-entry)/risk:null;
  const lab=await runSignalLab('XAUUSD',analysis.indicators||{},direction,{timeframe});
  const marketText=marketDirection==='BUY'?'📈 BUY':marketDirection==='SELL'?'📉 SELL':'⏳ WAIT';const typeText=type==='scalp'?(en?'⚡ Scalping':'⚡ سكالب'):(en?'📈 Intraday':'📈 إنتراداي');
  const align=marketDirection!==direction?(en?'🔴 Your direction is against the current market.':'🔴 اختيارك عكس اتجاه السوق الحالي.'):(score>=70?(en?'🟢 Your direction is aligned with the current market.':'🟢 اختيارك متوافق مع اتجاه السوق الحالي.'):(en?'🟡 Direction is aligned, but confirmation is moderate.':'🟡 الاتجاه متوافق لكن التأكيد متوسط.'));
  const base=en?`🥇 VIP GOLD TRADE CHECK\n━━━━━━━━━━━━━━━━━━\n\n⚙️ Type: ${typeText}\n🎯 Your direction: ${direction}\n📊 Market direction: ${marketText}\n\n${align}\n\n━━━━━━━━━━━━━━━━━━\n💰 Entry: ${fmt(entry)}\n🛑 Stop Loss: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}\n🏆 TP2: ${fmt(tp2)}\n\n⚖️ Risk / Reward\nTP1 → ${rr1?`1:${rr1.toFixed(2)}`:'—'}\nTP2 → ${rr2?`1:${rr2.toFixed(2)}`:'—'}\n\n━━━━━━━━━━━━━━━━━━\n⭐ Market Score: ${score}/100\n🤖 AI Confidence: ${Number.isFinite(confidence)?confidence:0}%\n⏱️ Analysis timeframe: ${timeframe}`:`🥇 اختبار صفقة الذهب — VIP\n━━━━━━━━━━━━━━━━━━\n\n⚙️ نوع الصفقة: ${typeText}\n🎯 اختيارك: ${direction}\n📊 اتجاه السوق: ${marketText}\n\n${align}\n\n━━━━━━━━━━━━━━━━━━\n💰 الدخول: ${fmt(entry)}\n🛑 وقف الخسارة: ${fmt(sl)}\n🎯 الهدف الأول TP1: ${fmt(tp1)}\n🏆 الهدف الثاني TP2: ${fmt(tp2)}\n\n⚖️ العائد للمخاطرة\nTP1 → ${rr1?`1:${rr1.toFixed(2)}`:'—'}\nTP2 → ${rr2?`1:${rr2.toFixed(2)}`:'—'}\n\n━━━━━━━━━━━━━━━━━━\n⭐ قوة الصفقة: ${score}/100\n🤖 ثقة AI: ${Number.isFinite(confidence)?confidence:0}%\n⏱️ فريم التحليل: ${timeframe}`;
  return base+historicalText(lab,en)+(en?'\n\n⚠️ Historical similarity is analytical evidence, not a guarantee of profit.':'\n\n⚠️ الحالات التاريخية أداة تحليلية وليست ضمانًا للربح.');
}

function registerUserCommands(bot){
  for(const type of ['scalp','intraday'])for(const direction of ['buy','sell']){
    bot.action(`viptrade_${type}_${direction}`,async ctx=>{
      await ctx.answerCbQuery(isEnglish(ctx)?'Analyzing current + historical cases...':'جاري تحليل السوق والحالات التاريخية...').catch(()=>null);
      if(!vipAllowed(ctx))return ctx.reply(isEnglish(ctx)?'💎 VIP membership required.':'💎 يلزم اشتراك VIP.');
      try{const result=await buildGoldCheck(ctx,type,direction.toUpperCase());return ctx.reply(result,keyboard(ctx));}
      catch(error){console.log('VIP historical trade checker error:',error.stack||error.message);return ctx.reply(isEnglish(ctx)?'❌ Could not complete the Gold trade analysis right now.':'❌ تعذر إكمال تحليل صفقة الذهب حاليًا.');}
    });
  }
  return legacyRegister(bot);
}

module.exports=registerUserCommands;
