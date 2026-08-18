const { analyzePair } = require('./analysisService');
const { getCandles } = require('./marketService');
const { calculateTradeLevels } = require('./tradeEngine');

const PAIRS = ['XAUUSD','BTCUSD','EURUSD','GBPUSD','USDJPY','EURJPY','GBPJPY','CHFJPY'];

function clamp(n,min=0,max=100){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;}

function directionOf(i){
  const e20=Number(i?.ema20), e50=Number(i?.ema50);
  const m=Number(i?.macd?.macd), s=Number(i?.macd?.signal);
  if([e20,e50,m,s].every(Number.isFinite)){
    if(e20>e50 && m>s) return 'BUY';
    if(e20<e50 && m<s) return 'SELL';
  }
  return 'WAIT';
}

function evidence(i,a,d){
  const e20=Number(i?.ema20),e50=Number(i?.ema50),rsi=Number(i?.rsi),adx=Number(i?.adx);
  const macd=Number(i?.macd?.macd),sig=Number(i?.macd?.signal);
  const aiAction=String(a?.signal?.action||'').toUpperCase();
  const aiConfidence=Number(a?.signal?.confidence)||0;

  return {
    emaAligned: d==='BUY'?e20>e50:d==='SELL'?e20<e50:false,
    macdAligned: d==='BUY'?macd>sig:d==='SELL'?macd<sig:false,
    adxReady: Number.isFinite(adx)&&adx>=25,
    rsiReady: d==='BUY'?(rsi>=52&&rsi<=66):d==='SELL'?(rsi>=34&&rsi<=48):false,
    aiReady: aiAction===d&&aiConfidence>=70&&!a?.aiDirectionMismatch,
    overheated: d==='BUY'?rsi>=68:d==='SELL'?rsi<=32:false
  };
}

function score(i,a,d,e){
  const adx=Number(i?.adx), rsi=Number(i?.rsi), conf=clamp(a?.signal?.confidence);
  let x=0;
  if(e.emaAligned)x+=25;
  if(e.macdAligned)x+=20;
  if(Number.isFinite(adx)){
    if(adx>=35)x+=25; else if(adx>=30)x+=22; else if(adx>=25)x+=18; else if(adx>=20)x+=10;
  }
  if(Number.isFinite(rsi)){
    if(e.rsiReady)x+=15;
    else if(d==='BUY'&&rsi>50&&rsi<70)x+=10;
    else if(d==='SELL'&&rsi>30&&rsi<50)x+=10;
    else if(e.overheated)x+=3;
  }
  if(e.aiReady){
    if(conf>=85)x+=15; else if(conf>=75)x+=12; else x+=8;
  }
  return Math.round(clamp(x));
}

function statusOf(d,s,e,adx){
  if(d==='WAIT'||!Number.isFinite(adx)||adx<20)return 'NO_TREND';
  if(e.overheated&&s>=65)return 'WAIT_PULLBACK';
  if(s>=78&&e.adxReady&&e.rsiReady&&e.aiReady)return 'ENTRY_READY';
  if(s>=65)return 'TREND_FOUND';
  return 'NO_TREND';
}

function blockers(e){
  const out=[];
  if(!e.emaAligned)out.push('EMA');
  if(!e.macdAligned)out.push('MACD');
  if(!e.adxReady)out.push('ADX');
  if(!e.rsiReady)out.push('RSI');
  if(!e.aiReady)out.push('AI');
  if(e.overheated)out.push('PULLBACK');
  return out;
}

async function analyzeTrend(pair){
  const a=await analyzePair(pair);
  if(!a?.indicators)return {pair,direction:'WAIT',status:'NO_DATA',score:0,blockers:['DATA']};
  const i=a.indicators,d=directionOf(i),e=evidence(i,a,d),s=score(i,a,d,e),adx=Number(i?.adx);
  const status=statusOf(d,s,e,adx);
  let levels=null;
  if(status==='ENTRY_READY'){
    try{levels=calculateTradeLevels(await getCandles(pair),d);}catch(err){console.log(`Trend levels ${pair}:`,err.message);}
  }
  return {
    pair,direction:d,status,score:s,blockers:blockers(e),evidence:e,
    aiConfidence:Number(a?.signal?.confidence)||0,
    aiAction:String(a?.signal?.action||'WAIT').toUpperCase(),
    adx, rsi:Number(i?.rsi), ema20:Number(i?.ema20), ema50:Number(i?.ema50),
    macd:Number(i?.macd?.macd), macdSignal:Number(i?.macd?.signal), levels
  };
}

async function scanTrends(){
  const out=[];
  for(const p of PAIRS){try{out.push(await analyzeTrend(p));}catch(e){out.push({pair:p,direction:'WAIT',status:'ERROR',score:0,blockers:['ERROR']});}}
  const rank={ENTRY_READY:5,WAIT_PULLBACK:4,TREND_FOUND:3,NO_TREND:2,NO_DATA:1,ERROR:0};
  return out.sort((a,b)=>(rank[b.status]-rank[a.status])||(b.score-a.score));
}

module.exports={PAIRS,analyzeTrend,scanTrends};
