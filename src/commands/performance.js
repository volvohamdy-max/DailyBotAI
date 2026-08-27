const { getStats } = require('../database/performance');
const { findUser } = require('../database/users');

function isEnglish(ctx) { return findUser(ctx.from.id)?.language === 'en'; }
function pct(value) { return `${Number(value || 0).toFixed(1)}%`; }
function pipText(value, withPlus = false) {
  const n=Number(value); if(!Number.isFinite(n))return 'N/A';
  return (withPlus&&n>0?'+':'')+n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
}

function formatStats(stats,en){
  if(!stats.total)return en?`📊 PERFORMANCE — ${stats.days} DAYS\n\nNo tracked trades yet.\n\nThe tracker starts collecting verified results from this version onward.`:`📊 أداء البوت — آخر ${stats.days} يوم\n\nلا توجد صفقات مسجلة في التتبع حتى الآن.\n\nسيبدأ النظام في تجميع النتائج الموثقة من هذه النسخة فصاعدًا.`;

  const strategyNames=en?
    {SCALP:'⚡ Scalp V3',REGIME:'🧭 Regime',POWER:'🏆 Power',H4_MR:'🟣 Gold H4 MR',PRO_STRATEGY:'⭐ Pro Strategy',GROK_GOLD_92:'⚡ Grok Gold 92',NEW_YORK:'New York',BREAKOUT_A:'Breakout A',HOURLY_MARKET_BIAS:'🕐 Hourly Market Bias',UNKNOWN_SOURCE:'Unknown source'}:
    {SCALP:'⚡ سكالب V3',REGIME:'🧭 Regime',POWER:'🏆 Power',H4_MR:'🟣 Gold H4 MR',PRO_STRATEGY:'⭐ PRO Strategy',GROK_GOLD_92:'⚡ GROK Gold 92',NEW_YORK:'New York',BREAKOUT_A:'Breakout A',HOURLY_MARKET_BIAS:'🕐 ميل السوق الساعي',UNKNOWN_SOURCE:'مصدر غير معروف'};

  const strategyRows=Object.entries(stats.byStrategy||{}).filter(([,x])=>x.total>0).map(([key,x])=>`${strategyNames[key]||key.replace(/^SOURCE:/,'📦 ')}: ${x.closed}/${x.total} ${en?'closed':'مغلقة'} | TP2 ${x.tp2} | SL ${x.sl} | Net ${Number(x.netR||0).toFixed(2)}R`).join('\n');
  const pairRows=Object.entries(stats.byPair).sort((a,b)=>b[1].total-a[1].total).slice(0,5).map(([pair,s])=>!s.closed?`${pair}: ${s.total} ${en?'tracked':'متابعة'}`:`${pair}: ${s.closed} ${en?'closed':'مغلقة'} | TP1 ${s.tp1} | TP2 ${s.tp2} | SL ${s.sl}`).join('\n');
  const best=stats.bestPipTrade,worst=stats.worstPipTrade;

  if(en)return `📊 BOT PERFORMANCE — ${stats.days} DAYS\n━━━━━━━━━━━━━━━━━━\n\n📌 Tracked trades: ${stats.total}\n🟢 Open: ${stats.open}\n✅ Closed: ${stats.closed}\n\n🎯 TP1 hit: ${stats.tp1} (${pct(stats.tp1Rate)})\n🏆 TP2 hit: ${stats.tp2} (${pct(stats.tp2Rate)})\n🛑 SL before TP1: ${stats.pureSl??stats.sl}\n🟡 TP1 then SL: ${stats.tp1ThenSl||0}\n\n💰 PERFORMANCE IN PIPS\n━━━━━━━━━━━━━━━━━━\n\n📈 Total Pips:\n${pipText(stats.totalPips,true)}\n\n📊 Average / trade:\n${pipText(stats.avgPips,true)} Pips\n\n🟢 Positive trades: ${stats.winningPipTrades??0}\n🔴 Negative trades: ${stats.losingPipTrades??0}\n⚪ Breakeven: ${stats.breakevenPipTrades??0}\n\n🏆 Best trade:\n${best?`#${best.tradeId} | ${pipText(best.pips,true)} Pips`:'N/A'}\n\n🛑 Worst trade:\n${worst?`#${worst.tradeId} | ${pipText(worst.pips)} Pips`:'N/A'}\n\nBy strategy:\n${strategyRows||'—'}\n\nBy asset:\n${pairRows||'—'}\n\nℹ️ XAUUSD calculation uses 0.01 price movement = 1 pip.\n⚠️ Historical performance does not guarantee future results.`;

  return `📊 أداء البوت — آخر ${stats.days} يوم\n━━━━━━━━━━━━━━━━━━\n\n📌 الصفقات المتابعة: ${stats.total}\n🟢 مفتوحة: ${stats.open}\n✅ مغلقة: ${stats.closed}\n\n🎯 حققت TP1: ${stats.tp1} (${pct(stats.tp1Rate)})\n🏆 حققت TP2: ${stats.tp2} (${pct(stats.tp2Rate)})\n🛑 SL قبل TP1: ${stats.pureSl??stats.sl}\n🟡 TP1 ثم SL: ${stats.tp1ThenSl||0}\n\n💰 الأداء بالنقاط\n━━━━━━━━━━━━━━━━━━\n\n📈 إجمالي Pips:\n${pipText(stats.totalPips,true)}\n\n📊 متوسط الصفقة:\n${pipText(stats.avgPips,true)} Pips\n\n🟢 صفقات موجبة: ${stats.winningPipTrades??0}\n🔴 صفقات سالبة: ${stats.losingPipTrades??0}\n⚪ تعادل: ${stats.breakevenPipTrades??0}\n\n🏆 أفضل صفقة:\n${best?`#${best.tradeId} | ${pipText(best.pips,true)} Pips`:'غير متاح'}\n\n🛑 أسوأ صفقة:\n${worst?`#${worst.tradeId} | ${pipText(worst.pips)} Pips`:'غير متاح'}\n\nحسب الاستراتيجية:\n${strategyRows||'—'}\n\nحسب الأصل:\n${pairRows||'—'}\n\nℹ️ في XAUUSD يتم اعتبار حركة 0.01 = نقطة واحدة Pip.\n⚠️ الأداء السابق لا يضمن نتائج مستقبلية.`;
}

function registerPerformance(bot){
  bot.command('performance',async ctx=>{try{const en=isEnglish(ctx),s7=getStats(7),s30=getStats(30);await ctx.reply(formatStats(s7,en));return ctx.reply(formatStats(s30,en));}catch(error){console.log('/performance error:',error.message);return ctx.reply(isEnglish(ctx)?'❌ Performance statistics are temporarily unavailable.':'❌ إحصائيات الأداء غير متاحة مؤقتًا.');}});
}
module.exports=registerPerformance;
