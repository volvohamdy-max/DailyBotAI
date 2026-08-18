const config = require('../config');
const { allUsers, findUser } = require('../database/users');
const { scanTrends } = require('./trendHunter');

const lastSent = new Map();
const COOLDOWN_MS = 60 * 60 * 1000;
function k(x){return `${x.pair}:${x.direction}`;}
function canSend(x){return Date.now()-(lastSent.get(k(x))||0)>=COOLDOWN_MS;}
function mark(x){lastSent.set(k(x),Date.now());}
function p(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(5):'—';}

function msg(x,en=false){
  const l=x.levels||{};
  return en
    ? `🔥 TREND HUNTER — ENTRY READY\n━━━━━━━━━━━━━━━━━━\n\n💱 ${x.pair}\n${x.direction==='BUY'?'🟢 BUY':'🔴 SELL'}\n\n⭐ Trend Score: ${x.score}/100\n🤖 AI Confidence: ${x.aiConfidence}%\n💪 ADX: ${Number.isFinite(x.adx)?x.adx.toFixed(1):'—'}\n📊 RSI: ${Number.isFinite(x.rsi)?x.rsi.toFixed(1):'—'}\n\n💰 Entry: ${p(l.entry)}\n🛑 Stop Loss: ${p(l.sl)}\n🎯 TP1: ${p(l.tp1)}\n🏆 TP2: ${p(l.tp2)}\n⚖️ R:R → 1:1 / 1:2\n\n⚠️ Automated analysis; not a guarantee of profit.`
    : `🔥 صياد الترند — دخول جاهز\n━━━━━━━━━━━━━━━━━━\n\n💱 ${x.pair}\n${x.direction==='BUY'?'🟢 BUY':'🔴 SELL'}\n\n⭐ قوة الترند: ${x.score}/100\n🤖 ثقة AI: ${x.aiConfidence}%\n💪 ADX: ${Number.isFinite(x.adx)?x.adx.toFixed(1):'—'}\n📊 RSI: ${Number.isFinite(x.rsi)?x.rsi.toFixed(1):'—'}\n\n💰 الدخول: ${p(l.entry)}\n🛑 وقف الخسارة: ${p(l.sl)}\n🎯 TP1: ${p(l.tp1)}\n🏆 TP2: ${p(l.tp2)}\n⚖️ العائد للمخاطرة → 1:1 / 1:2\n\n⚠️ تحليل آلي وليس ضمانًا للربح.`;
}

async function send(bot,id,text){try{await bot.telegram.sendMessage(id,text);}catch(e){console.log(`Trend Hunter send failed ${id}:`,e.message);}}

async function runAutoTrendHunter(bot){
  console.log('📡 Auto Trend Hunter started...');
  const results=await scanTrends();
  const ready=results.filter(x=>x.status==='ENTRY_READY'&&Number(x.score)>=82&&Number(x.aiConfidence)>=75&&Number(x.adx)>=25&&x.levels&&canSend(x));
  if(!ready.length){console.log('📡 Auto Trend Hunter: no elite entry-ready setup');return;}

  for(const x of ready){
    const recipients=new Set();
    for(const u of allUsers()) recipients.add(String(u.telegram_id));
    for(const a of config.adminIds||[]) recipients.add(String(a));
    if(config.mainGroupId) recipients.add(String(config.mainGroupId));

    for(const id of recipients){
      const u=findUser(id);
      await send(bot,id,msg(x,!!(u&&u.language==='en')));
    }
    mark(x);
    console.log(`✅ Trend Hunter alert sent: ${x.pair} ${x.direction}`);
  }
}

function startAutoTrendHunter(bot){
  setTimeout(()=>runAutoTrendHunter(bot).catch(e=>console.log('❌ Auto Trend Hunter:',e.stack||e)),2*60*1000);
  setInterval(()=>runAutoTrendHunter(bot).catch(e=>console.log('❌ Auto Trend Hunter:',e.stack||e)),10*60*1000);
  console.log('📡 Auto Trend Hunter scheduled every 10 minutes');
}
module.exports={runAutoTrendHunter,startAutoTrendHunter};
