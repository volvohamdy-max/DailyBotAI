const { getCandles, getPrice } = require('./marketService');
const { addTrade, getOpenTrades } = require('../database/trades');
const config = require('../config');

let lastPower = { direction: null, entry: null, time: 0 };
const n = v => { const x=Number(v); return Number.isFinite(x)?x:null; };
function ema(a,p){a=a.map(Number).filter(Number.isFinite);if(a.length<p)return null;let e=a.slice(0,p).reduce((x,y)=>x+y,0)/p,k=2/(p+1);for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function rsi(a,p=14){a=a.map(Number).filter(Number.isFinite);if(a.length<=p)return null;let g=0,l=0,s=a.length-p-1;for(let i=s+1;i<a.length;i++){let d=a[i]-a[i-1];d>0?g+=d:l+=Math.abs(d);}g/=p;l/=p;if(!l)return 100;return 100-100/(1+g/l);}
function atr(c,p=14){if(c.length<p+1)return null;let s=c.slice(-(p+1)),t=[];for(let i=1;i<s.length;i++){let h=n(s[i].high),l=n(s[i].low),pc=n(s[i-1].close);if(h==null||l==null||pc==null)continue;t.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}return t.length>=p?t.slice(-p).reduce((a,b)=>a+b,0)/p:null;}
function adx(c,p=14){if(c.length<p*2+1)return null;let s=c.slice(-(p*2+1)),tr=[],pd=[],md=[];for(let i=1;i<s.length;i++){let h=n(s[i].high),l=n(s[i].low),ph=n(s[i-1].high),pl=n(s[i-1].low),pc=n(s[i-1].close);if([h,l,ph,pl,pc].some(x=>x==null))continue;let u=h-ph,d=pl-l;pd.push(u>d&&u>0?u:0);md.push(d>u&&d>0?d:0);tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}let dx=[];for(let e=p;e<=tr.length;e++){let ts=tr.slice(e-p,e).reduce((a,b)=>a+b,0);if(!ts)continue;let pi=100*pd.slice(e-p,e).reduce((a,b)=>a+b,0)/ts,mi=100*md.slice(e-p,e).reduce((a,b)=>a+b,0)/ts,d=pi+mi;if(d)dx.push(100*Math.abs(pi-mi)/d);}return dx.length>=p?dx.slice(-p).reduce((a,b)=>a+b,0)/p:null;}
function vwap(c,p=24){let pv=0,v=0;for(const x of c.slice(-p)){let h=n(x.high),l=n(x.low),cl=n(x.close),vol=n(x.volume??x.v);if([h,l,cl,vol].some(y=>y==null)||vol<=0)continue;pv+=((h+l+cl)/3)*vol;v+=vol;}return v?pv/v:null;}
function mom(a){if(a.length<4)return'WAIT';let d=a[a.length-1]-a[a.length-4];return d>0?'BUY':d<0?'SELL':'WAIT';}
const r2=x=>Math.round(x*100)/100;

async function analyzeGoldPowerTrade(){
  const [r15,r1h,px]=await Promise.all([getCandles('XAUUSD','15min'),getCandles('XAUUSD','1h'),getPrice('XAUUSD')]);
  const c15=r15.slice(0,-1),c1h=r1h.slice(0,-1),a15=c15.map(x=>n(x.close)).filter(x=>x!=null),a1h=c1h.map(x=>n(x.close)).filter(x=>x!=null);
  if(a15.length<55||a1h.length<55)return{ready:false,status:'POWER_DATA_NOT_READY'};
  const m={price:n(px),ema20_15:ema(a15.slice(-80),20),ema50_15:ema(a15.slice(-100),50),ema20_1h:ema(a1h.slice(-80),20),ema50_1h:ema(a1h.slice(-100),50),rsi15:rsi(a15),adx15:adx(c15),atr15:atr(c15),vwap15:vwap(c15),momentum15:mom(a15)};
  if(Object.entries(m).filter(([k])=>k!=='momentum15').some(([,v])=>v==null))return{ready:false,status:'POWER_INDICATORS_NOT_READY',meta:m};
  const b={trend15:m.ema20_15>m.ema50_15,trend1h:m.ema20_1h>m.ema50_1h,rsi:m.rsi15>=52&&m.rsi15<=70,adx:m.adx15>=28,vwap:m.price>m.vwap15,momentum:m.momentum15==='BUY'};
  const s={trend15:m.ema20_15<m.ema50_15,trend1h:m.ema20_1h<m.ema50_1h,rsi:m.rsi15<=48&&m.rsi15>=30,adx:m.adx15>=28,vwap:m.price<m.vwap15,momentum:m.momentum15==='SELL'};
  const bp=Object.values(b).filter(Boolean).length,sp=Object.values(s).filter(Boolean).length;let d=null,checks=null,passed=0;
  if(b.trend15&&b.trend1h&&b.adx&&bp>=5){d='BUY';checks=b;passed=bp;}else if(s.trend15&&s.trend1h&&s.adx&&sp>=5){d='SELL';checks=s;passed=sp;}
  m.buyPassed=bp;m.sellPassed=sp;if(!d)return{ready:false,status:'WAIT_POWER_CONFIRMATION',meta:m};
  const risk=Math.max(m.atr15*1.5,5),entry=m.price,sl=d==='BUY'?entry-risk:entry+risk,tp1=d==='BUY'?entry+2*risk:entry-2*risk,tp2=d==='BUY'?entry+3*risk:entry-3*risk;
  return{ready:true,status:'POWER_READY',direction:d,score:Math.round(passed/6*100),checks,meta:m,levels:{entry:r2(entry),stopLoss:r2(sl),tp1:r2(tp1),tp2:r2(tp2),riskDistance:r2(risk)}};
}

async function scanGoldPowerTrade(bot){
 try{
  const x=await analyzeGoldPowerTrade();console.log('🏆 GOLD POWER RESULT:',JSON.stringify(x,null,2));if(!x.ready)return x;
  const open=getOpenTrades().find(t=>String(t.telegram_id).toUpperCase()==='VIP_POWER');if(open){console.log(`🔒 GOLD POWER blocked: #${open.id} still OPEN`);return x;}
  const now=Date.now(),same=lastPower.direction===x.direction,move=lastPower.entry==null?Infinity:Math.abs(x.levels.entry-lastPower.entry);if(same&&now-lastPower.time<4*60*60*1000&&move<x.meta.atr15){console.log('♻️ GOLD POWER duplicate skipped');return x;}
  if(!config.vipChannelId){console.log('❌ GOLD POWER not sent: VIP_CHANNEL_ID missing');return x;}
  const q=addTrade({telegram_id:'VIP_POWER',pair:'XAUUSD',action:x.direction,entry:x.levels.entry,stop_loss:x.levels.stopLoss,target1:x.levels.tp1,target2:x.levels.tp2});const id=Number(q?.lastInsertRowid||0);if(!id)throw new Error('Failed to save GOLD POWER trade');lastPower={direction:x.direction,entry:x.levels.entry,time:now};
  const msg=`🏆 GOLD POWER TRADE\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: ${x.direction}\n\n📍 الدخول\n${x.levels.entry.toFixed(2)}\n\n🛑 وقف الخسارة\n${x.levels.stopLoss.toFixed(2)}\n\n🎯 الهدف الأول\n${x.levels.tp1.toFixed(2)}\n\n🎯 الهدف الثاني\n${x.levels.tp2.toFixed(2)}\n\n🔥 Power Score\n${x.score}/100\n\n🧭 تأكيد الاتجاه: 15M + 1H\n📊 ADX 15M: ${x.meta.adx15.toFixed(2)}\n🎯 RSI 15M: ${x.meta.rsi15.toFixed(2)}\n⚖️ VWAP 15M: ${x.meta.vwap15.toFixed(2)}\n📏 المخاطرة: ${x.levels.riskDistance.toFixed(2)}\n\n💎 نوع الصفقة: صفقة ذهب قوية / Swing Intraday`;
  await bot.telegram.sendMessage(config.vipChannelId,msg);console.log(`🏆 GOLD POWER SENT | ${x.direction} | Score ${x.score}/100 | Trade #${id}`);return{...x,sent:true,tradeId:id};
 }catch(e){console.log('❌ GOLD POWER scan error:',e.message);return{ready:false,status:'POWER_ERROR',error:e.message};}
}
module.exports={analyzeGoldPowerTrade,scanGoldPowerTrade};
