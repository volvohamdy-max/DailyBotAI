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
  console.log(`🏁 XAUUSD Backtest Tournament V2.1 | target=${HISTORY} 5m bars | dev=${Math.round(DEV_RATIO*100)}% | OOS=${Math.round((1-DEV_RATIO)*100)}%`);
  console.log(`💸 Costs: spread=$${SPREAD_USD.toFixed(2)} + slippage=$${SLIPPAGE_USD.toFixed(2)} each side | TP profiles=${TP_PROFILES.join('/')}`);
  console.log('📥 Sequential history loading enabled to protect Sifting rate limits');
  const c5raw = await getGoldHistoricalCandles('5min', HISTORY);
  await new Promise(r => setTimeout(r, 2500));
  const c15raw = await getGoldHistoricalCandles('15min', Math.min(40000, Math.ceil(HISTORY/3)+600));
  await new Promise(r => setTimeout(r, 2500));
  const c1hraw = await getGoldHistoricalCandles('1h', Math.min(12000, Math.ceil(HISTORY/12)+300));
  const c5=cloneRows(c5raw),c15=cloneRows(c15raw),c1h=cloneRows(c1hraw);
  if(c5.length<1000)throw new Error(`Not enough 5m history: ${c5.length}`);
  const i5=buildInd(c5),i15=buildInd(c15),i1h=buildInd(c1h);

  function htf(t){
    const signalClose=t+FIVE_MIN;
    const j15=alignClosedIndex(c15,signalClose,FIFTEEN_MIN),j1=alignClosedIndex(c1h,signalClose,ONE_HOUR);
    return {j15,j1,trend15:j15>=0?(i15.ema20[j15]>i15.ema50[j15]?'BUY':i15.ema20[j15]<i15.ema50[j15]?'SELL':null):null,trend1h:j1>=0?(i1h.ema20[j1]>i1h.ema50[j1]?'BUY':i1h.ema20[j1]<i1h.ema50[j1]?'SELL':null):null,adx15:j15>=0?i15.adx14[j15]:null};
  }

  function scalperV3(i){const h=htf(c5[i].time),side=h.trend15;if(!side||i5.atr14[i]==null||i5.adx14[i]<24)return null;const emaAligned=side==='BUY'?i5.ema9[i]>i5.ema20[i]:i5.ema9[i]<i5.ema20[i];if(!emaAligned)return null;const vw=i5.rvwap24[i];if(vw==null)return null;const dist=Math.abs(c5[i].close-vw)/i5.atr14[i];const vwAligned=side==='BUY'?c5[i].close>=vw-i5.atr14[i]*0.08:c5[i].close<=vw+i5.atr14[i]*0.08;if(!vwAligned||dist>0.85)return null;const mom=momentum(c5,i,3);if(mom.dir!==side||mom.strength<2)return null;const rr=i5.rsi14[i];if(rr==null||!(side==='BUY'?rr>=46&&rr<=72:rr>=28&&rr<=54))return null;const recent=c5.slice(Math.max(0,i-2),i+1),zlo=Math.min(i5.ema9[i],i5.ema20[i])-i5.atr14[i]*0.18,zhi=Math.max(i5.ema9[i],i5.ema20[i])+i5.atr14[i]*0.18;const touched=recent.some(x=>x.high>=zlo&&x.low<=zhi);const reclaimed=side==='BUY'?c5[i].close>=i5.ema9[i]&&c5[i].close>=i5.ema20[i]:c5[i].close<=i5.ema9[i]&&c5[i].close<=i5.ema20[i];const pullback=touched&&reclaimed&&candleDir(c5,i,side);const rg=range(c5,i,12);const breakout=rg&&(side==='BUY'?c5[i].close>rg.high&&c5[i].close-rg.high<=i5.atr14[i]*0.35:c5[i].close<rg.low&&rg.low-c5[i].close<=i5.atr14[i]*0.35);if(!pullback&&!breakout)return null;if(bodyAtr(c5,i,i5.atr14)>0.40)return null;return {side,atrValue:i5.atr14[i],swingLookback:8,bufferAtr:0.12,tag:pullback?'PULLBACK':'BREAKOUT'};}

  function liquiditySignal(i,{sessionOnly=false,requireVwap=true}={}){if(sessionOnly&&!inSessions(c5[i].time))return null;const a=i5.atr14[i];if(!a||i<25)return null;const prev=c5.slice(i-20,i),prevHigh=Math.max(...prev.map(x=>x.high)),prevLow=Math.min(...prev.map(x=>x.low));const bullSweep=c5[i].low<prevLow&&c5[i].close>prevLow,bearSweep=c5[i].high>prevHigh&&c5[i].close<prevHigh;const side=bullSweep?'BUY':bearSweep?'SELL':null;if(!side)return null;const mom=momentum(c5,i,3),v=i5.svwap[i]??i5.rvwap24[i];const structure=side==='BUY'?c5[i].close>c5[i-1].high:c5[i].close<c5[i-1].low;if(!structure||mom.dir!==side)return null;if(requireVwap){if(v==null)return null;const vwapOk=side==='BUY'?c5[i].close>=v:c5[i].close<=v;if(!vwapOk)return null;}if(bodyAtr(c5,i,i5.atr14)>0.80)return null;return {side,atrValue:a,swingLookback:12,bufferAtr:0.10,tag:requireVwap?'LIQ_SWEEP_VWAP':'LIQ_SWEEP_MSS'};}

  function nyOrbRange(i){
    const now=tzParts(c5[i].time,'America/New_York');const m=now.hour*60+now.minute;if(m<10*60||m>=12*60)return null;
    const bars=[];for(let j=i-1;j>=0;j--){const p=tzParts(c5[j].time,'America/New_York');if(p.key!==now.key)break;const mm=p.hour*60+p.minute;if(mm>=9*60+30&&mm<10*60)bars.push(c5[j]);}
    if(bars.length<5)return null;return {hi:Math.max(...bars.map(x=>x.high)),lo:Math.min(...bars.map(x=>x.low))};
  }
  function orbSignal(i,strict=false){const rg=nyOrbRange(i),a=i5.atr14[i];if(!rg||!a)return null;const side=c5[i].close>rg.hi?'BUY':c5[i].close<rg.lo?'SELL':null;if(!side)return null;const body=bodyAtr(c5,i,i5.atr14),share=bodyShare(c5,i);if(body<(strict?1.0:0.8)||share<(strict?0.70:0.60))return null;const vavg=c5.slice(Math.max(0,i-20),i).reduce((x,b)=>x+(b.volume||0),0)/Math.min(20,i);if(vavg>0&&c5[i].volume<(strict?1.35:1.15)*vavg)return null;return {side,atrValue:a,swingLookback:6,bufferAtr:0.08,tag:strict?'NY_ORB_STRICT':'NY_ORB'};}
  function orbRetest(i){const rg=nyOrbRange(i),a=i5.atr14[i];if(!rg||!a||i<3)return null;const tol=a*0.12;const prev=c5[i-1];let side=null;if(prev.close>rg.hi&&c5[i].low<=rg.hi+tol&&c5[i].close>rg.hi&&candleDir(c5,i,'BUY'))side='BUY';if(prev.close<rg.lo&&c5[i].high>=rg.lo-tol&&c5[i].close<rg.lo&&candleDir(c5,i,'SELL'))side='SELL';if(!side)return null;if(bodyAtr(c5,i,i5.atr14)>0.55)return null;const mom=momentum(c5,i,2);if(mom.dir!==side)return null;return {side,atrValue:a,swingLookback:6,bufferAtr:0.10,tag:'NY_ORB_RETEST'};}

  function emaMacdRsi(i){const a=i5.atr14[i];if(!a||i5.ema50[i]==null||i5.ema200[i]==null)return null;const side=i5.ema50[i]>i5.ema200[i]?'BUY':i5.ema50[i]<i5.ema200[i]?'SELL':null;if(!side)return null;const m=i5.macd;if(m.line[i]==null||m.signal[i]==null)return null;const macdOk=side==='BUY'?m.line[i]>m.signal[i]:m.line[i]<m.signal[i],rr=i5.rsi14[i],rsiOk=side==='BUY'?rr>=50&&rr<=70:rr<=50&&rr>=30;if(!macdOk||!rsiOk||!candleDir(c5,i,side))return null;return {side,atrValue:a,swingLookback:8,bufferAtr:0.10,tag:'EMA_MACD_RSI'};}
  function regimePullback(i){const h=htf(c5[i].time),a=i5.atr14[i];if(!a||!h.trend15||h.trend15!==h.trend1h||!(h.adx15>=23))return null;const side=h.trend15,v=i5.svwap[i]??i5.rvwap24[i];if(v==null||i5.ema20[i]==null)return null;const anchor=side==='BUY'?Math.max(i5.ema20[i],v):Math.min(i5.ema20[i],v),dist=Math.abs(c5[i].close-anchor)/a;if(dist>0.55)return null;const recent=c5.slice(Math.max(0,i-3),i+1);const touch=recent.some(x=>x.low<=i5.ema20[i]+a*0.12&&x.high>=i5.ema20[i]-a*0.12)||recent.some(x=>x.low<=v+a*0.12&&x.high>=v-a*0.12);if(!touch||!candleDir(c5,i,side))return null;const mom=momentum(c5,i,3);if(mom.dir!==side||bodyAtr(c5,i,i5.atr14)>0.35)return null;return {side,atrValue:a,swingLookback:12,bufferAtr:0.15,tag:'REGIME_PULLBACK'};}

  const strategies=[
    {id:'A',name:'Scalper V3',fn:scalperV3},
    {id:'B',name:'Liquidity Sweep + VWAP',fn:i=>liquiditySignal(i,{sessionOnly:false,requireVwap:true})},
    {id:'C',name:'NY Opening Range Breakout',fn:i=>orbSignal(i,false)},
    {id:'D',name:'EMA50/200 + MACD + RSI (5m)',fn:emaMacdRsi},
    {id:'E',name:'Regime Pullback',fn:regimePullback},
    {id:'F',name:'Liquidity Sweep + London/NY',fn:i=>liquiditySignal(i,{sessionOnly:true,requireVwap:true})},
    {id:'G',name:'NY ORB Conservative',fn:i=>orbSignal(i,true)},
    {id:'H',name:'Liquidity Sweep + MSS (no VWAP)',fn:i=>liquiditySignal(i,{sessionOnly:false,requireVwap:false})},
    {id:'I',name:'NY Opening Range Retest',fn:orbRetest}
  ];

  const splitIndex=Math.max(200,Math.floor(c5.length*DEV_RATIO));
  const dev={start:60,end:splitIndex-1};
  const oos={start:splitIndex,end:c5.length-2};
  const allResults=[];

  for(const s of strategies){
    const devProfiles=TP_PROFILES.map(tp=>runStrategy(`${s.id} ${s.name}`,c5,s.fn,{startIndex:dev.start,endIndex:dev.end,tpR:tp}));
    devProfiles.sort((a,b)=>robustScore(b)-robustScore(a));
    const chosen=devProfiles[0];
    const test=runStrategy(`${s.id} ${s.name}`,c5,s.fn,{startIndex:oos.start,endIndex:oos.end,tpR:chosen.tpR});
    const full=runStrategy(`${s.id} ${s.name}`,c5,s.fn,{startIndex:60,endIndex:c5.length-2,tpR:chosen.tpR});
    allResults.push({id:s.id,name:s.name,chosenTpR:chosen.tpR,development:chosen,outOfSample:test,full,devProfiles:devProfiles.map(({details,...x})=>x)});
  }

  const ranked=[...allResults].sort((a,b)=>robustScore(b.outOfSample)-robustScore(a.outOfSample));
  const compact=r=>({trades:r.trades,wins:r.wins,losses:r.losses,winRate:r.winRate,netR:r.netR,profitFactor:r.profitFactor,expectancy:r.expectancy,maxDrawdownR:r.maxDrawdownR,worstLossStreak:r.worstLossStreak,avgMfeR:r.avgMfeR,avgMaeR:r.avgMaeR,avgDurationMin:r.avgDurationMin,avgCostR:r.avgCostR,bySide:r.bySide,bySession:r.bySession,from:r.from,to:r.to,tpR:r.tpR});
  const report={
    generatedAt:new Date().toISOString(),history:{m5:c5.length,m15:c15.length,h1:c1h.length},settings:{requestedHistory:HISTORY,devRatio:DEV_RATIO,spreadUsd:SPREAD_USD,slippageUsd:SLIPPAGE_USD,tpProfiles:TP_PROFILES},
    notes:[
      'Signals use only closed 5m bars; entry is at next 5m bar open.',
      '15m/H1 regime uses only higher-timeframe candles that were fully closed by the 5m signal close (look-ahead guard).',
      'If SL and TP occur in the same candle, SL is counted first (conservative).',
      'Transaction cost is modeled as configured spread plus slippage on entry and exit, converted to R per trade.',
      'Each strategy chooses TP profile on development data only, then uses the same TP on the final 30% out-of-sample period.',
      'London/New York sessions use timezone-aware DST conversion.',
      'Strategy D remains 5m execution because the current project history loader does not expose 1m candles.'
    ],
    ranking:ranked.map((x,idx)=>({rank:idx+1,id:x.id,name:x.name,chosenTpR:x.chosenTpR,development:compact(x.development),outOfSample:compact(x.outOfSample),full:compact(x.full)}))
  };

  const jsonPath=path.join(OUT_DIR,'tournament-v21-latest.json');fs.writeFileSync(jsonPath,JSON.stringify(report,null,2));
  const csvPath=path.join(OUT_DIR,'tournament-v21-latest.csv');
  const header='rank,id,strategy,tp_r,oos_trades,oos_wr,oos_net_r,oos_pf,oos_exp,oos_dd,oos_mfe,oos_mae,full_trades,full_net_r,dev_trades,dev_net_r\n';
  const lines=ranked.map((x,idx)=>[idx+1,x.id,JSON.stringify(x.name),x.chosenTpR,x.outOfSample.trades,x.outOfSample.winRate.toFixed(2),x.outOfSample.netR.toFixed(2),x.outOfSample.profitFactor.toFixed(3),x.outOfSample.expectancy.toFixed(3),x.outOfSample.maxDrawdownR.toFixed(2),x.outOfSample.avgMfeR.toFixed(3),x.outOfSample.avgMaeR.toFixed(3),x.full.trades,x.full.netR.toFixed(2),x.development.trades,x.development.netR.toFixed(2)].join(','));
  fs.writeFileSync(csvPath,header+lines.join('\n')+'\n');

  console.log(`\n📚 Loaded: 5m=${c5.length} | 15m=${c15.length} | 1h=${c1h.length}`);
  console.log(`🧪 Development bars=${dev.end-dev.start+1} | 🔒 OOS bars=${oos.end-oos.start+1}`);
  console.log('\n🏆 OUT-OF-SAMPLE RANKING');
  ranked.forEach((x,idx)=>{const r=x.outOfSample;console.log(`${idx+1}. ${x.id} ${x.name} | TP=${x.chosenTpR}R | trades=${r.trades} | WR=${r.winRate.toFixed(1)}% | Net=${r.netR.toFixed(2)}R | PF=${r.profitFactor.toFixed(2)} | Exp=${r.expectancy.toFixed(3)}R | DD=${r.maxDrawdownR.toFixed(2)}R | MFE=${r.avgMfeR.toFixed(2)}R | MAE=${r.avgMaeR.toFixed(2)}R`);});
  console.log('\n🧭 TOP-3 SESSION / SIDE BREAKDOWN');
  ranked.slice(0,3).forEach(x=>{const r=x.outOfSample;console.log(`\n${x.id} ${x.name} | TP=${x.chosenTpR}R`);console.log('  BUY ',r.bySide.BUY);console.log('  SELL',r.bySide.SELL);console.log('  LONDON',r.bySession.LONDON);console.log('  NY    ',r.bySession.NY);console.log('  OTHER ',r.bySession.OTHER);});
  console.log(`\n📄 JSON: ${jsonPath}`);console.log(`📄 CSV : ${csvPath}`);
})().catch(err=>{console.error('❌ Tournament V2 failed:',err);process.exitCode=1;});
