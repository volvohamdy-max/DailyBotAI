require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGoldHistoricalCandles } = require('../src/services/strategyHistory');

const HISTORY = Number(process.env.BACKTEST_HISTORY || 10000);
const OUT_DIR = path.resolve(process.cwd(), 'data', 'backtests');
fs.mkdirSync(OUT_DIR, { recursive: true });

function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function cloneRows(rows=[]){return rows.map(r=>({time:Number(r.time),open:n(r.open),high:n(r.high),low:n(r.low),close:n(r.close),volume:n(r.volume)||0})).filter(r=>[r.time,r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);}
function ema(values,p){const out=Array(values.length).fill(null);if(values.length<p)return out;let seed=0;for(let i=0;i<p;i++)seed+=values[i];let prev=seed/p;out[p-1]=prev;const k=2/(p+1);for(let i=p;i<values.length;i++){prev=values[i]*k+prev*(1-k);out[i]=prev;}return out;}
function rsi(values,p=14){const out=Array(values.length).fill(null);if(values.length<=p)return out;let g=0,l=0;for(let i=1;i<=p;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l+=Math.abs(d);}let ag=g/p,al=l/p;const calc=()=>al===0?100:100-100/(1+ag/al);out[p]=calc();for(let i=p+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?Math.abs(d):0))/p;out[i]=calc();}return out;}
function atr(c,p=14){const tr=Array(c.length).fill(null),out=Array(c.length).fill(null);for(let i=1;i<c.length;i++)tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));if(c.length<=p)return out;let sum=0;for(let i=1;i<=p;i++)sum+=tr[i];let prev=sum/p;out[p]=prev;for(let i=p+1;i<c.length;i++){prev=(prev*(p-1)+tr[i])/p;out[i]=prev;}return out;}
function adx(c,p=14){const len=c.length,pdm=Array(len).fill(0),mdm=Array(len).fill(0),tr=Array(len).fill(0),dx=Array(len).fill(null),out=Array(len).fill(null);for(let i=1;i<len;i++){const up=c[i].high-c[i-1].high,down=c[i-1].low-c[i].low;pdm[i]=up>down&&up>0?up:0;mdm[i]=down>up&&down>0?down:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));}if(len<=p*2)return out;let ts=0,ps=0,ms=0;for(let i=1;i<=p;i++){ts+=tr[i];ps+=pdm[i];ms+=mdm[i];}for(let i=p;i<len;i++){if(i>p){ts=ts-ts/p+tr[i];ps=ps-ps/p+pdm[i];ms=ms-ms/p+mdm[i];}if(!ts)continue;const plus=100*ps/ts,minus=100*ms/ts,sum=plus+minus;if(sum)dx[i]=100*Math.abs(plus-minus)/sum;}const first=p*2-1;let sum=0,count=0;for(let i=p;i<=first;i++){if(dx[i]!=null){sum+=dx[i];count++;}}if(!count)return out;let prev=sum/count;out[first]=prev;for(let i=first+1;i<len;i++){if(dx[i]==null)continue;prev=(prev*(p-1)+dx[i])/p;out[i]=prev;}return out;}
function macd(values,fast=12,slow=26,signal=9){const ef=ema(values,fast),es=ema(values,slow),line=values.map((_,i)=>ef[i]!=null&&es[i]!=null?ef[i]-es[i]:null);const clean=line.map(v=>v==null?0:v);const sig=ema(clean,signal);return {line,signal:sig.map((v,i)=>line[i]==null?null:v)};}
function rollingVWAP(c,lookback=24){const out=Array(c.length).fill(null);for(let i=0;i<c.length;i++){let pv=0,v=0;for(let j=Math.max(0,i-lookback+1);j<=i;j++){const vol=c[j].volume||0;if(vol>0){pv+=((c[j].high+c[j].low+c[j].close)/3)*vol;v+=vol;}}out[i]=v>0?pv/v:null;}return out;}
function sessionVWAP(c){const out=Array(c.length).fill(null);let day='',pv=0,v=0;for(let i=0;i<c.length;i++){const d=new Date(c[i].time).toISOString().slice(0,10);if(d!==day){day=d;pv=0;v=0;}const vol=c[i].volume||0;if(vol>0){pv+=((c[i].high+c[i].low+c[i].close)/3)*vol;v+=vol;}out[i]=v>0?pv/v:null;}return out;}
function momentum(c,i,lookback=3){if(i<lookback)return {dir:null,strength:0,impulse:0};let impulse=0,strength=0;for(let j=i-lookback+1;j<=i;j++){const d=c[j].close-c[j].open;impulse+=d;if(d>0)strength++;else if(d<0)strength--;}return {dir:impulse>0?'BUY':impulse<0?'SELL':null,strength:Math.abs(strength),impulse};}
function bodyAtr(c,i,a){if(!a[i])return 0;return Math.abs(c[i].close-c[i].open)/a[i];}
function candleDir(c,i,side){return side==='BUY'?c[i].close>c[i].open:c[i].close<c[i].open;}
function range(c,i,lookback=12){if(i<lookback)return null;const rows=c.slice(i-lookback,i);return {high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low))};}
function alignIndex(htf,t){let lo=0,hi=htf.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(htf[m].time<=t){ans=m;lo=m+1;}else hi=m-1;}return ans;}
function hourUTC(t){return new Date(t).getUTCHours()+new Date(t).getUTCMinutes()/60;}
function inLondon(t){const h=hourUTC(t);return h>=7&&h<11;}
function inEarlyNY(t){const h=hourUTC(t);return h>=13.5&&h<17;}
function inSessions(t){return inLondon(t)||inEarlyNY(t);}

