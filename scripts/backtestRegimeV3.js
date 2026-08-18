require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGoldHistoricalCandles } = require('./backtestHistoryV21');

const HISTORY = Number(process.env.BACKTEST_HISTORY || 50000);
const DEV_RATIO = Math.min(0.85, Math.max(0.55, Number(process.env.BACKTEST_DEV_RATIO || 0.70)));
const SPREAD_USD = Math.max(0, Number(process.env.BACKTEST_SPREAD_USD || 0.35));
const SLIPPAGE_USD = Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_USD || 0.05));
const TP_PROFILES = String(process.env.BACKTEST_TP_PROFILES || '1,1.5,2')
  .split(',').map(Number).filter(x => Number.isFinite(x) && x > 0);
const OUT_DIR = path.resolve(process.cwd(), 'data', 'backtests');
fs.mkdirSync(OUT_DIR, { recursive: true });

const FIVE_MIN = 5 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function cloneRows(rows=[]){
  return rows.map(r=>({
    time:Number(r.time), open:n(r.open), high:n(r.high), low:n(r.low), close:n(r.close), volume:n(r.volume)||0
  })).filter(r=>[r.time,r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
}
function ema(values,p){const out=Array(values.length).fill(null);if(values.length<p)return out;let seed=0;for(let i=0;i<p;i++)seed+=values[i];let prev=seed/p;out[p-1]=prev;const k=2/(p+1);for(let i=p;i<values.length;i++){prev=values[i]*k+prev*(1-k);out[i]=prev;}return out;}
function rsi(values,p=14){const out=Array(values.length).fill(null);if(values.length<=p)return out;let g=0,l=0;for(let i=1;i<=p;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l+=Math.abs(d);}let ag=g/p,al=l/p;const calc=()=>al===0?100:100-100/(1+ag/al);out[p]=calc();for(let i=p+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?Math.abs(d):0))/p;out[i]=calc();}return out;}
function atr(c,p=14){const tr=Array(c.length).fill(null),out=Array(c.length).fill(null);for(let i=1;i<c.length;i++)tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));if(c.length<=p)return out;let sum=0;for(let i=1;i<=p;i++)sum+=tr[i];let prev=sum/p;out[p]=prev;for(let i=p+1;i<c.length;i++){prev=(prev*(p-1)+tr[i])/p;out[i]=prev;}return out;}
function adx(c,p=14){const len=c.length,pdm=Array(len).fill(0),mdm=Array(len).fill(0),tr=Array(len).fill(0),dx=Array(len).fill(null),out=Array(len).fill(null);for(let i=1;i<len;i++){const up=c[i].high-c[i-1].high,down=c[i-1].low-c[i].low;pdm[i]=up>down&&up>0?up:0;mdm[i]=down>up&&down>0?down:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));}if(len<=p*2)return out;let ts=0,ps=0,ms=0;for(let i=1;i<=p;i++){ts+=tr[i];ps+=pdm[i];ms+=mdm[i];}for(let i=p;i<len;i++){if(i>p){ts=ts-ts/p+tr[i];ps=ps-ps/p+pdm[i];ms=ms-ms/p+mdm[i];}if(!ts)continue;const plus=100*ps/ts,minus=100*ms/ts,sum=plus+minus;if(sum)dx[i]=100*Math.abs(plus-minus)/sum;}const first=p*2-1;let sum=0,count=0;for(let i=p;i<=first;i++){if(dx[i]!=null){sum+=dx[i];count++;}}if(!count)return out;let prev=sum/count;out[first]=prev;for(let i=first+1;i<len;i++){if(dx[i]==null)continue;prev=(prev*(p-1)+dx[i])/p;out[i]=prev;}return out;}
function macd(values,fast=12,slow=26,signal=9){const ef=ema(values,fast),es=ema(values,slow),line=values.map((_,i)=>ef[i]!=null&&es[i]!=null?ef[i]-es[i]:null);const clean=line.map(v=>v==null?0:v);const sig=ema(clean,signal);return {line,signal:sig.map((v,i)=>line[i]==null?null:v)};}
function rollingVWAP(c,lookback=24){const out=Array(c.length).fill(null);for(let i=0;i<c.length;i++){let pv=0,v=0;for(let j=Math.max(0,i-lookback+1);j<=i;j++){const vol=c[j].volume||0;if(vol>0){pv+=((c[j].high+c[j].low+c[j].close)/3)*vol;v+=vol;}}out[i]=v>0?pv/v:null;}return out;}
function sessionVWAP(c){const out=Array(c.length).fill(null);let day='',pv=0,v=0;for(let i=0;i<c.length;i++){const d=new Date(c[i].time).toISOString().slice(0,10);if(d!==day){day=d;pv=0;v=0;}const vol=c[i].volume||0;if(vol>0){pv+=((c[i].high+c[i].low+c[i].close)/3)*vol;v+=vol;}out[i]=v>0?pv/v:null;}return out;}
function momentum(c,i,lookback=3){if(i<lookback)return {dir:null,strength:0,impulse:0};let impulse=0,strength=0;for(let j=i-lookback+1;j<=i;j++){const d=c[j].close-c[j].open;impulse+=d;if(d>0)strength++;else if(d<0)strength--;}return {dir:impulse>0?'BUY':impulse<0?'SELL':null,strength:Math.abs(strength),impulse};}
function bodyAtr(c,i,a){if(!a[i])return 0;return Math.abs(c[i].close-c[i].open)/a[i];}
function bodyShare(c,i){return Math.abs(c[i].close-c[i].open)/Math.max(1e-9,c[i].high-c[i].low);}
function candleDir(c,i,side){return side==='BUY'?c[i].close>c[i].open:c[i].close<c[i].open;}
function range(c,i,lookback=12){if(i<lookback)return null;const rows=c.slice(i-lookback,i);return {high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low))};}
function alignClosedIndex(htf, signalCloseTime, barMs){
  let lo=0,hi=htf.length-1,ans=-1;
  while(lo<=hi){const m=(lo+hi)>>1;const closeTime=htf[m].time+barMs;if(closeTime<=signalCloseTime){ans=m;lo=m+1;}else hi=m-1;}
  return ans;
}
function buildInd(c){const closes=c.map(x=>x.close);return {ema9:ema(closes,9),ema20:ema(closes,20),ema50:ema(closes,50),ema200:ema(closes,200),rsi14:rsi(closes,14),atr14:atr(c,14),adx14:adx(c,14),macd:macd(closes),rvwap24:rollingVWAP(c,24),svwap:sessionVWAP(c)};}

