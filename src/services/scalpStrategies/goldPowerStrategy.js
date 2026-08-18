const { analyzeGoldPowerTrade } = require('../goldPowerTrade');
const CONFIG={id:'GOLD_POWER',label:'🏆 Gold Power'};
async function scan(){
  const x=await analyzeGoldPowerTrade();
  if(!x?.ready)return{...(x||{}),ready:false,strategyId:CONFIG.id,strategyLabel:CONFIG.label};
  return{ready:true,status:'GOLD_POWER_READY',pair:'XAUUSD',direction:x.direction,strategyId:CONFIG.id,strategyLabel:CONFIG.label,entryMode:'POWER_15M_1H',grade:'A+',score:Number(x.score||0),aiConfidence:0,entry:Number(x.levels.entry),stopLoss:Number(x.levels.stopLoss),tp1:Number(x.levels.tp1),tp2:Number(x.levels.tp2),risk:Number(x.levels.riskDistance),rrTp1:2,rrTp2:3,atr5:Number(x.meta?.atr15)||null,rsi5:Number(x.meta?.rsi15)||null,adx5:Number(x.meta?.adx15)||null,vwap5:Number(x.meta?.vwap15)||null,trend15:x.direction,trend1h:x.direction,reasons:['15M + 1H aligned','ADX15 >= 28','5/6 power confirmations']};
}
module.exports={CONFIG,scan};
