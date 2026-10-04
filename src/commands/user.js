const legacyRegister = require('./userLegacy');
const config = require('../config');
const { findUser } = require('../database/users');
const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
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
  const en=isEnglish(ctx);
  const frames=[
    {key:'M5',interval:'5min'},
    {key:'M15',interval:'15min'},
    {key:'M30',interval:'30min'},
    {key:'H1',interval:'1h'},
    {key:'H4',interval:'4h'},
    {key:'D1',interval:'1day'},
    {key:'W1',interval:'1week'},
    {key:'MN',interval:'1month'}
  ];

  const results=[];
  for(const frame of frames){
    try{
      const [analysis,candles]=await Promise.all([
        analyzePair('XAUUSD',frame.interval),
        getGoldCandlesResilient(frame.interval)
      ]);
      if(!analysis||!Array.isArray(candles)||candles.length<20)throw new Error('Insufficient market data');
      const indicators=analysis.indicators||{};
      const e20=Number(indicators.ema20),e50=Number(indicators.ema50);
      const marketDirection=analysis?.signal?.action==='BUY'||analysis?.signal?.action==='SELL'
        ? analysis.signal.action
        : (Number.isFinite(e20)&&Number.isFinite(e50)?(e20>=e50?'BUY':'SELL'):'WAIT');
      const levels=marketDirection==='WAIT'?null:calculateTradeLevels(candles,marketDirection,'XAUUSD');
      results.push({frame:frame.key,interval:frame.interval,marketDirection,levels,analysis});
    }catch(error){
      console.log(`VIP multi-TF gold check ${frame.key} error:`,error.message);
      results.push({frame:frame.key,error:error.message});
    }
  }

  const header=en
    ? `🥇 VIP GOLD — MULTI-TIMEFRAME CHECK\n━━━━━━━━━━━━━━━━━━\n🎯 Your selected direction: ${direction}\nℹ️ Each timeframe below is evaluated independently.`
    : `🥇 اختبار صفقة الذهب — تحليل كل الفريمات\n━━━━━━━━━━━━━━━━━━\n🎯 اتجاهك المختار: ${direction}\nℹ️ كل فريم يتم تحليله وحساب مستوياته بشكل مستقل.`;

  const blocks=results.map(r=>{
    if(r.error)return en
      ? `⏱️ ${r.frame} | ❌ Analysis unavailable`
      : `⏱️ ${r.frame} | ❌ تعذر التحليل`;

    const dir=r.marketDirection;
    const icon=dir==='BUY'?'📈':dir==='SELL'?'📉':'⏳';
    const selectedAlign=dir===direction;
    if(!r.levels)return en
      ? `⏱️ ${r.frame} | ${icon} ${dir}\n⛔ No safe Entry / SL / TP structure now.`
      : `⏱️ ${r.frame} | ${icon} ${dir}\n⛔ لا توجد مستويات دخول / وقف / هدف آمنة حاليًا.`;

    const entry=Number(r.levels.entry);
    const sl=Number(r.levels.sl??r.levels.stopLoss);
    const tp1=Number(r.levels.tp1??r.levels.target1);
    const tp2=Number(r.levels.tp2??r.levels.target2);
    const risk=Number.isFinite(entry)&&Number.isFinite(sl)?Math.abs(entry-sl):0;
    const rr1=risk>0&&Number.isFinite(tp1)?Math.abs(tp1-entry)/risk:null;
    const rr2=risk>0&&Number.isFinite(tp2)?Math.abs(tp2-entry)/risk:null;
    const align=en
      ? (selectedAlign?'✅ Matches your direction':'⚠️ Opposite your direction')
      : (selectedAlign?'✅ متوافق مع اتجاهك':'⚠️ عكس اتجاهك');
    return en
      ? `⏱️ ${r.frame} | ${icon} ${dir} | ${align}\n💰 Entry: ${fmt(entry)}\n🛑 SL: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}${Number.isFinite(tp2)?` | TP2: ${fmt(tp2)}`:''}\n⚖️ RR: ${rr1?`1:${rr1.toFixed(2)}`:'—'}${rr2?` / 1:${rr2.toFixed(2)}`:''}`
      : `⏱️ ${r.frame} | ${icon} ${dir} | ${align}\n💰 الدخول: ${fmt(entry)}\n🛑 وقف الخسارة: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}${Number.isFinite(tp2)?` | TP2: ${fmt(tp2)}`:''}\n⚖️ العائد/المخاطرة: ${rr1?`1:${rr1.toFixed(2)}`:'—'}${rr2?` / 1:${rr2.toFixed(2)}`:''}`;
  });

  return header+'\n\n'+blocks.join('\n\n━━━━━━━━━━━━━━━━━━\n\n')+
    (en?'\n\n⚠️ Analytical levels, not a guarantee of profit.':'\n\n⚠️ المستويات تحليلية وليست ضمانًا للربح.');
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
