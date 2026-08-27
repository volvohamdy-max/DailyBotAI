const { analyzePair } = require('./analysisGate');
const { buildGoldScalpResult } = require('./goldScalper');
const { allUsers } = require('../database/users');
const { addTrade, getOpenTrades, markTradeAsFree } = require('../database/trades');
const { canSendFreeSignal, markFreeSignalSent } = require('../database/freeSignalState');
const { getCandles, getPrice } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');
const { saveTradeFeatures } = require('../database/adaptiveIntelligence');
const { publishHiddenSignal } = require('./hiddenSignalService');
const { evaluatePowerTrade } = require('./powerTradeEngine');
const config = require('../config');
const { getBoolSetting, getNumberSetting } = require('../database/adminControl');

const PAIRS = ['XAUUSD'];
let lastSignals = {};
const pendingVipSignals = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendVipSignal(bot, message, pair, strategyId) {
  const chatId = String(config.vipChannelId || '').trim();
  if (!chatId) { console.log(`❌ VIP DELIVERY CONFIG ERROR | ${pair} | ${strategyId} | VIP_CHANNEL_ID is empty`); return false; }
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      const sent=await bot.telegram.sendMessage(chatId,message);
      console.log(`💎 VIP SIGNAL DELIVERED | ${pair} | ${strategyId} | chat=${chatId} | message=${sent?.message_id||'ok'} | attempt=${attempt}`);
      return true;
    } catch(e) {
      const code=e?.response?.error_code||e?.code||'UNKNOWN';
      const description=e?.response?.description||e?.description||e?.message||String(e);
      const retryAfter=Number(e?.response?.parameters?.retry_after||0);
      console.log(`❌ VIP DELIVERY FAILED | ${pair} | ${strategyId} | chat=${chatId} | attempt=${attempt}/3 | code=${code} | ${description}`);
      if(attempt<3) await sleep(retryAfter>0?retryAfter*1000:attempt*1500);
    }
  }
  return false;
}

async function retryPendingVipSignals(bot) {
  if(!pendingVipSignals.size) return;
  const openIds=new Set(getOpenTrades().map(t=>Number(t.id)));
  for(const [tradeId,pending] of pendingVipSignals.entries()) {
    if(!openIds.has(Number(tradeId))) { pendingVipSignals.delete(tradeId); console.log(`🧹 PENDING VIP ENTRY REMOVED | Trade #${tradeId} is no longer open`); continue; }
    console.log(`🔁 RETRYING PENDING VIP ENTRY | ${pending.pair} | ${pending.strategyId} | Trade #${tradeId}`);
    const delivered=await sendVipSignal(bot,pending.message,pending.pair,pending.strategyId);
    if(delivered) { pendingVipSignals.delete(tradeId); console.log(`✅ PENDING VIP ENTRY DELIVERED | ${pending.pair} | ${pending.strategyId} | Trade #${tradeId}`); }
  }
}

function rebaseLevelsToLivePrice(levels, livePrice) {
  const originalEntry=Number(levels.entry), executionEntry=Number(livePrice);
  if(!Number.isFinite(originalEntry)||!Number.isFinite(executionEntry)||executionEntry<=0) return null;
  const shift=executionEntry-originalEntry;
  const rebased={...levels,entry:executionEntry};
  for(const key of ['sl','tp1','tp2']) {
    const value=Number(levels[key]);
    rebased[key]=Number.isFinite(value)?value+shift:value;
  }
  const sl=Number(rebased.sl), tp1=Number(rebased.tp1), tp2=Number(rebased.tp2);
  const riskDistance=Number.isFinite(sl)?Math.abs(executionEntry-sl):Number(levels.riskDistance||0);
  rebased.riskDistance=riskDistance;
  rebased.riskPct=executionEntry>0&&riskDistance>0?riskDistance/executionEntry*100:null;
  rebased.rrTp1=riskDistance>0&&Number.isFinite(tp1)?Math.abs(tp1-executionEntry)/riskDistance:null;
  rebased.rrTp2=riskDistance>0&&Number.isFinite(tp2)?Math.abs(tp2-executionEntry)/riskDistance:null;
  rebased.strategyEntry=originalEntry;
  rebased.executionShift=shift;
  return rebased;
}