const TZ_FMT = new Map();
function tzParts(t, tz){
  let fmt=TZ_FMT.get(tz);
  if(!fmt){fmt=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});TZ_FMT.set(tz,fmt);}
  const obj={};for(const p of fmt.formatToParts(new Date(t))){if(p.type!=='literal')obj[p.type]=p.value;}
  return {year:+obj.year,month:+obj.month,day:+obj.day,hour:+obj.hour,minute:+obj.minute,key:`${obj.year}-${obj.month}-${obj.day}`};
}
function inLondon(t){const p=tzParts(t,'Europe/London');const m=p.hour*60+p.minute;return m>=8*60&&m<12*60;}
function inEarlyNY(t){const p=tzParts(t,'America/New_York');const m=p.hour*60+p.minute;return m>=8*60+30&&m<12*60;}
function inSessions(t){return inLondon(t)||inEarlyNY(t);}
function sessionName(t){return inLondon(t)?'LONDON':inEarlyNY(t)?'NY':'OTHER';}

function executionCostR(risk){
  if(!(risk>0)) return 0;
  return (SPREAD_USD + 2*SLIPPAGE_USD) / risk;
}
function makeTrade({c,i,side,atrValue,tpR=1.8,swingLookback=8,bufferAtr=0.12,tag}){
  const entryIndex=i+1;if(entryIndex>=c.length)return null;
  const rawOpen=c[entryIndex].open;
  const entry=side==='BUY'?rawOpen+SLIPPAGE_USD:rawOpen-SLIPPAGE_USD;
  const rows=c.slice(Math.max(0,i-swingLookback+1),i+1);
  const swing=side==='BUY'?Math.min(...rows.map(x=>x.low)):Math.max(...rows.map(x=>x.high));
  const rawRisk=side==='BUY'?entry-(swing-atrValue*bufferAtr):(swing+atrValue*bufferAtr)-entry;
  const minRisk=atrValue*0.55;
  const risk=Math.max(rawRisk,minRisk);
  if(!(risk>0))return null;
  const sl=side==='BUY'?entry-risk:entry+risk;
  const tp=side==='BUY'?entry+risk*tpR:entry-risk*tpR;
  return {side,entryIndex,entry,sl,tp,risk,tpR,tag,signalTime:c[i].time,entryTime:c[entryIndex].time,costR:executionCostR(risk)};
}
function simulate(c,t,endIndex=c.length-1){
  let exitIndex=null,result=null,maxFav=0,maxAdv=0;
  for(let j=t.entryIndex;j<=endIndex&&j<c.length;j++){
    const b=c[j];
    const fav=t.side==='BUY'?b.high-t.entry:t.entry-b.low;
    const adv=t.side==='BUY'?t.entry-b.low:b.high-t.entry;
    maxFav=Math.max(maxFav,fav);maxAdv=Math.max(maxAdv,adv);
    if(t.side==='BUY'){
      if(b.low<=t.sl){result='LOSS';exitIndex=j;break;}
      if(b.high>=t.tp){result='WIN';exitIndex=j;break;}
    }else{
      if(b.high>=t.sl){result='LOSS';exitIndex=j;break;}
      if(b.low<=t.tp){result='WIN';exitIndex=j;break;}
    }
  }
  if(!result)return null;
  const grossR=result==='WIN'?t.tpR:-1;
  const netR=grossR-t.costR;
  return {...t,result,exitIndex,exitTime:c[exitIndex].time,grossR,rMultiple:netR,mfeR:maxFav/t.risk,maeR:maxAdv/t.risk,durationMin:(c[exitIndex].time-t.entryTime)/60000};
}
function runStrategy(name,c,signalFn,{startIndex=60,endIndex=c.length-2,tpR=1.8}={}){
  const trades=[];
  for(let i=Math.max(60,startIndex);i<=Math.min(endIndex,c.length-2);){
    const sig=signalFn(i);if(!sig){i++;continue;}
    const tr=makeTrade({c,i,...sig,tpR});if(!tr){i++;continue;}
    const done=simulate(c,tr,endIndex+1);if(!done){i++;continue;}
    trades.push(done);i=Math.max(i+1,done.exitIndex+1);
  }
  return summarize(name,trades,c,startIndex,endIndex,tpR);
}
function summarize(name,trades,c,startIndex,endIndex,tpR){
  const wins=trades.filter(t=>t.result==='WIN').length,losses=trades.length-wins;
  const grossWin=trades.filter(t=>t.rMultiple>0).reduce((a,t)=>a+t.rMultiple,0);
  const grossLoss=Math.abs(trades.filter(t=>t.rMultiple<0).reduce((a,t)=>a+t.rMultiple,0));
  const netR=trades.reduce((a,t)=>a+t.rMultiple,0);
  let eq=0,peak=0,maxDD=0,streak=0,worst=0;
  for(const t of trades){eq+=t.rMultiple;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);if(t.rMultiple<0){streak++;worst=Math.max(worst,streak);}else streak=0;}
  const bySide={BUY:{n:0,r:0,w:0},SELL:{n:0,r:0,w:0}};
  const bySession={LONDON:{n:0,r:0,w:0},NY:{n:0,r:0,w:0},OTHER:{n:0,r:0,w:0}};
  for(const t of trades){const bs=bySide[t.side];bs.n++;bs.r+=t.rMultiple;if(t.result==='WIN')bs.w++;const sn=sessionName(t.signalTime),ss=bySession[sn];ss.n++;ss.r+=t.rMultiple;if(t.result==='WIN')ss.w++;}
  for(const x of Object.values(bySide))x.wr=x.n?100*x.w/x.n:0;
  for(const x of Object.values(bySession))x.wr=x.n?100*x.w/x.n:0;
  const avg=x=>trades.length?trades.reduce((a,t)=>a+(Number(t[x])||0),0)/trades.length:0;
  return {name,tpR,trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length*100:0,netR,profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?999:0),expectancy:trades.length?netR/trades.length:0,maxDrawdownR:maxDD,worstLossStreak:worst,avgMfeR:avg('mfeR'),avgMaeR:avg('maeR'),avgDurationMin:avg('durationMin'),avgCostR:avg('costR'),bySide,bySession,from:c[Math.max(0,startIndex)]?.time,to:c[Math.min(c.length-1,endIndex)]?.time,details:trades};
}
function robustScore(r){
  if(r.trades<5)return -100 + r.trades;
  const pf=Math.min(3,Math.max(0,r.profitFactor));
  return r.netR*1.2 + r.expectancy*25 + Math.log10(Math.max(0.1,pf))*12 - r.maxDrawdownR*0.9 + Math.min(r.trades,150)/75;
}

