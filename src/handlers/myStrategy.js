const { Markup } = require('telegraf');
const { DEFAULT_STRATEGY, conditionLabel, backtestGoldStrategy } = require('../services/strategyLab');
const states=new Map();
function state(id){if(!states.has(id))states.set(id,{...DEFAULT_STRATEGY,conditions:[]});return states.get(id);}
function header(s){const conditions=s.conditions.length?s.conditions.map((c,i)=>`${i+1}️⃣ ${conditionLabel(c)}`).join('\n'):'— لا توجد شروط حتى الآن —';return `🧪 استراتيجيتي — XAUUSD فقط\n━━━━━━━━━━━━━━\n⏱ الفريم: ${s.timeframe}\n📍 الاتجاه: ${s.direction==='BUY'?'🟢 BUY':'🔴 SELL'}\n🛑 SL: ${s.slAtr} ATR | 🎯 TP: ${s.tpAtr} ATR
🕯 حجم الاختبار: ${s.historyCount || 2000} شمعة\n\n📋 شروط الدخول (AND):\n${conditions}\n\nكل الشروط لازم تتحقق عند إغلاق الشمعة، والدخول يكون مع افتتاح الشمعة التالية.`;}
function mainKb(){return Markup.inlineKeyboard([
 [Markup.button.callback('➕ إضافة شرط','sl_add'),Markup.button.callback('🗑 حذف آخر شرط','sl_del_last')],
 [Markup.button.callback('📊 المؤشرات المتاحة','sl_indicators')],
 [Markup.button.callback('⏱ 5m','sl_tf_5'),Markup.button.callback('⏱ 15m','sl_tf_15'),Markup.button.callback('⏱ 1h','sl_tf_60')],
 [Markup.button.callback('🟢 BUY','sl_buy'),Markup.button.callback('🔴 SELL','sl_sell')],
 [Markup.button.callback('🕯 حجم الاختبار','sl_history')],
 [Markup.button.callback('🛑 SL / 🎯 TP','sl_risk')],
 [Markup.button.callback('▶️ Backtest','sl_test'),Markup.button.callback('♻️ مسح الاستراتيجية','sl_reset')]
]);}
function indicatorsKb(){return Markup.inlineKeyboard([
 [Markup.button.callback('📈 EMA','sl_i_ema'),Markup.button.callback('📊 RSI','sl_i_rsi'),Markup.button.callback('💪 ADX','sl_i_adx')],
 [Markup.button.callback('⚖️ VWAP','sl_i_vwap'),Markup.button.callback('〽️ MACD','sl_i_macd')],
 [Markup.button.callback('🕯 الشموع / السعر','sl_i_candle')],
 [Markup.button.callback('⬅️ رجوع','sl_home')]
]);}
async function show(ctx){return ctx.reply(header(state(ctx.from.id)),mainKb());}
async function editShow(ctx){try{return await ctx.editMessageText(header(state(ctx.from.id)),mainKb());}catch{return show(ctx);}}
function add(id,c){state(id).conditions.push(c);}
function registerStrategyLab(bot){
 bot.command('strategy',show);bot.hears(['🧪 استراتيجيتي','🧪 My Strategy'],show);
 bot.action('sl_home',async c=>{await c.answerCbQuery().catch(()=>{});return editShow(c);});
 bot.action('sl_add',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('➕ اختر نوع المؤشر أو شرط السعر:',indicatorsKb());});
 bot.action('sl_indicators',async c=>{await c.answerCbQuery().catch(()=>{});return c.reply('📊 المؤشرات والشروط المتاحة الآن:\n\n📈 EMA: إغلاق فوق/تحت + تقاطع EMA\n📊 RSI(14): أكبر/أقل من قيمة تختارها\n💪 ADX(14): أكبر من قيمة تختارها\n⚖️ VWAP: إغلاق فوق/تحت\n〽️ MACD: تقاطع صاعد/هابط\n🕯 الشموع: صاعدة/هابطة + كسر High/Low السابق');});
 const simple=(name,fn)=>bot.action(name,async c=>{await c.answerCbQuery().catch(()=>{});fn(state(c.from.id));return editShow(c);});
 simple('sl_buy',s=>s.direction='BUY');simple('sl_sell',s=>s.direction='SELL');simple('sl_tf_5',s=>s.timeframe='5min');simple('sl_tf_15',s=>s.timeframe='15min');simple('sl_tf_60',s=>s.timeframe='1h');simple('sl_del_last',s=>s.conditions.pop());simple('sl_reset',s=>Object.assign(s,{...DEFAULT_STRATEGY,conditions:[]}));
 bot.action('sl_i_ema',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('📈 EMA — اختر الشرط:',Markup.inlineKeyboard([[Markup.button.callback('إغلاق فوق EMA','sl_ema_above'),Markup.button.callback('إغلاق تحت EMA','sl_ema_below')],[Markup.button.callback('تقاطع EMA صاعد','sl_ema_cross_up'),Markup.button.callback('تقاطع EMA هابط','sl_ema_cross_down')],[Markup.button.callback('⬅️ رجوع','sl_add')]]));});
 for(const [a,type] of [['sl_ema_above','close_above_ema'],['sl_ema_below','close_below_ema']])bot.action(a,async c=>{await c.answerCbQuery().catch(()=>{});state(c.from.id).pending={kind:'ema_period',type};return c.editMessageText('اختر فترة EMA:',Markup.inlineKeyboard([[9,20,50].map(p=>Markup.button.callback(`EMA ${p}`,`sl_ep_${p}`)),[100,200].map(p=>Markup.button.callback(`EMA ${p}`,`sl_ep_${p}`))]));});
 for(const p of [9,20,50,100,200])bot.action(`sl_ep_${p}`,async c=>{await c.answerCbQuery().catch(()=>{});const s=state(c.from.id);if(s.pending?.type)add(c.from.id,{type:s.pending.type,period:p});s.pending=null;return editShow(c);});
 for(const [a,type] of [['sl_ema_cross_up','ema_cross_up'],['sl_ema_cross_down','ema_cross_down']])bot.action(a,async c=>{await c.answerCbQuery().catch(()=>{});state(c.from.id).pending={kind:'ema_cross_fast',type};return c.editMessageText('اختر EMA السريع:',Markup.inlineKeyboard([[9,20,50].map(p=>Markup.button.callback(`${p}`,`sl_ecf_${p}`))]));});
 for(const p of [9,20,50])bot.action(`sl_ecf_${p}`,async c=>{await c.answerCbQuery().catch(()=>{});const s=state(c.from.id);s.pending.fast=p;return c.editMessageText('اختر EMA البطيء:',Markup.inlineKeyboard([[20,50,100,200].map(q=>Markup.button.callback(`${q}`,`sl_ecs_${q}`))]));});
 for(const p of [20,50,100,200])bot.action(`sl_ecs_${p}`,async c=>{await c.answerCbQuery().catch(()=>{});const s=state(c.from.id);if(s.pending?.fast&&s.pending.fast<p)add(c.from.id,{type:s.pending.type,fast:s.pending.fast,slow:p});s.pending=null;return editShow(c);});
 bot.action('sl_i_rsi',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('📊 RSI(14) — اختر الشرط:',Markup.inlineKeyboard([[Markup.button.callback('RSI أكبر من','sl_rsi_above'),Markup.button.callback('RSI أقل من','sl_rsi_below')],[Markup.button.callback('⬅️ رجوع','sl_add')]]));});
 for(const [a,type] of [['sl_rsi_above','rsi_above'],['sl_rsi_below','rsi_below'],['sl_i_adx','adx_above']])bot.action(a,async c=>{await c.answerCbQuery().catch(()=>{});const s=state(c.from.id);s.waitingNumber={type};return c.reply(type==='adx_above'?'✍️ ابعت قيمة ADX المطلوبة، مثال: 25':'✍️ ابعت قيمة RSI المطلوبة، مثال: 50');});
 bot.action('sl_i_vwap',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('⚖️ VWAP — اختر الشرط:',Markup.inlineKeyboard([[Markup.button.callback('إغلاق فوق VWAP','sl_vwap_above'),Markup.button.callback('إغلاق تحت VWAP','sl_vwap_below')],[Markup.button.callback('⬅️ رجوع','sl_add')]]));});
 simple('sl_vwap_above',s=>s.conditions.push({type:'close_above_vwap'}));simple('sl_vwap_below',s=>s.conditions.push({type:'close_below_vwap'}));
 bot.action('sl_i_macd',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('〽️ MACD — اختر الشرط:',Markup.inlineKeyboard([[Markup.button.callback('تقاطع صاعد','sl_macd_up'),Markup.button.callback('تقاطع هابط','sl_macd_down')],[Markup.button.callback('⬅️ رجوع','sl_add')]]));});
 simple('sl_macd_up',s=>s.conditions.push({type:'macd_cross_up'}));simple('sl_macd_down',s=>s.conditions.push({type:'macd_cross_down'}));
 bot.action('sl_i_candle',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('🕯 الشمعة / السعر — اختر الشرط:',Markup.inlineKeyboard([[Markup.button.callback('شمعة صاعدة','sl_bull'),Markup.button.callback('شمعة هابطة','sl_bear')],[Markup.button.callback('إغلاق فوق High السابق','sl_prev_high')],[Markup.button.callback('إغلاق تحت Low السابق','sl_prev_low')],[Markup.button.callback('⬅️ رجوع','sl_add')]]));});
 simple('sl_bull',s=>s.conditions.push({type:'bullish_candle'}));simple('sl_bear',s=>s.conditions.push({type:'bearish_candle'}));simple('sl_prev_high',s=>s.conditions.push({type:'close_above_prev_high'}));simple('sl_prev_low',s=>s.conditions.push({type:'close_below_prev_low'}));

 bot.action('sl_history',async c=>{await c.answerCbQuery().catch(()=>{});return c.editMessageText('🕯 اختر عدد الشموع التاريخية للـ Backtest:',Markup.inlineKeyboard([[500,1000].map(n=>Markup.button.callback(`${n} شمعة`,`sl_hist_${n}`)),[2000,5000].map(n=>Markup.button.callback(`${n} شمعة`,`sl_hist_${n}`)),[Markup.button.callback('10000 شمعة','sl_hist_10000')],[Markup.button.callback('⬅️ رجوع','sl_home')]]));});
 for(const n of [500,1000,2000,5000,10000])bot.action(`sl_hist_${n}`,async c=>{await c.answerCbQuery().catch(()=>{});state(c.from.id).historyCount=n;return editShow(c);});

 bot.action('sl_risk',async c=>{await c.answerCbQuery().catch(()=>{});state(c.from.id).waitingRisk='sl';return c.reply(`🛑 SL الحالي = ${state(c.from.id).slAtr} ATR\n✍️ ابعت قيمة SL ATR الجديدة، مثال: 1.2`);});
 bot.on('text',async(c,next)=>{const s=states.get(c.from.id);if(!s)return next();const text=String(c.message?.text||'').trim();const value=Number(text);if(s.waitingNumber&&Number.isFinite(value)){add(c.from.id,{type:s.waitingNumber.type,value});s.waitingNumber=null;await c.reply('✅ تم إضافة الشرط.');return show(c);}if(s.waitingRisk==='sl'&&Number.isFinite(value)&&value>0){s.slAtr=value;s.waitingRisk='tp';return c.reply('🎯 دلوقتي ابعت TP ATR، مثال: 2');}if(s.waitingRisk==='tp'&&Number.isFinite(value)&&value>0){s.tpAtr=value;s.waitingRisk=null;await c.reply('✅ تم تحديث SL / TP.');return show(c);}return next();});
 bot.action('sl_test',async c=>{await c.answerCbQuery().catch(()=>{});const s=state(c.from.id);if(!s.conditions.length)return c.reply('⚠️ أضف شرطًا واحدًا على الأقل أولًا.');await c.reply(`🧪 جاري اختبار ${s.direction} على XAUUSD ${s.timeframe}...`);try{const r=await backtestGoldStrategy(s),last=r.trades.slice(-5).reverse().map((t,i)=>`${i+1}) ${t.side==='BUY'?'🟢 BUY':'🔴 SELL'} | ${t.result==='WIN'?'✅ WIN':'❌ LOSS'} | ${t.rMultiple.toFixed(2)}R`).join('\n');return c.reply(`📊 نتيجة Backtest — XAUUSD\n━━━━━━━━━━━━━━\n⏱ ${r.strategy.timeframe}\n📍 ${r.strategy.direction}\n🕯 الشموع المستخدمة: ${r.candles}
🎯 المطلوب: ${r.strategy.historyCount || 2000}\n📋 الشروط: ${r.strategy.conditions.length}\n📈 الصفقات: ${r.total}\n✅ رابحة: ${r.wins}\n❌ خاسرة: ${r.losses}\n🎯 Win Rate: ${r.winRate.toFixed(1)}%\n💰 Net: ${r.netR.toFixed(2)}R\n📉 Max Drawdown: -${r.maxDrawdownR.toFixed(2)}R\n🔥 أفضل سلسلة: ${r.bestWinStreak}\n❄️ أسوأ سلسلة: ${r.worstLossStreak}\n\n🧾 آخر الصفقات:\n${last||'لا توجد صفقات بالشروط الحالية.'}\n\n⚠️ الاختبار مستقل ولا يغيّر استراتيجية البوت الحية.`,mainKb());}catch(e){console.error('❌ STRATEGY LAB V2:',e);return c.reply(`❌ فشل الاختبار:\n${e.message}`);}});
}
module.exports={registerStrategyLab};