async function processSignalResult(bot,pair,result) {
  if(!result?.signal || !['BUY','SELL'].includes(result.signal.action)) return false;
  if(pair==='XAUUSD'&&!result.scalpMeta?.ready) { console.log(`🟡 Gold scalp rejected: ${result.scalpMeta?.status||'NOT_READY'}`); return false; }
  if(pair!=='XAUUSD') {
    const confidence=Number(result.signal.confidence);
    if(!Number.isFinite(confidence)||confidence<getNumberSetting('min_ai_confidence',60)) return false;
  }

  let levels;
  if(pair==='XAUUSD'&&result.scalpMeta?.ready) {
    const entry=Number(result.scalpMeta.entry), sl=Number(result.scalpMeta.stopLoss), tp1=Number(result.scalpMeta.tp1), tp2=Number(result.scalpMeta.tp2), atr=Number(result.scalpMeta.atr5);
    const riskDistance=Math.abs(entry-sl);
    levels={entry,sl,tp1,tp2,atr,riskDistance,riskPct:entry>0?riskDistance/entry*100:null,rrTp1:riskDistance>0?Math.abs(tp1-entry)/riskDistance:null,rrTp2:riskDistance>0?Math.abs(tp2-entry)/riskDistance:null};
    console.log('⚡ Strategy-owned Gold levels:',{strategy:result.scalpMeta?.strategyLabel,entry,sl,tp1,tp2});
  } else {
    const candles=await getCandles(pair);
    levels=calculateTradeLevels(candles,result.signal.action,pair);
  }
  if(!levels||!Number.isFinite(Number(levels.entry))||!Number.isFinite(Number(levels.sl))) return false;

  if(pair==='XAUUSD'&&result.scalpMeta?.ready) {
    try {
      const livePrice=Number(await getPrice(pair));
      const rebased=rebaseLevelsToLivePrice(levels,livePrice);
      if(!rebased) throw new Error('INVALID_LIVE_PRICE');
      levels=rebased;
      console.log(`🎯 LIVE EXECUTION PRICE | ${pair} | ${result.scalpMeta?.strategyLabel||'GOLD SCALP'} | strategy=${Number(levels.strategyEntry).toFixed(2)} | live=${Number(levels.entry).toFixed(2)} | shift=${Number(levels.executionShift).toFixed(2)}`);
      console.log(`📐 LIVE LEVELS REBASED | SL=${Number(levels.sl).toFixed(2)} | TP1=${Number(levels.tp1).toFixed(2)} | TP2=${Number(levels.tp2).toFixed(2)} | RR preserved`);
    } catch(e) {
      console.log(`❌ LIVE ENTRY PRICE FAILED | ${pair} | ${result.scalpMeta?.strategyLabel||'GOLD SCALP'} | ${e.message}`);
      return false;
    }
  }

  let scalpEntry;
  if(pair==='XAUUSD'&&result.scalpMeta?.ready) { scalpEntry={status:'ENTRY_READY',reason:'STRATEGY_READY'}; console.log(`⚡ XAUUSD strategy READY accepted directly: ${result.scalpMeta?.strategyLabel||'GOLD SCALP'}`); }
  else scalpEntry=await evaluateScalpEntry(pair,result.signal.action,result.indicators);
  if(scalpEntry.status!=='ENTRY_READY') return false;

  const now=Date.now(), currentEntry=Number(levels.entry), currentAtr=Number(result.scalpMeta?.atr5||levels.atr||result.indicators?.atr||0), currentDirection=String(result.signal.action), currentMode=String(result.scalpMeta?.entryMode||'UNKNOWN');
  const scalpStrategyId=String(result.scalpMeta?.strategyId||'SCALP').toUpperCase();
  const signalKey=`${pair}:${scalpStrategyId}`, previousSignal=lastSignals[signalKey];
  if(previousSignal) {
    const sameDirection=previousSignal.direction===currentDirection, sameMode=previousSignal.mode===currentMode, elapsed=now-previousSignal.time, priceDistance=Math.abs(currentEntry-previousSignal.entry), referenceAtr=Math.max(currentAtr||0,previousSignal.atr||0,1);
    if(sameDirection&&sameMode&&priceDistance<referenceAtr*.80&&elapsed<20*60*1000) { console.log(`♻️ DUPLICATE GOLD SETUP SKIPPED | ${scalpStrategyId}`); return false; }
  }
  const existingScalpTrade=getOpenTrades().find(t=>String(t.telegram_id||'').toUpperCase()===`VIP_SCALP_${scalpStrategyId}`);
  if(existingScalpTrade) { console.log(`🔒 ${result.scalpMeta?.strategyLabel||'GOLD SCALP'} blocked: Trade #${existingScalpTrade.id} still open`); return false; }

  const livePrice=Number(levels.entry), atr=Number(result.indicators?.atr||4);
  const zone=Math.min(6,Math.max(2,atr*.75));
  const entryFrom=result.signal.action==='BUY'?livePrice:livePrice-zone, entryTo=result.signal.action==='BUY'?livePrice+zone:livePrice, isProStrategy=scalpStrategyId==='PRO_STRATEGY';
  const targetBlock=isProStrategy?`📌 إدارة الصفقة\nالخروج ليس بهدف سعري ثابت.\n${result.signal.action==='BUY'?'✅ إغلاق الصفقة عند RSI(14) ≥ 63':'✅ إغلاق الصفقة عند RSI(14) ≤ 37'}\n\n🧪 الاستراتيجية: RSI Reversal + Daily EMA50\n🕒 لا دخول بين 15:00 و16:59 UTC`:`🎯 الهدف الأول\n${Number(levels.tp1).toFixed(2)}\n\n🎯 الهدف الثاني\n${Number(levels.tp2).toFixed(2)}`;
  const riskBlock=isProStrategy?`📏 مسافة وقف الخسارة\n${Number(levels.riskDistance).toFixed(2)} دولار`:`⚖️ العائد للمخاطرة\nTP1 → 1:${Number(levels.rrTp1).toFixed(2)}\nTP2 → 1:${Number(levels.rrTp2).toFixed(2)}\n\n📏 مسافة وقف الخسارة\n${Number(levels.riskDistance).toFixed(2)}`;
  const message=`\n⚡ إشارة سكالب — ${result.scalpMeta?.strategyLabel||'Gold Scalp'}\n\n🥇 الزوج: ${pair}\n\n📈 الاتجاه: ${result.signal.action}\n\n💰 سعر التنفيذ الحي\n${livePrice.toFixed(2)}\n\n📍 منطقة الدخول\n${entryFrom.toFixed(2)} ➜ ${entryTo.toFixed(2)}\n\n🛑 وقف الخسارة\n${Number(levels.sl).toFixed(2)}\n\n${targetBlock}\n\n⚡ قرار الدخول: شروط الاستراتيجية مكتملة\n⏱️ الفريم التنفيذي: 5M\n\n📊 ATR\n${atr.toFixed(2)}\n\n${riskBlock}\n`;

  const tradeInsert=addTrade({telegram_id:`VIP_SCALP_${scalpStrategyId}`,pair,action:result.signal.action,entry:levels.entry,stop_loss:levels.sl,target1:levels.tp1,target2:levels.tp2});
  const tradeId=Number(tradeInsert?.lastInsertRowid||0);
  if(tradeId<=0) { console.log(`🛡️ LIVE SIGNAL NOT PUBLISHED | ${pair} | ${scalpStrategyId} | portfolio reservation rejected`); return false; }

  const vipDelivered=await sendVipSignal(bot,message,pair,scalpStrategyId);
  if(!vipDelivered) { pendingVipSignals.set(tradeId,{message,pair,strategyId:scalpStrategyId,createdAt:now}); console.log(`⏳ VIP ENTRY PENDING | ${pair} | ${scalpStrategyId} | Trade #${tradeId} stays OPEN and will be retried on following scans`); }

  lastSignals[signalKey]={direction:currentDirection,mode:currentMode,entry:currentEntry,atr:currentAtr,time:now};
  try { const power=evaluatePowerTrade({tradeId,pair,action:result.signal.action,result}); if(power.qualified) console.log(`⚡ POWER TRADE ${power.grade} | ${pair} | Score ${power.powerScore}/100 | Trade #${tradeId}`); } catch(e) {}
  try { saveTradeFeatures({tradeId,pair,action:result.signal.action,indicators:result.indicators||{},scalpMeta:result.scalpMeta||{}}); console.log(`🧠 Adaptive snapshot saved | Trade ${tradeId}`); } catch(e) { console.log('⚠️ Adaptive snapshot save failed:',e.message); }
  const users=allUsers(); let freePublicSent=false;
  const freeEligible=!isProStrategy&&pair==='XAUUSD'&&result.scalpMeta?.ready===true&&Number(result.scalpMeta?.score||0)>=80&&canSendFreeSignal(24);
  if(freeEligible&&config.mainGroupId){try{await bot.telegram.sendMessage(config.mainGroupId,`🆓 صفقة مجانية من FOREX AI\n━━━━━━━━━━━━━━━━━━\n\n${message}\n\n💎 أعضاء VIP يحصلون على جميع الفرص والتحديثات بشكل مستمر.\n\n⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`);markTradeAsFree(tradeId);markFreeSignalSent();freePublicSent=true;}catch(e){}}
  if(!freePublicSent&&!isProStrategy){try{await publishHiddenSignal(bot,{tradeId,pair,action:result.signal.action,entry:levels.entry,stopLoss:levels.sl,target1:levels.tp1,target2:levels.tp2,aiScore:Number(result.scalpMeta?.score??result.signal?.confidence??0)});}catch(e){}}
  for(const adminId of config.adminIds){if(!users.find(u=>String(u.telegram_id)===String(adminId))){try{await bot.telegram.sendMessage(adminId,message);}catch(e){}}}
  if(pair==='XAUUSD'&&result.scalpMeta?.ready&&typeof result.scalpMeta.markSent==='function') result.scalpMeta.markSent();
  console.log(`✅ LIVE SIGNAL COMMITTED | ${pair} | ${scalpStrategyId} | Trade #${tradeId} | entry=${Number(levels.entry).toFixed(2)} | vipDelivered=${vipDelivered}`);
  return true;
}

