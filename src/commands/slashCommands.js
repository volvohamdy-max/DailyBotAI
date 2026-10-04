const { Markup } = require('telegraf');
const { findUser } = require('../database/users');
const { mainKeyboard } = require('../keyboards/main');
const { analyzePair } = require('../services/analysisService');
const { getGoldSupportResistance } = require('../services/goldLevels');
const { scanMarkets } = require('../services/smartScanner');
const { getBestTrade, getLastRejectedCandidates } = require('../services/bestTrade');
const { scanTrends } = require('../services/trendHunter');
const { buildMarketMap } = require('../services/marketMap');
const { getEconomicCalendar, isHighImpact } = (() => {
  const news = require('../services/newsService'); let high=null;
  try { high=require('../services/newsProviders').isHighImpact; } catch(_) {}
  return { getEconomicCalendar:news.getEconomicCalendar, isHighImpact:high||(()=>true) };
})();
const { consumeFeature, limitMessage } = require('../services/dailyUsageGate');

const PAIRS=['XAUUSD','BTCUSD','EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY'];
function lang(ctx){return findUser(ctx.from.id)?.language==='en'?'en':'ar';}
function isEn(ctx){return lang(ctx)==='en';}
function fmt(value){const n=Number(value);return Number.isFinite(n)?n.toFixed(2):'—';}
function menu(ctx){return mainKeyboard(lang(ctx));}
function parsePair(ctx){const p=String(ctx.message?.text||'').trim().split(/\s+/)[1]?.toUpperCase();return PAIRS.includes(p)?p:null;}
function analysisText(ctx,pair,result,timeframeLabel=null){const en=isEn(ctx),i=result?.indicators||{},e20=Number(i.ema20),e50=Number(i.ema50),rsi=Number(i.rsi),adx=Number(i.adx),bull=Number.isFinite(e20)&&Number.isFinite(e50)&&e20>e50;return en?`📊 ${pair} ANALYSIS${timeframeLabel?` — ${timeframeLabel}`:''}\n━━━━━━━━━━━━━━━━━━\n💰 Price: ${fmt(i.lastPrice)}\n📈 Trend: ${bull?'🟢 Bullish':'🔴 Bearish'}\n📊 RSI: ${Number.isFinite(rsi)?rsi.toFixed(1):'—'}\n💪 ADX: ${Number.isFinite(adx)?adx.toFixed(1):'—'}\n🤖 AI: ${result?.signal?.confidence?`${result.signal.confidence}%`:'N/A'}\n\n⚠️ Analytical information only.`:`📊 تحليل ${pair}${timeframeLabel?` — ${timeframeLabel}`:''}\n━━━━━━━━━━━━━━━━━━\n💰 السعر: ${fmt(i.lastPrice)}\n📈 الاتجاه: ${bull?'🟢 صاعد':'🔴 هابط'}\n📊 RSI: ${Number.isFinite(rsi)?rsi.toFixed(1):'—'}\n💪 ADX: ${Number.isFinite(adx)?adx.toFixed(1):'—'}\n🤖 AI: ${result?.signal?.confidence?`${result.signal.confidence}%`:'غير متاح'}\n\n⚠️ معلومات تحليلية وليست ضمانًا للربح.`;}
function strength(score,en){if(score>=85)return en?'🔥 VERY STRONG':'🔥 قوي جدًا';if(score>=70)return en?'🟢 STRONG':'🟢 قوي';return en?'🟡 MEDIUM':'🟡 متوسط';}
function goldLevelsText(ctx,d){const en=isEn(ctx);const row=x=>`${fmt(x.price)} — ${strength(x.score,en)} (${x.score}/100)\n   ${en?'TFs':'الفريمات'}: ${x.frames.join(' + ')} | ${en?'Touches':'لمسات'}: ${x.touches}`;const fs=d.frameSummary.map(x=>`${x.frame}: S ${fmt(x.support)} | R ${fmt(x.resistance)}`).join('\n');return en?`🧱 GOLD SUPPORT & RESISTANCE\n━━━━━━━━━━━━━━━━━━\n💰 Live GoldAPI: ${fmt(d.price)}\n\n🟢 STRONG SUPPORTS\n${d.supports.map(row).join('\n\n')||'—'}\n\n🔴 STRONG RESISTANCES\n${d.resistances.map(row).join('\n\n')||'—'}\n\n📊 NEAREST LEVELS BY TIMEFRAME\n${fs||'—'}\n\n🔥 Strength increases when a level has repeated touches and confluence across higher timeframes.\n⚠️ Analytical levels, not a profit guarantee.`:`🧱 أهم مستويات دعم ومقاومة الذهب\n━━━━━━━━━━━━━━━━━━\n💰 السعر الحالي GoldAPI: ${fmt(d.price)}\n\n🟢 أقوى الدعوم\n${d.supports.map(row).join('\n\n')||'—'}\n\n🔴 أقوى المقاومات\n${d.resistances.map(row).join('\n\n')||'—'}\n\n📊 أقرب مستوى على كل فريم\n${fs||'—'}\n\n🔥 قوة المستوى تزيد مع تكرار اللمسات وتوافقه على أكثر من فريم، خصوصًا الفريمات الكبيرة.\n⚠️ مستويات تحليلية وليست ضمانًا للربح.`;}
function noTradeDiagnosticsText(ctx){const en=isEn(ctx),r=getLastRejectedCandidates(2);return en?`🔍 No high-quality trade is available right now.${r.length?'\nClosest candidates were rejected by confirmation filters.':''}`:`🔍 لا توجد صفقة قوية مناسبة حاليًا.${r.length?'\nأقرب الفرص لم تجتز فلاتر التأكيد.':''}`;}
function tradeText(ctx,t){if(!t)return noTradeDiagnosticsText(ctx);const en=isEn(ctx);return en?`⚡ BEST TRADE NOW\n${t.pair} ${t.action}\nEntry ${fmt(t.entry)} | SL ${fmt(t.sl)} | TP1 ${fmt(t.tp1)} | TP2 ${fmt(t.tp2)}`:`⚡ أفضل صفقة الآن\n${t.pair} ${t.action}\nالدخول ${fmt(t.entry)} | SL ${fmt(t.sl)} | TP1 ${fmt(t.tp1)} | TP2 ${fmt(t.tp2)}`;}
function scannerText(ctx,rows){return `${isEn(ctx)?'🔎 SMART SCANNER':'🔎 الماسح الذكي'}\n${(rows||[]).slice(0,5).map((x,i)=>`${i+1}. ${x.pair} | ${x.action||'WAIT'} | ⭐ ${x.score??0}/100`).join('\n')||'—'}`;}
function trendText(ctx,rows){return `${isEn(ctx)?'📡 TREND HUNTER':'📡 صياد الترند'}\n${(rows||[]).slice(0,8).map((x,i)=>`${i+1}. ${x.pair} | ${x.direction||'WAIT'} | ⭐ ${x.score??0}/100`).join('\n')||'—'}`;}
function mapText(ctx,data){return `${isEn(ctx)?'🧭 MARKET MAP':'🧭 خريطة السوق'}\n${(data?.ranked||[]).slice(0,8).map((x,i)=>`${i+1}. ${x.pair} | ${x.direction||'WAIT'} | ⭐ ${x.marketScore??x.score??0}/100`).join('\n')||'—'}`;}
function upcomingNewsText(ctx,events){const en=isEn(ctx),now=Date.now(),rows=(events||[]).filter(e=>new Date(e.date).getTime()>=now).filter(e=>{try{return isHighImpact(e)}catch(_){return true}}).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);return `${en?'📰 UPCOMING HIGH-IMPACT NEWS':'📰 الأخبار القوية القادمة'}\n${rows.map((e,i)=>`${i+1}. ${e.currency||'-'} — ${e.title}\n⏰ ${new Date(e.date).toLocaleString(en?'en-GB':'ar-EG',{timeZone:process.env.NEWS_TIMEZONE||'Africa/Cairo'})}`).join('\n\n')||'—'}`;}
function helpText(ctx){return isEn(ctx)?`ℹ️ BOT COMMANDS\n/gold — Gold analysis\n/levels — Gold support & resistance\n/trade — Best trade\n/scanner — Scanner\n/trend — Trends\n/map — Market map\n/news — News`:`ℹ️ أوامر البوت\n/gold — تحليل الذهب\n/levels — دعم ومقاومة الذهب\n/trade — أفضل صفقة\n/scanner — الماسح\n/trend — الترند\n/map — خريطة السوق\n/news — الأخبار`;}
async function checkDailySlashLimit(ctx,feature){const r=consumeFeature(ctx.from?.id,feature);if(r.allowed)return true;await ctx.reply(limitMessage(feature,isEn(ctx)));return false;}

