const legacyRegister = require('./userLegacy');
const config = require('../config');
const { findUser } = require('../database/users');
const { analyzePair } = require('../services/analysisService');
const { getGoldCandlesResilient } = require('../services/goldCandleRecovery');
const { calculateTradeLevels } = require('../services/tradeEngine');
const { mainKeyboard } = require('../keyboards/main');

function languageOf(ctx){const u=findUser(ctx.from?.id);return u&&u.language==='en'?'en':'ar';}
function isEnglish(ctx){return languageOf(ctx)==='en';}
function vipAllowed(ctx){const u=findUser(ctx.from?.id);const admins=(config.adminIds||[]).map(String);return admins.includes(String(ctx.from?.id))||Boolean(u&&Number(u.is_vip)===1&&(!u.vip_expires_at||new Date(u.vip_expires_at).getTime()>Date.now()));}
function keyboard(ctx){const u=findUser(ctx.from?.id);const admins=(config.adminIds||[]).map(String);return mainKeyboard(languageOf(ctx),admins.includes(String(ctx.from?.id)),Boolean(u&&u.is_vip));}
function fmt(v){return Number.isFinite(Number(v))?Number(v).toFixed(2):'—';}
function marketDirection(analysis){const i=analysis?.indicators||{},e20=Number(i.ema20),e50=Number(i.ema50);if(analysis?.signal?.action==='BUY'||analysis?.signal?.action==='SELL')return analysis.signal.action;return Number.isFinite(e20)&&Number.isFinite(e50)?(e20>=e50?'BUY':'SELL'):'WAIT';}
function frameScore(analysis,selected){const i=analysis?.indicators||{},dir=marketDirection(analysis),e20=Number(i.ema20),e50=Number(i.ema50),rsi=Number(i.rsi),adx=Number(i.adx),m=Number(i.macd?.macd),ms=Number(i.macd?.signal);let s=0;if(dir===selected)s+=35;if(Number.isFinite(e20)&&Number.isFinite(e50)&&((selected==='BUY'&&e20>e50)||(selected==='SELL'&&e20<e50)))s+=20;if(Number.isFinite(rsi)&&((selected==='BUY'&&rsi>=48&&rsi<=70)||(selected==='SELL'&&rsi<=52&&rsi>=30)))s+=15;if(Number.isFinite(m)&&Number.isFinite(ms)&&((selected==='BUY'&&m>ms)||(selected==='SELL'&&m<ms)))s+=15;if(Number.isFinite(adx))s+=adx>=25?15:adx>=18?8:0;return Math.min(100,s);}
function quality(score,en){if(score>=82)return en?'🔥 EXCELLENT':'🔥 ممتازة';if(score>=70)return en?'🟢 GOOD':'🟢 جيدة';if(score>=55)return en?'🟡 ACCEPTABLE / WAIT CONFIRMATION':'🟡 مقبولة / انتظر تأكيد';return en?'🔴 WEAK / HIGH RISK':'🔴 ضعيفة / مخاطرة عالية';}