(async()=>{
  console.log(`🏁 XAUUSD Regime Pullback Tournament V3 | target=${HISTORY} 5m bars`);
  console.log(`💸 Costs: spread=$${SPREAD_USD.toFixed(2)} + slippage=$${SLIPPAGE_USD.toFixed(2)} each side`);
  console.log('🧪 Split: 60% DEVELOPMENT / 20% VALIDATION / 20% FINAL HOLDOUT');
  console.log('🎛 Grid: sessions=LONDON,NY,BOTH | ADX=20,22,25,28 | chase=0.40,0.50,0.60 ATR | TP=1,1.5,2R');

  const c5raw = await getGoldHistoricalCandles('5min', HISTORY);
  await new Promise(r=>setTimeout(r,2500));
  const c15raw = await getGoldHistoricalCandles('15min', Math.min(40000, Math.ceil(HISTORY/3)+600));
  await new Promise(r=>setTimeout(r,2500));
  const c1hraw = await getGoldHistoricalCandles('1h', Math.min(12000, Math.ceil(HISTORY/12)+300));

  const c5=cloneRows(c5raw), c15=cloneRows(c15raw), c1h=cloneRows(c1hraw);
  if(c5.length<3000) throw new Error(`Not enough 5m history: ${c5.length}`);
  const i5=buildInd(c5), i15=buildInd(c15), i1h=buildInd(c1h);

  function htf(t){
    const signalClose=t+FIVE_MIN;
    const j15=alignClosedIndex(c15,signalClose,FIFTEEN_MIN);
    const j1=alignClosedIndex(c1h,signalClose,ONE_HOUR);
    return {
      j15,j1,
      trend15:j15>=0?(i15.ema20[j15]>i15.ema50[j15]?'BUY':i15.ema20[j15]<i15.ema50[j15]?'SELL':null):null,
      trend1h:j1>=0?(i1h.ema20[j1]>i1h.ema50[j1]?'BUY':i1h.ema20[j1]<i1h.ema50[j1]?'SELL':null):null,
      adx15:j15>=0?i15.adx14[j15]:null
    };
  }

  function sessionAllowed(t, mode){
    if(mode==='LONDON') return inLondon(t);
    if(mode==='NY') return inEarlyNY(t);
    if(mode==='BOTH') return inSessions(t);
    return false;
  }

  function makeRegimeSignal(cfg){
    return function regimeSignal(i){
      const t=c5[i].time;
      if(!sessionAllowed(t,cfg.session)) return null;
      const h=htf(t), a=i5.atr14[i];
      if(!a || !h.trend15 || h.trend15!==h.trend1h || !(h.adx15>=cfg.adxMin)) return null;
      const side=h.trend15;
      const v=i5.svwap[i]??i5.rvwap24[i];
      const e=i5.ema20[i];
      if(v==null || e==null) return null;

      // Use the nearest valid pullback anchor, not an arbitrary average.
      const distE=Math.abs(c5[i].close-e)/a;
      const distV=Math.abs(c5[i].close-v)/a;
      const minDist=Math.min(distE,distV);
      if(minDist>cfg.chaseAtr) return null;

      // Require the latest 4 closed 5m candles to actually interact with EMA20 or VWAP.
      const recent=c5.slice(Math.max(0,i-3),i+1);
      const tol=a*0.12;
      const touchedE=recent.some(x=>x.low<=e+tol && x.high>=e-tol);
      const touchedV=recent.some(x=>x.low<=v+tol && x.high>=v-tol);
      if(!touchedE && !touchedV) return null;

      // Confirmation candle must close with the regime and on the correct side of at least one anchor.
      if(!candleDir(c5,i,side)) return null;
      const anchorConfirmed=side==='BUY'?(c5[i].close>=e || c5[i].close>=v):(c5[i].close<=e || c5[i].close<=v);
      if(!anchorConfirmed) return null;

      // Momentum must return with the higher-timeframe regime.
      const mom=momentum(c5,i,3);
      if(mom.dir!==side || mom.strength<1) return null;

      // Avoid a large execution candle after the pullback.
      if(bodyAtr(c5,i,i5.atr14)>0.35) return null;

      return {
        side,
        atrValue:a,
        swingLookback:12,
        bufferAtr:0.15,
        tag:`REGIME_${cfg.session}_ADX${cfg.adxMin}_CHASE${cfg.chaseAtr}`
      };
    };
  }

  const start=60;
  const usable=(c5.length-2)-start+1;
  const devEnd=start+Math.floor(usable*0.60)-1;
  const valEnd=devEnd+Math.floor(usable*0.20);
  const finalEnd=c5.length-2;
  const DEV={start,end:devEnd};
  const VAL={start:devEnd+1,end:valEnd};
  const HOLD={start:valEnd+1,end:finalEnd};

  const sessions=['LONDON','NY','BOTH'];
  const adxValues=[20,22,25,28];
  const chaseValues=[0.40,0.50,0.60];
  const tpValues=[1,1.5,2];
  const configs=[];
  for(const session of sessions) for(const adxMin of adxValues) for(const chaseAtr of chaseValues) for(const tpR of tpValues){
    configs.push({session,adxMin,chaseAtr,tpR});
  }

  console.log(`🔬 Testing ${configs.length} configurations on DEVELOPMENT...`);
  const devResults=[];
  for(const cfg of configs){
    const fn=makeRegimeSignal(cfg);
    const r=runStrategy(`Regime ${cfg.session}`,c5,fn,{startIndex:DEV.start,endIndex:DEV.end,tpR:cfg.tpR});
    devResults.push({cfg,result:r,score:robustScore(r)});
  }

  // Keep only configurations with a meaningful development sample before validation.
  const devEligible=devResults.filter(x=>x.result.trades>=20).sort((a,b)=>b.score-a.score);
  const candidates=(devEligible.length?devEligible:devResults.sort((a,b)=>b.score-a.score)).slice(0,20);
  console.log(`🧭 Validating top ${candidates.length} development configurations...`);

  const validated=candidates.map(x=>{
    const fn=makeRegimeSignal(x.cfg);
    const vr=runStrategy(`Regime ${x.cfg.session}`,c5,fn,{startIndex:VAL.start,endIndex:VAL.end,tpR:x.cfg.tpR});
    // Selection uses validation only after parameters were generated and pre-ranked on DEV.
    // Penalize very tiny validation samples heavily.
    const vscore=robustScore(vr) - (vr.trades<12 ? (12-vr.trades)*3 : 0);
    return {...x,validation:vr,validationScore:vscore};
  }).sort((a,b)=>b.validationScore-a.validationScore);

  const winner=validated[0];
  if(!winner) throw new Error('No regime configuration produced a validation result');

  // FINAL HOLDOUT is touched exactly once for the selected winner.
  const winFn=makeRegimeSignal(winner.cfg);
  const holdout=runStrategy('Regime FINAL HOLDOUT',c5,winFn,{startIndex:HOLD.start,endIndex:HOLD.end,tpR:winner.cfg.tpR});
  const full=runStrategy('Regime FULL',c5,winFn,{startIndex:start,endIndex:finalEnd,tpR:winner.cfg.tpR});

  function compact(r){return {
    trades:r.trades,wins:r.wins,losses:r.losses,winRate:r.winRate,netR:r.netR,
    profitFactor:r.profitFactor,expectancy:r.expectancy,maxDrawdownR:r.maxDrawdownR,
    worstLossStreak:r.worstLossStreak,avgMfeR:r.avgMfeR,avgMaeR:r.avgMaeR,
    avgDurationMin:r.avgDurationMin,avgCostR:r.avgCostR,bySide:r.bySide,bySession:r.bySession,
    from:r.from,to:r.to,tpR:r.tpR
  };}

  const report={
    generatedAt:new Date().toISOString(),
    history:{m5:c5.length,m15:c15.length,h1:c1h.length},
    split:{development:DEV,validation:VAL,finalHoldout:HOLD},
    costs:{spreadUsd:SPREAD_USD,slippageUsd:SLIPPAGE_USD},
    grid:{sessions,adxValues,chaseValues,tpValues,totalConfigs:configs.length},
    selectedConfig:winner.cfg,
    development:compact(winner.result),
    validation:compact(winner.validation),
    finalHoldout:compact(holdout),
    full:compact(full),
    topValidation:validated.slice(0,10).map((x,idx)=>({rank:idx+1,cfg:x.cfg,dev:compact(x.result),validation:compact(x.validation),validationScore:x.validationScore})),
    notes:[
      'Only Regime Pullback variants are tested.',
      'Selection path is DEVELOPMENT -> VALIDATION. FINAL HOLDOUT is not used for tuning or ranking.',
      'Signals use closed 5m bars and enter at the next 5m open.',
      '15m/H1 trend uses only fully closed higher-timeframe candles.',
      'If SL and TP are touched in the same 5m candle, SL is counted first.',
      'Configured spread and entry/exit slippage are deducted in R.'
    ]
  };

  const jsonPath=path.join(OUT_DIR,'regime-v3-latest.json');
  fs.writeFileSync(jsonPath,JSON.stringify(report,null,2));
  const csvPath=path.join(OUT_DIR,'regime-v3-top-validation.csv');
  const header='rank,session,adx_min,chase_atr,tp_r,dev_trades,dev_net_r,dev_pf,val_trades,val_wr,val_net_r,val_pf,val_exp,val_dd\n';
  const lines=validated.slice(0,20).map((x,idx)=>[
    idx+1,x.cfg.session,x.cfg.adxMin,x.cfg.chaseAtr,x.cfg.tpR,
    x.result.trades,x.result.netR.toFixed(2),x.result.profitFactor.toFixed(3),
    x.validation.trades,x.validation.winRate.toFixed(2),x.validation.netR.toFixed(2),
    x.validation.profitFactor.toFixed(3),x.validation.expectancy.toFixed(3),x.validation.maxDrawdownR.toFixed(2)
  ].join(','));
  fs.writeFileSync(csvPath,header+lines.join('\n')+'\n');

  console.log(`\n📚 Loaded: 5m=${c5.length} | 15m=${c15.length} | 1h=${c1h.length}`);
  console.log(`🧪 DEV bars=${DEV.end-DEV.start+1} | 🧭 VALIDATION bars=${VAL.end-VAL.start+1} | 🔒 FINAL HOLDOUT bars=${HOLD.end-HOLD.start+1}`);
  console.log('\n🥇 SELECTED CONFIG (before final holdout)');
  console.log(winner.cfg);
  console.log(`DEV: trades=${winner.result.trades} | WR=${winner.result.winRate.toFixed(1)}% | Net=${winner.result.netR.toFixed(2)}R | PF=${winner.result.profitFactor.toFixed(2)} | DD=${winner.result.maxDrawdownR.toFixed(2)}R`);
  console.log(`VAL: trades=${winner.validation.trades} | WR=${winner.validation.winRate.toFixed(1)}% | Net=${winner.validation.netR.toFixed(2)}R | PF=${winner.validation.profitFactor.toFixed(2)} | Exp=${winner.validation.expectancy.toFixed(3)}R | DD=${winner.validation.maxDrawdownR.toFixed(2)}R`);
  console.log('\n🔒 FINAL HOLDOUT — UNSEEN DATA');
  console.log(`trades=${holdout.trades} | WR=${holdout.winRate.toFixed(1)}% | Net=${holdout.netR.toFixed(2)}R | PF=${holdout.profitFactor.toFixed(2)} | Exp=${holdout.expectancy.toFixed(3)}R | DD=${holdout.maxDrawdownR.toFixed(2)}R | MFE=${holdout.avgMfeR.toFixed(2)}R | MAE=${holdout.avgMaeR.toFixed(2)}R`);
  console.log('BUY ',holdout.bySide.BUY);
  console.log('SELL',holdout.bySide.SELL);
  console.log('LONDON',holdout.bySession.LONDON);
  console.log('NY    ',holdout.bySession.NY);
  console.log('\n🏆 TOP 10 VALIDATION CONFIGS');
  validated.slice(0,10).forEach((x,idx)=>console.log(`${idx+1}. ${x.cfg.session} | ADX>=${x.cfg.adxMin} | chase<=${x.cfg.chaseAtr}ATR | TP=${x.cfg.tpR}R | val trades=${x.validation.trades} | Net=${x.validation.netR.toFixed(2)}R | PF=${x.validation.profitFactor.toFixed(2)} | Exp=${x.validation.expectancy.toFixed(3)}R | DD=${x.validation.maxDrawdownR.toFixed(2)}R`));
  console.log(`\n📄 JSON: ${jsonPath}`);
  console.log(`📄 CSV : ${csvPath}`);
})().catch(err=>{console.error('❌ Regime Tournament V3 failed:',err);process.exitCode=1;});
