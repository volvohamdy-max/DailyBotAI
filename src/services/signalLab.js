const analyzeIndicators = require('../indicators/analyzer');
const { getSignalLabHistory, hasSignalLabHistory } = require('./signalLabHistoryStore');

const MIN_SIMILAR = 3;
const FUTURE_CANDLES = 4;
const MIN_SIMILARITY = 25;
const MAX_HISTORICAL = 50;
const MAX_EVALUATIONS = 30000;

function empty(reason) {
  return { approved:false, historicalScore:0, similarSetups:0, tp1Rate:0, tp2Rate:0, slRate:0, directionMatchRate:0, examples:[], reason };
}

function directionFromIndicators(indicators) {
  if (!indicators) return 'WAIT';
  const ema20=Number(indicators.ema20), ema50=Number(indicators.ema50), rsi=Number(indicators.rsi);
  const macd=indicators.macd;
  let buy=0,sell=0;
  if(Number.isFinite(ema20)&&Number.isFinite(ema50)){if(ema20>ema50)buy++;if(ema20<ema50)sell++;}
  if(Number.isFinite(rsi)){if(rsi>50)buy++;if(rsi<50)sell++;}
  if(macd){const m=Number(macd.macd),s=Number(macd.signal);if(Number.isFinite(m)&&Number.isFinite(s)){if(m>s)buy++;if(m<s)sell++;}}
  if(buy>sell&&buy>=2)return'BUY'; if(sell>buy&&sell>=2)return'SELL'; return'WAIT';
}

function similarityScore(current,historical){
  if(!current||!historical)return 0; let score=0;
  const ce=Number(current.ema20)-Number(current.ema50), he=Number(historical.ema20)-Number(historical.ema50);
  if(Number.isFinite(ce)&&Number.isFinite(he)&&Math.sign(ce)===Math.sign(he))score+=30;
  const cr=Number(current.rsi),hr=Number(historical.rsi); if(Number.isFinite(cr)&&Number.isFinite(hr)){const d=Math.abs(cr-hr);score+=d<=5?25:d<=10?15:d<=15?8:0;}
  const ca=Number(current.adx),ha=Number(historical.adx); if(Number.isFinite(ca)&&Number.isFinite(ha)){const d=Math.abs(ca-ha);score+=d<=5?20:d<=10?10:0;}
  if(current.macd&&historical.macd){const cm=Number(current.macd.macd)>Number(current.macd.signal),hm=Number(historical.macd.macd)>Number(historical.macd.signal);if(cm===hm)score+=25;}
  return Math.min(100,Math.max(0,score));
}

function simulateOutcome(candles,index,direction){
  const entry=Number(candles[index].close); if(!Number.isFinite(entry))return null;
  const future=candles.slice(index+1,index+1+FUTURE_CANDLES); if(future.length<FUTURE_CANDLES)return null;
  const previous=candles.slice(Math.max(0,index-10),index); if(previous.length<5)return null;
  const ranges=previous.map(c=>Number(c.high)-Number(c.low)).filter(Number.isFinite); if(!ranges.length)return null;
  const avgRange=ranges.reduce((a,b)=>a+b,0)/ranges.length; if(!(avgRange>0))return null;
  const tp1=direction==='BUY'?entry+avgRange:entry-avgRange;
  const tp2=direction==='BUY'?entry+avgRange*1.8:entry-avgRange*1.8;
  const sl=direction==='BUY'?entry-avgRange:entry+avgRange;
  let tp1Hit=false,tp2Hit=false,slHit=false;
  for(const c of future){const h=Number(c.high),l=Number(c.low);if(!Number.isFinite(h)||!Number.isFinite(l))continue;
    if(direction==='BUY'){if(l<=sl){slHit=true;break;}if(h>=tp1)tp1Hit=true;if(h>=tp2){tp2Hit=true;break;}}
    else{if(h>=sl){slHit=true;break;}if(l<=tp1)tp1Hit=true;if(l<=tp2){tp2Hit=true;break;}}
  }
  return{tp1Hit,tp2Hit,slHit};
}

async function runSignalLab(pair,currentIndicators,direction,options={}){
  try{
    const symbol=String(pair||'').toUpperCase();
    if(symbol!=='XAUUSD')return empty('Signal Lab historical matching is Gold-only');
    if(!currentIndicators||!direction||direction==='WAIT')return empty('Invalid setup');
    if(!hasSignalLabHistory('XAUUSD'))return empty('Gold historical database not downloaded yet');
    const timeframe=options.timeframe||'5min';
    const candles=getSignalLabHistory('XAUUSD',timeframe);
    if(!candles||candles.length<100)return empty('Not enough local Gold history');
    console.log(`🧪 SIGNAL LAB LOCAL: XAUUSD ${direction} | ${timeframe} | candles=${candles.length}`);
    const stride=Math.max(1,Math.ceil(candles.length/MAX_EVALUATIONS));
    const historical=[];
    for(let i=60;i<candles.length-FUTURE_CANDLES;i+=stride){
      let indicators;try{indicators=analyzeIndicators(candles.slice(i-59,i+1));}catch(_){continue;}if(!indicators)continue;
      const similarity=similarityScore(currentIndicators,indicators);if(!Number.isFinite(similarity)||similarity<MIN_SIMILARITY)continue;
      const outcome=simulateOutcome(candles,i,direction);if(!outcome)continue;
      historical.push({similarity,directionMatch:directionFromIndicators(indicators)===direction,time:candles[i].timestamp,...outcome});
    }
    if(!historical.length)return empty('No similar historical setups');
    historical.sort((a,b)=>b.similarity-a.similarity);
    const selected=historical.slice(0,MAX_HISTORICAL),total=selected.length;
    const tp1Rate=Math.round(selected.filter(x=>x.tp1Hit).length/total*100);
    const tp2Rate=Math.round(selected.filter(x=>x.tp2Hit).length/total*100);
    const slRate=Math.round(selected.filter(x=>x.slHit).length/total*100);
    const directionMatchRate=Math.round(selected.filter(x=>x.directionMatch).length/total*100);
    let historicalScore=tp1Rate*.40+tp2Rate*.25+(100-slRate)*.20+directionMatchRate*.15;
    if(total<5)historicalScore*=.75;else if(total<10)historicalScore*=.90;
    historicalScore=Math.max(0,Math.min(100,Math.round(historicalScore)));
    const approved=total>=MIN_SIMILAR&&historicalScore>=60&&tp1Rate>=55&&slRate<=45;
    const examples=selected.slice(0,5).map(x=>({date:new Date(x.time).toISOString().slice(0,10),similarity:x.similarity,tp1Hit:x.tp1Hit,tp2Hit:x.tp2Hit,slHit:x.slHit}));
    console.log('🧪 SIGNAL LAB RESULT XAUUSD:',{timeframe,direction,similarSetups:total,tp1Rate,tp2Rate,slRate,historicalScore,approved});
    return{approved,historicalScore,similarSetups:total,tp1Rate,tp2Rate,slRate,directionMatchRate,examples,reason:approved?'Historical validation passed':'Historical validation failed'};
  }catch(error){console.log('❌ Signal Lab local error:',error.message);return empty(error.message);}
}

module.exports={runSignalLab};