function registerSlashCommands(bot){
 const goldTimeframes={MN:{interval:'1month',ar:'شهري MN',en:'Monthly MN'},W1:{interval:'1week',ar:'أسبوعي W1',en:'Weekly W1'},D1:{interval:'1day',ar:'يومي D1',en:'Daily D1'},H4:{interval:'4h',ar:'4 ساعات H4',en:'4 Hours H4'},H1:{interval:'1h',ar:'ساعة H1',en:'1 Hour H1'},M30:{interval:'30min',ar:'30 دقيقة M30',en:'30 Minutes M30'},M15:{interval:'15min',ar:'15 دقيقة M15',en:'15 Minutes M15'},M5:{interval:'5min',ar:'5 دقائق M5',en:'5 Minutes M5'}};
 const goldTimeframeKeyboard=ctx=>Markup.inlineKeyboard([[Markup.button.callback('📅 MN','gold_tf_MN'),Markup.button.callback('📆 W1','gold_tf_W1')],[Markup.button.callback('☀️ D1','gold_tf_D1')],[Markup.button.callback('🕓 H4','gold_tf_H4'),Markup.button.callback('🕐 H1','gold_tf_H1')],[Markup.button.callback('🕧 M30','gold_tf_M30'),Markup.button.callback('🕒 M15','gold_tf_M15')],[Markup.button.callback('⚡ M5','gold_tf_M5')]]);
 async function openGoldTimeframes(ctx){return ctx.reply(isEn(ctx)?'🥇 XAUUSD Analysis\nChoose timeframe:':'🥇 تحليل الذهب XAUUSD\nاختر الفريم:',goldTimeframeKeyboard(ctx));}
 async function openGoldLevels(ctx){try{await ctx.reply(isEn(ctx)?'🧱 Calculating strong Gold levels across all timeframes...':'🧱 جاري حساب أقوى مستويات الذهب على كل الفريمات...');const d=await getGoldSupportResistance();return ctx.reply(goldLevelsText(ctx,d),menu(ctx));}catch(e){console.log('Gold levels error:',e.stack||e.message);return ctx.reply(isEn(ctx)?'❌ Could not calculate Gold levels now.':'❌ تعذر حساب مستويات الذهب حاليًا.');}}
 bot.command('gold',openGoldTimeframes); bot.hears(['🥇 تحليل الذهب','🥇 Gold Analysis'],openGoldTimeframes);
 bot.command('levels',openGoldLevels); bot.hears(['🧱 دعم ومقاومة الذهب','🧱 Gold Support & Resistance'],openGoldLevels);
 Object.entries(goldTimeframes).forEach(([code,tf])=>bot.action(`gold_tf_${code}`,async ctx=>{await ctx.answerCbQuery().catch(()=>null);if(!(await checkDailySlashLimit(ctx,'analysis')))return;try{const result=await analyzePair('XAUUSD',tf.interval);return ctx.reply(analysisText(ctx,'XAUUSD',result,isEn(ctx)?tf.en:tf.ar),menu(ctx));}catch(e){return ctx.reply(isEn(ctx)?'❌ Gold analysis failed for this timeframe.':'❌ تعذر تحليل الذهب على هذا الفريم.');}}));
 bot.command('analysis',async ctx=>{if(!(await checkDailySlashLimit(ctx,'analysis')))return;const pair=parsePair(ctx);if(!pair)return ctx.reply('/analysis XAUUSD');try{return ctx.reply(analysisText(ctx,pair,await analyzePair(pair)),menu(ctx));}catch(e){return ctx.reply('❌ Analysis failed.');}});
 bot.command('trade',async ctx=>{if(!(await checkDailySlashLimit(ctx,'trade_now')))return;try{return ctx.reply(tradeText(ctx,await getBestTrade()),menu(ctx));}catch(e){return ctx.reply('❌ Trade search failed.');}});
 bot.command('scanner',async ctx=>{if(!(await checkDailySlashLimit(ctx,'scanner')))return;try{return ctx.reply(scannerText(ctx,await scanMarkets()),menu(ctx));}catch(e){return ctx.reply('❌ Scanner failed.');}});
 bot.command('trend',async ctx=>{try{return ctx.reply(trendText(ctx,await scanTrends()),menu(ctx));}catch(e){return ctx.reply('❌ Trend scan failed.');}});
 bot.command('map',async ctx=>{try{return ctx.reply(mapText(ctx,await buildMarketMap()),menu(ctx));}catch(e){return ctx.reply('❌ Market map failed.');}});
 bot.command('news',async ctx=>{try{return ctx.reply(upcomingNewsText(ctx,await getEconomicCalendar()),menu(ctx));}catch(e){return ctx.reply('❌ News unavailable.');}});
 bot.command('help',ctx=>ctx.reply(helpText(ctx),menu(ctx)));
}
module.exports=registerSlashCommands;