function buildInd(c){const closes=c.map(x=>x.close);return {ema9:ema(closes,9),ema20:ema(closes,20),ema50:ema(closes,50),ema200:ema(closes,200),rsi14:rsi(closes,14),atr14:atr(c,14),adx14:adx(c,14),macd:macd(closes),rvwap24:rollingVWAP(c,24),svwap:sessionVWAP(c)};}

function makeTrade({c,i,side,atrValue,slR=1,tpR=1.8,swingLookback=8,bufferAtr=0.12,tag}){
  const entryIndex=i+1;if(entryIndex>=c.length)return null;const entry=c[entryIndex].open;const rows=c.slice(Math.max(0,i-swingLookback+1),i+1);const swing=side==='BUY'?Math.min(...rows.map(x=>x.low)):Math.max(...rows.map(x=>x.high));const rawRisk=side==='BUY'?entry-(swing-atrValue*bufferAtr):(swing+atrValue*bufferAtr)-entry;const minRisk=atrValue*0.55;const risk=Math.max(rawRisk,minRisk);if(!(risk>0))return null;const sl=side==='BUY'?entry-risk:entry+risk;const tp=side==='BUY'?entry+risk*tpR:entry-risk*tpR;return {side,entryIndex,entry,sl,tp,risk,tpR,tag,signalTime:c[i].time};}
function simulate(c,t){let exitIndex=null,result=null;for(let j=t.entryIndex;j<c.length;j++){const b=c[j];if(t.side==='BUY'){if(b.low<=t.sl){result='LOSS';exitIndex=j;break;}if(b.high>=t.tp){result='WIN';exitIndex=j;break;}}else{if(b.high>=t.sl){result='LOSS';exitIndex=j;break;}if(b.low<=t.tp){result='WIN';exitIndex=j;break;}}}if(!result)return null;return {...t,result,exitIndex,exitTime:c[exitIndex].time,rMultiple:result==='WIN'?t.tpR:-1};}
function runStrategy(name,c,signalFn){const trades=[];for(let i=60;i<c.length-2;){const sig=signalFn(i);if(!sig){i++;continue;}const tr=makeTrade({c,i,...sig});if(!tr){i++;continue;}const done=simulate(c,tr);if(!done)break;trades.push(done);i=Math.max(i+1,done.exitIndex+1);}return summarize(name,trades,c);}
function summarize(name,trades,c){const wins=trades.filter(t=>t.result==='WIN').length;const losses=trades.length-wins;const grossWin=trades.filter(t=>t.rMultiple>0).reduce((a,t)=>a+t.rMultiple,0);const grossLoss=Math.abs(trades.filter(t=>t.rMultiple<0).reduce((a,t)=>a+t.rMultiple,0));const netR=trades.reduce((a,t)=>a+t.rMultiple,0);let eq=0,peak=0,maxDD=0,streak=0,worst=0;for(const t of trades){eq+=t.rMultiple;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);if(t.rMultiple<0){streak++;worst=Math.max(worst,streak);}else streak=0;}const bySide={BUY:{n:0,r:0},SELL:{n:0,r:0}};const bySession={LONDON:{n:0,r:0},NY:{n:0,r:0},OTHER:{n:0,r:0}};for(const t of trades){bySide[t.side].n++;bySide[t.side].r+=t.rMultiple;const s=inLondon(t.signalTime)?'LONDON':inEarlyNY(t.signalTime)?'NY':'OTHER';bySession[s].n++;bySession[s].r+=t.rMultiple;}return {name,trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length*100:0,netR,profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?999:0),expectancy:trades.length?netR/trades.length:0,maxDrawdownR:maxDD,worstLossStreak:worst,bySide,bySession,from:c[0]?.time,to:c.at(-1)?.time,details:trades};}