async function buildGoldCheck(ctx,type,direction){
  const en=isEnglish(ctx),frames=[{key:'M5',interval:'5min',w:1},{key:'M15',interval:'15min',w:2},{key:'M30',interval:'30min',w:2},{key:'H1',interval:'1h',w:3},{key:'H4',interval:'4h',w:4},{key:'D1',interval:'1day',w:4},{key:'W1',interval:'1week',w:2},{key:'MN',interval:'1month',w:1}],results=[];
  for(const f of frames){try{const[analysis,candles]=await Promise.all([analyzePair('XAUUSD',f.interval),getGoldCandlesResilient(f.interval)]);if(!analysis||!Array.isArray(candles)||candles.length<20)throw new Error('Insufficient market data');const dir=marketDirection(analysis),levels=dir==='WAIT'?null:calculateTradeLevels(candles,dir,'XAUUSD');results.push({...f,dir,levels,analysis,score:frameScore(analysis,direction)});}catch(error){console.log(`VIP multi-TF gold check ${f.key} error:`,error.message);results.push({...f,error:error.message});}}
  const valid=results.filter(r=>!r.error),aligned=valid.filter(r=>r.dir===direction),opposite=valid.filter(r=>r.dir!=='WAIT'&&r.dir!==direction),weightTotal=valid.reduce((s,r)=>s+r.w,0)||1,alignmentWeight=aligned.reduce((s,r)=>s+r.w,0),weightedTechnical=valid.reduce((s,r)=>s+r.score*r.w,0)/weightTotal,alignmentPct=Math.round(alignmentWeight/weightTotal*100),core=valid.filter(r=>['M15','H1','H4','D1'].includes(r.key)),coreAligned=core.filter(r=>r.dir===direction).length;
  let finalScore=Math.round(weightedTechnical*.65+alignmentPct*.35);if(coreAligned>=3)finalScore=Math.min(100,finalScore+6);if(core.filter(r=>r.dir!==direction&&r.dir!=='WAIT').length>=3)finalScore=Math.max(0,finalScore-10);
  const verdict=quality(finalScore,en),reasons=[];
  reasons.push(en?`• ${aligned.length}/${valid.length} timeframes support ${direction}.`:`• ${aligned.length}/${valid.length} فريمات تدعم ${direction}.`);
  reasons.push(en?`• Core M15/H1/H4/D1 alignment: ${coreAligned}/${core.length}.`:`• توافق الفريمات الأساسية M15/H1/H4/D1: ${coreAligned}/${core.length}.`);
  if(opposite.some(r=>r.key==='H4'||r.key==='D1'))reasons.push(en?'• ⚠️ H4/D1 contains higher-timeframe opposition.':'• ⚠️ يوجد تعارض على H4/D1، وده يرفع مخاطرة الصفقة.');
  if(aligned.some(r=>r.key==='H1')&&aligned.some(r=>r.key==='H4'))reasons.push(en?'• ✅ H1 and H4 agree with your direction.':'• ✅ H1 وH4 متوافقان مع اتجاهك.');
  if(finalScore<55)reasons.push(en?'• ⛔ Better to WAIT instead of forcing an entry.':'• ⛔ الأفضل WAIT وعدم إجبار دخول ضعيف.');else if(finalScore<70)reasons.push(en?'• 🟡 Wait for M5/M15 price-action confirmation.':'• 🟡 انتظر تأكيد Price Action على M5/M15.');
  const blocks=results.map(r=>{if(r.error)return`⏱️ ${r.key} | ❌ ${en?'Unavailable':'تعذر التحليل'}`;const icon=r.dir==='BUY'?'📈':r.dir==='SELL'?'📉':'⏳',align=r.dir===direction?(en?'✅ ALIGN':'✅ متوافق'):(en?'⚠️ OPPOSE':'⚠️ عكس اتجاهك');if(!r.levels)return`⏱️ ${r.key} | ${icon} ${r.dir} | ${align}\n⭐ ${r.score}/100\n⛔ ${en?'No safe levels now.':'لا توجد مستويات آمنة الآن.'}`;const entry=Number(r.levels.entry),sl=Number(r.levels.sl??r.levels.stopLoss),tp1=Number(r.levels.tp1??r.levels.target1),tp2=Number(r.levels.tp2??r.levels.target2),risk=Math.abs(entry-sl),rr1=risk>0?Math.abs(tp1-entry)/risk:null,rr2=risk>0&&Number.isFinite(tp2)?Math.abs(tp2-entry)/risk:null;return`⏱️ ${r.key} | ${icon} ${r.dir} | ${align}\n⭐ Frame Score: ${r.score}/100\n💰 Entry: ${fmt(entry)} | 🛑 SL: ${fmt(sl)}\n🎯 TP1: ${fmt(tp1)}${Number.isFinite(tp2)?` | TP2: ${fmt(tp2)}`:''}\n⚖️ R:R ${rr1?`1:${rr1.toFixed(2)}`:'—'}${rr2?` / 1:${rr2.toFixed(2)}`:''}`;});
  const header=en?`🥇 GOLD TRADE CHECK — MULTI-TIMEFRAME\n━━━━━━━━━━━━━━━━━━\n🎯 Your direction: ${direction}\n⭐ FINAL QUALITY: ${finalScore}/100 — ${verdict}\n🧭 Alignment: ${alignmentPct}%`:`🥇 اختبر صفقة الذهب — فحص شامل\n━━━━━━━━━━━━━━━━━━\n🎯 اتجاهك: ${direction}\n⭐ التقييم النهائي: ${finalScore}/100 — ${verdict}\n🧭 توافق الفريمات: ${alignmentPct}%`;
  return header+'\n\n'+(en?'📌 WHY THIS SCORE':'📌 أسباب التقييم')+'\n'+reasons.join('\n')+'\n\n━━━━━━━━━━━━━━━━━━\n'+blocks.join('\n\n')+(en?'\n\n⚠️ Analytical decision support, not a profit guarantee.':'\n\n⚠️ التحليل للمساعدة في القرار وليس ضمانًا للربح.');
}

function registerUserCommands(bot){
  for(const type of ['scalp','intraday'])for(const direction of ['buy','sell'])bot.action(`viptrade_${type}_${direction}`,async ctx=>{await ctx.answerCbQuery(isEnglish(ctx)?'Full multi-timeframe check...':'جاري الفحص الشامل لكل الفريمات...').catch(()=>null);if(!vipAllowed(ctx))return ctx.reply(isEnglish(ctx)?'💎 VIP membership required.':'💎 يلزم اشتراك VIP.');try{return ctx.reply(await buildGoldCheck(ctx,type,direction.toUpperCase()),keyboard(ctx));}catch(error){console.log('VIP multi-TF trade checker error:',error.stack||error.message);return ctx.reply(isEnglish(ctx)?'❌ Could not complete the Gold trade analysis right now.':'❌ تعذر إكمال تحليل صفقة الذهب حاليًا.');}});
  return legacyRegister(bot);
}
module.exports=registerUserCommands;