async function scanMarket(bot) {
  if(!getBoolSetting('auto_signals_enabled',true)) { console.log('⏸️ Auto Signals disabled from Admin Control Center'); return; }
  await retryPendingVipSignals(bot);
  const scanStart=Date.now(); console.log('🚀 SCAN START:',new Date(scanStart).toLocaleTimeString()); console.log('🚨 AUTO SIGNALS FILE IS RUNNING'); console.log('🔍 Scanning Market...');
  for(const pair of PAIRS){try{
    let result;
    if(pair==='XAUUSD'){
      const baseAnalysis=await analyzePair(pair);
      result=await buildGoldScalpResult(baseAnalysis);
      const readyResults=Array.isArray(result?.readySignalResults)&&result.readySignalResults.length?result.readySignalResults:(result?.signal?[result]:[]);
      if(readyResults.length>1) console.log(`🔥 MULTI-READY GOLD | ${readyResults.length} strategies will be processed independently`);
      for(const readyResult of readyResults) await processSignalResult(bot,pair,readyResult);
      continue;
    }
    result=await analyzePair(pair);
    if(result?.signal) await processSignalResult(bot,pair,result);
  }catch(error){console.log(`❌ Auto signal scan error ${pair}:`,error.message);}}
  console.log(`✅ Auto Signals finished in ${Date.now()-scanStart}ms`);
}
module.exports={scanMarket,processSignalResult};