(async()=>{
  console.log(`🏁 XAUUSD Backtest Tournament | target=${HISTORY} 5m bars`);
  const [c5raw,c15raw,c1hraw]=await Promise.all([
    getGoldHistoricalCandles('5min',HISTORY),
    getGoldHistoricalCandles('15min',Math.min(10000,Math.ceil(HISTORY/3)+300)),
    getGoldHistoricalCandles('1h',Math.min(5000,Math.ceil(HISTORY/12)+200))
  ]);
  const c5=cloneRows(c5raw),c15=cloneRows(c15raw),c1h=cloneRows(c1hraw);
  const i5=buildInd(c5),i15=buildInd(c15),i1h=buildInd(c1h);

  function htf(t){const j15=alignIndex(c15,t),j1=alignIndex(c1h,t);return {j15,j1,trend15:j15>=0?(i15.ema20[j15]>i15.ema50[j15]?'BUY':i15.ema20[j15]<i15.ema50[j15]?'SELL':null):null,trend1h:j1>=0?(i1h.ema20[j1]>i1h.ema50[j1]?'BUY':i1h.ema20[j1]<i1h.ema50[j1]?'SELL':null):null,adx15:j15>=0?i15.adx14[j15]:null};}

  const results=[];

  // A — current Scalper V3 approximation from live gates, evaluated on closed 5m bars.
  results.push(runStrategy('A Scalper V3',c5,(i)=>{const h=htf(c5[i].time);const side=h.trend15;if(!side||i5.atr14[i]==null||i5.adx14[i]<24)return null;const emaAligned=side==='BUY'?i5.ema9[i]>i5.ema20[i]:i5.ema9[i]<i5.ema20[i];if(!emaAligned)return null;const vw=i5.rvwap24[i];if(vw==null)return null;const dist=Math.abs(c5[i].close-vw)/i5.atr14[i];const vwAligned=side==='BUY'?c5[i].close>=vw-i5.atr14[i]*0.08:c5[i].close<=vw+i5.atr14[i]*0.08;if(!vwAligned||dist>0.85)return null;const mom=momentum(c5,i,3);if(mom.dir!==side||mom.strength<2)return null;const rr=i5.rsi14[i];if(rr==null||!(side==='BUY'?rr>=46&&rr<=72:rr>=28&&rr<=54))return null;const recent=c5.slice(Math.max(0,i-2),i+1);const zlo=Math.min(i5.ema9[i],i5.ema20[i])-i5.atr14[i]*0.18,zhi=Math.max(i5.ema9[i],i5.ema20[i])+i5.atr14[i]*0.18;const touched=recent.some(x=>x.high>=zlo&&x.low<=zhi);const reclaimed=side==='BUY'?c5[i].close>=i5.ema9[i]&&c5[i].close>=i5.ema20[i]:c5[i].close<=i5.ema9[i]&&c5[i].close<=i5.ema20[i];const pullback=touched&&reclaimed&&candleDir(c5,i,side);const rg=range(c5,i,12);const breakout=rg&&(side==='BUY'?c5[i].close>rg.high&&c5[i].close-rg.high<=i5.atr14[i]*0.35:c5[i].close<rg.low&&rg.low-c5[i].close<=i5.atr14[i]*0.35);if(!pullback&&!breakout)return null;if(bodyAtr(c5,i,i5.atr14)>0.40)return null;return {side,atrValue:i5.atr14[i],tpR:1.8,swingLookback:8,bufferAtr:0.12,tag:pullback?'PULLBACK':'BREAKOUT'};}));

  // B — Liquidity sweep + structure shift + VWAP, all sessions.
  function liquiditySignal(i,sessionOnly=false){if(sessionOnly&&!inSessions(c5[i].time))return null;const a=i5.atr14[i];if(!a||i<25)return null;const prev=c5.slice(i-20,i);const prevHigh=Math.max(...prev.map(x=>x.high)),prevLow=Math.min(...prev.map(x=>x.low));const bullSweep=c5[i].low<prevLow&&c5[i].close>prevLow;const bearSweep=c5[i].high>prevHigh&&c5[i].close<prevHigh;let side=bullSweep?'BUY':bearSweep?'SELL':null;if(!side)return null;const mom=momentum(c5,i,3);const v=i5.svwap[i]??i5.rvwap24[i];if(v==null)return null;const structure=side==='BUY'?c5[i].close>c5[i-1].high:c5[i].close<c5[i-1].low;const vwapOk=side==='BUY'?c5[i].close>=v:c5[i].close<=v;if(!structure||!vwapOk||mom.dir!==side)return null;if(bodyAtr(c5,i,i5.atr14)>0.80)return null;return {side,atrValue:a,tpR:2,swingLookback:12,bufferAtr:0.10,tag:'LIQ_SWEEP'};}
  results.push(runStrategy('B Liquidity Sweep + VWAP',c5,(i)=>liquiditySignal(i,false)));
  results.push(runStrategy('F Liquidity Sweep + London/NY',c5,(i)=>liquiditySignal(i,true)));

  // C — NY opening range breakout: first 30m range 13:30-14:00 UTC, breakout after 14:00 until 16:30 UTC.
  function orbSignal(i,strict=false){const d=new Date(c5[i].time),h=d.getUTCHours()+d.getUTCMinutes()/60;if(h<14||h>=16.5)return null;const day=d.toISOString().slice(0,10);const bars=[];for(let j=i-1;j>=0;j--){const dj=new Date(c5[j].time);if(dj.toISOString().slice(0,10)!==day)break;const hj=dj.getUTCHours()+dj.getUTCMinutes()/60;if(hj>=13.5&&hj<14)bars.push(c5[j]);}if(bars.length<4)return null;const hi=Math.max(...bars.map(x=>x.high)),lo=Math.min(...bars.map(x=>x.low)),a=i5.atr14[i];if(!a)return null;const side=c5[i].close>hi?'BUY':c5[i].close<lo?'SELL':null;if(!side)return null;const body=bodyAtr(c5,i,i5.atr14),bodyShare=Math.abs(c5[i].close-c5[i].open)/Math.max(1e-9,c5[i].high-c5[i].low);if(body<(strict?1.0:0.8)||bodyShare<(strict?0.70:0.60))return null;const vavg=c5.slice(Math.max(0,i-20),i).reduce((a,x)=>a+(x.volume||0),0)/Math.min(20,i);if(vavg>0&&c5[i].volume<(strict?1.35:1.15)*vavg)return null;return {side,atrValue:a,tpR:strict?2.2:2,swingLookback:6,bufferAtr:0.08,tag:strict?'NY_ORB_STRICT':'NY_ORB'};}
  results.push(runStrategy('C NY Opening Range Breakout',c5,(i)=>orbSignal(i,false)));
  results.push(runStrategy('G NY ORB Conservative',c5,(i)=>orbSignal(i,true)));

  // D — EMA50/200 + MACD + RSI on 5m (1m execution unavailable from current historical loader).
  results.push(runStrategy('D EMA50/200 + MACD + RSI (5m)',c5,(i)=>{const a=i5.atr14[i];if(!a||i5.ema50[i]==null||i5.ema200[i]==null)return null;let side=i5.ema50[i]>i5.ema200[i]?'BUY':i5.ema50[i]<i5.ema200[i]?'SELL':null;if(!side)return null;const m=i5.macd;if(m.line[i]==null||m.signal[i]==null)return null;const macdOk=side==='BUY'?m.line[i]>m.signal[i]:m.line[i]<m.signal[i];const rr=i5.rsi14[i];const rsiOk=side==='BUY'?rr>=50&&rr<=70:rr<=50&&rr>=30;if(!macdOk||!rsiOk||!candleDir(c5,i,side))return null;return {side,atrValue:a,tpR:1.5,swingLookback:8,bufferAtr:0.10,tag:'EMA_MACD_RSI'};}));

  // E — Regime Pullback: H1 + 15m aligned, ADX15 >=23, 5m pullback EMA20/VWAP + rejection + momentum, no chase.
  results.push(runStrategy('E Regime Pullback',c5,(i)=>{const h=htf(c5[i].time),a=i5.atr14[i];if(!a||!h.trend15||h.trend15!==h.trend1h||!(h.adx15>=23))return null;const side=h.trend15;const v=i5.svwap[i]??i5.rvwap24[i];if(v==null||i5.ema20[i]==null)return null;const anchor=side==='BUY'?Math.max(i5.ema20[i],v):Math.min(i5.ema20[i],v);const dist=Math.abs(c5[i].close-anchor)/a;if(dist>0.55)return null;const recent=c5.slice(Math.max(0,i-3),i+1);const touch=recent.some(x=>x.low<=i5.ema20[i]+a*0.12&&x.high>=i5.ema20[i]-a*0.12)||recent.some(x=>x.low<=v+a*0.12&&x.high>=v-a*0.12);if(!touch||!candleDir(c5,i,side))return null;const mom=momentum(c5,i,3);if(mom.dir!==side)return null;if(bodyAtr(c5,i,i5.atr14)>0.35)return null;return {side,atrValue:a,tpR:2,swingLookback:12,bufferAtr:0.15,tag:'REGIME_PULLBACK'};}));

  const ranked=[...results].sort((a,b)=>{
    const score=x=>x.netR*1.5 + x.expectancy*20 + Math.log10(Math.max(1,x.profitFactor))*10 - x.maxDrawdownR*0.7 + Math.min(x.trades,100)/100;
    return score(b)-score(a);
  });

  const report={generatedAt:new Date().toISOString(),history5m:c5.length,history15m:c15.length,history1h:c1h.length,notes:['All strategies evaluated candle-by-candle on closed 5m bars; entry at next bar open.','If SL and TP occur in same bar, SL is counted first (conservative).','Strategy D uses 5m execution because current history loader has no 1m support.','London/NY session times use UTC approximations suitable for current DST period; validate across DST if extending much further back.'],results:ranked.map(({details,...r})=>r)};
  const jsonPath=path.join(OUT_DIR,'tournament-latest.json');fs.writeFileSync(jsonPath,JSON.stringify(report,null,2));
  const csvPath=path.join(OUT_DIR,'tournament-latest.csv');const header='rank,strategy,trades,wins,losses,win_rate,net_r,profit_factor,expectancy,max_dd_r,worst_loss_streak\n';const lines=ranked.map((r,idx)=>[idx+1,JSON.stringify(r.name),r.trades,r.wins,r.losses,r.winRate.toFixed(2),r.netR.toFixed(2),r.profitFactor.toFixed(3),r.expectancy.toFixed(3),r.maxDrawdownR.toFixed(2),r.worstLossStreak].join(','));fs.writeFileSync(csvPath,header+lines.join('\n')+'\n');

  console.log('\n🏆 TOURNAMENT RANKING');
  ranked.forEach((r,idx)=>console.log(`${idx+1}. ${r.name} | trades=${r.trades} | WR=${r.winRate.toFixed(1)}% | Net=${r.netR.toFixed(2)}R | PF=${r.profitFactor.toFixed(2)} | Exp=${r.expectancy.toFixed(3)}R | DD=${r.maxDrawdownR.toFixed(2)}R`));
  console.log(`\n📄 JSON: ${jsonPath}`);console.log(`📄 CSV : ${csvPath}`);
})();
