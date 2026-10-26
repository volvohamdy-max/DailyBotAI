const { allUsers } = require('../database/users');
const { isForexWeekend } = require('../utils/marketHours');
const { buildRadar, formatAutoAlert } = require('./goldZoneRadar');

const REARM_MS=Number(process.env.GOLD_ZONE_REARM_MS)||45*60*1000;
const MIN_ZONE_SHIFT_PCT=Number(process.env.GOLD_ZONE_NEW_SHIFT_PCT)||0.16;
const activeOpportunities=new Map();
let running=false;

function qualifiedOpportunity(radar){
  const s=radar?.scenario,z=radar?.setup?.zone;
  if(!s||!z||radar?.newsRisk?.blocked)return null;
  if(s.status!=='READY')return null;
  if(s.score<80||z.score<65||z.nearestPct>.09)return null;
  return{side:s.side,zone:Number(z.price),score:s.score,zoneScore:z.score,distance:z.nearestPct};
}
function materiallyNew(previous,current){if(!previous)return true;if(previous.side!==current.side)return true;const shift=Math.abs(previous.zone-current.zone)/Math.max(1,current.zone)*100;return shift>=MIN_ZONE_SHIFT_PCT;}
async function sendVip(bot,message){if(!message)return 0;const users=allUsers({vipOnly:true});let sent=0;for(const user of users){try{await bot.telegram.sendMessage(user.telegram_id,message);sent++;}catch(error){console.log(`⚠️ GOLD ZONE alert user ${user.telegram_id}:`,error.message);}}return sent;}
async function runGoldZoneAutoAlerts(bot){if(running||isForexWeekend())return;running=true;try{const radar=await buildRadar(),op=qualifiedOpportunity(radar),now=Date.now();for(const[side,state]of activeOpportunities.entries()){if(!op||op.side!==side){if(!state.absentSince)state.absentSince=now;if(now-state.absentSince>=REARM_MS)activeOpportunities.delete(side);}else state.absentSince=null;}if(!op)return;const previous=activeOpportunities.get(op.side);if(previous&&!materiallyNew(previous,op))return;const message=formatAutoAlert(radar,'READY');const sent=await sendVip(bot,message);if(sent>0){activeOpportunities.set(op.side,{...op,sentAt:now,absentSince:null});console.log(`🚨 GOLD ZONE OPPORTUNITY ${op.side} | zone=${op.zone.toFixed(2)} score=${op.score} VIP sent=${sent}`);}}catch(error){console.log('❌ GOLD ZONE AUTO ALERT:',error.message);}finally{running=false;}}
module.exports={runGoldZoneAutoAlerts};