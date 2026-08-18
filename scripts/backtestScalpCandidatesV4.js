require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getGoldHistoricalCandles } = require('./backtestHistoryV21');

const HISTORY = Math.max(10000, Math.min(60000, Number(process.env.BACKTEST_HISTORY || 50000)));
const SPREAD = Math.max(0, Number(process.env.BACKTEST_SPREAD_USD || 0.35));
const SLIP = Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_USD || 0.05));
const OUT = path.resolve(process.cwd(), 'data', 'backtests');
fs.mkdirSync(OUT, { recursive: true });

const FIVE=300000, FIFTEEN=900000, HOUR=3600000;
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
function rows(x=[]){return x.map(r=>({time:Number(r.time),open:n(r.open),high:n(r.high),low:n(r.low),close:n(r.close),volume:n(r.volume)||0})).filter(r=>[r.time,r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time)}
function ema(v,p){const o=Array(v.length).fill(null);if(v.length<p)return o;let s=0;for(let i=0;i<p;i++)s+=v[i];let q=s/p;o[p-1]=q;const k=2/(p+1);for(let i=p;i<v.length;i++){q=v[i]*k+q*(1-k);o[i]=q}return o}
function rsi(v,p=14){const o=Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];d>=0?g+=d:l+=-d}let ag=g/p,al=l/p;const f=()=>al===0?100:100-100/(1+ag/al);o[p]=f();for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;o[i]=f()}return o}
function atr(c,p=14){const tr=Array(c.length).fill(null),o=Array(c.length).fill(null);for(let i=1;i<c.length;i++)tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));if(c.length<=p)return o;let s=0;for(let i=1;i<=p;i++)s+=tr[i];let q=s/p;o[p]=q;for(let i=p+1;i<c.length;i++){q=(q*(p-1)+tr[i])/p;o[i]=q}return o}
function adx(c,p=14){const L=c.length,pd=Array(L).fill(0),md=Array(L).fill(0),tr=Array(L).fill(0),dx=Array(L).fill(null),o=Array(L).fill(null);for(let i=1;i<L;i++){const up=c[i].high-c[i-1].high,dn=c[i-1].low-c[i].low;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}if(L<=p*2)return o;let ts=0,ps=0,ms=0;for(let i=1;i<=p;i++){ts+=tr[i];ps+=pd[i];ms+=md[i]}for(let i=p;i<L;i++){if(i>p){ts=ts-ts/p+tr[i];ps=ps-ps/p+pd[i];ms=ms-ms/p+md[i]}if(!ts)continue;const a=100*ps/ts,b=100*ms/ts,z=a+b;if(z)dx[i]=100*Math.abs(a-b)/z}const first=p*2-1;let sum=0,cnt=0;for(let i=p;i<=first;i++)if(dx[i]!=null){sum+=dx[i];cnt++}if(!cnt)return o;let q=sum/cnt;o[first]=q;for(let i=first+1;i<L;i++)if(dx[i]!=null){q=(q*(p-1)+dx[i])/p;o[i]=q}return o}
function sessionVwap(c){const o=Array(c.length).fill(null);let day='',pv=0,v=0;for(let i=0;i<c.length;i++){const d=new Date(c[i].time).toISOString().slice(0,10);if(d!==day){day=d;pv=0;v=0}const vol=c[i].volume||0;if(vol>0){pv+=((c[i].high+c[i].low+c[i].close)/3)*vol;v+=vol}o[i]=v?pv/v:null}return o}
function mom(c,i,k=3){if(i<k)return null;let x=0,s=0;for(let j=i-k+1;j<=i;j++){const d=c[j].close-c[j].open;x+=d;s+=d>0?1:d<0?-1:0}return {side:x>0?'BUY':x<0?'SELL':null,strength:Math.abs(s),impulse:x}}
function bodyAtr(c,i,a){return a[i]?Math.abs(c[i].close-c[i].open)/a[i]:999}
function bodyShare(c,i){return Math.abs(c[i].close-c[i].open)/Math.max(1e-9,c[i].high-c[i].low)}
function candle(c,i,side){return side==='BUY'?c[i].close>c[i].open:c[i].close<c[i].open}
function closedIndex(htf,t,ms){let lo=0,hi=htf.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(htf[m].time+ms<=t){ans=m;lo=m+1}else hi=m-1}return ans}
function ind(c){const close=c.map(x=>x.close);return {e9:ema(close,9),e20:ema(close,20),e21:ema(close,21),e50:ema(close,50),r7:rsi(close,7),r14:rsi(close,14),a:atr(c,14),x:adx(c,14),v:sessionVwap(c)}}
const fmtCache=new Map();
function tz(t,z){let f=fmtCache.get(z);if(!f){f=new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});fmtCache.set(z,f)}const o={};for(const p of f.formatToParts(new Date(t)))if(p.type!=='literal')o[p.type]=p.value;return {key:`${o.year}-${o.month}-${o.day}`,m:+o.hour*60+(+o.minute)}}
function inNY(t){const p=tz(t,'America/New_York');return p.m>=510&&p.m<720}
function inLondon(t){const p=tz(t,'Europe/London');return p.m>=480&&p.m<720}
function session(t){return inNY(t)?'NY':inLondon(t)?'LONDON':'OTHER'}
function rangeBetween(c,i,z,startM,endM){const cur=tz(c[i].time,z),a=[];for(let j=i-1;j>=0;j--){const p=tz(c[j].time,z);if(p.key!==cur.key)break;if(p.m>=startM&&p.m<endM)a.push(c[j])}if(a.length<3)return null;return {hi:Math.max(...a.map(x=>x.high)),lo:Math.min(...a.map(x=>x.low))}}
function recentRange(c,i,k){if(i<k)return null;const a=c.slice(i-k,i);return {hi:Math.max(...a.map(x=>x.high)),lo:Math.min(...a.map(x=>x.low))}}

function makeTrade(c,i,sig,tpR){const ei=i+1;if(ei>=c.length)return null;const entry=sig.side==='BUY'?c[ei].open+SLIP:c[ei].open-SLIP;const a=sig.atr;const sample=c.slice(Math.max(0,i-(sig.lookback||10)+1),i+1);const sw=sig.side==='BUY'?Math.min(...sample.map(x=>x.low)):Math.max(...sample.map(x=>x.high));let risk=sig.side==='BUY'?entry-(sw+a*(sig.buf||0.12)):(sw+a*(sig.buf||0.12))-entry;risk=Math.max(risk,a*(sig.minRiskAtr||0.5));if(!(risk>0))return null;const sl=sig.side==='BUY'?entry-risk:entry+risk,tp=sig.side==='BUY'?entry+risk*tpR:entry-risk*tpR,costR=(SPREAD+2*SLIP)/risk;return {...sig,entryIndex:ei,entry,sl,tp,risk,tpR,costR,signalTime:c[i].time,entryTime:c[ei].time}}
function simulate(c,t,end){let mfe=0,mae=0;for(let j=t.entryIndex;j<=end&&j<c.length;j++){const b=c[j],fav=t.side==='BUY'?b.high-t.entry:t.entry-b.low,adv=t.side==='BUY'?t.entry-b.low:b.high-t.entry;mfe=Math.max(mfe,fav);mae=Math.max(mae,adv);if(t.side==='BUY'){if(b.low<=t.sl)return {...t,result:'LOSS',r:-1-t.costR,exitIndex:j,mfeR:mfe/t.risk,maeR:mae/t.risk};if(b.high>=t.tp)return {...t,result:'WIN',r:t.tpR-t.costR,exitIndex:j,mfeR:mfe/t.risk,maeR:mae/t.risk}}else{if(b.high>=t.sl)return {...t,result:'LOSS',r:-1-t.costR,exitIndex:j,mfeR:mfe/t.risk,maeR:mae/t.risk};if(b.low<=t.tp)return {...t,result:'WIN',r:t.tpR-t.costR,exitIndex:j,mfeR:mfe/t.risk,maeR:mae/t.risk}}}return null}
function summarize(name,tr){const wins=tr.filter(x=>x.r>0).length,net=tr.reduce((a,x)=>a+x.r,0),gw=tr.filter(x=>x.r>0).reduce((a,x)=>a+x.r,0),gl=Math.abs(tr.filter(x=>x.r<0).reduce((a,x)=>a+x.r,0));let eq=0,pk=0,dd=0,ls=0,worst=0;for(const x of tr){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.r<0){ls++;worst=Math.max(worst,ls)}else ls=0}const avg=k=>tr.length?tr.reduce((a,x)=>a+(x[k]||0),0)/tr.length:0;const bySession={NY:{n:0,r:0,w:0},LONDON:{n:0,r:0,w:0},OTHER:{n:0,r:0,w:0}},bySide={BUY:{n:0,r:0,w:0},SELL:{n:0,r:0,w:0}};for(const x of tr){let s=bySession[session(x.signalTime)],b=bySide[x.side];s.n++;s.r+=x.r;if(x.r>0)s.w++;b.n++;b.r+=x.r;if(x.r>0)b.w++}for(const v of [...Object.values(bySession),...Object.values(bySide)])v.wr=v.n?100*v.w/v.n:0;return {name,trades:tr.length,winRate:tr.length?100*wins/tr.length:0,netR:net,pf:gl?gw/gl:(gw?999:0),exp:tr.length?net/tr.length:0,dd,worstLossStreak:worst,mfe:avg('mfeR'),mae:avg('maeR'),bySession,bySide}}
function run(c,fn,start,end,tpR){const tr=[];for(let i=Math.max(80,start);i<=Math.min(end,c.length-2);){const sig=fn(i);if(!sig){i++;continue}const t=makeTrade(c,i,sig,tpR);if(!t){i++;continue}const d=simulate(c,t,end+1);if(!d){i++;continue}tr.push(d);i=Math.max(i+1,d.exitIndex+1)}return tr}
function score(r){if(r.trades<8)return -999;return r.exp*25 + Math.min(r.pf,3)*2 + r.netR*0.10 - r.dd*0.08 + Math.min(r.trades,50)*0.01}

(async()=>{
 console.log(`🏁 Scalping Candidates Tournament V4 | XAUUSD | 5m target=${HISTORY}`);
 console.log(`💸 Costs spread=$${SPREAD} + slippage=$${SLIP}/side | split=60/20/20`);
 const c5=rows(await getGoldHistoricalCandles('5min',HISTORY));
 const c15=rows(await getGoldHistoricalCandles('15min',Math.ceil(HISTORY/2.9)));
 const c1=rows(await getGoldHistoricalCandles('1h',Math.ceil(HISTORY/11.2)));
 const i5=ind(c5),i15=ind(c15),i1=ind(c1);
 const htf=i=>{const t=c5[i].time+FIVE,j15=closedIndex(c15,t,FIFTEEN),j1=closedIndex(c1,t,HOUR);if(j15<50||j1<50)return null;const t15=i15.e20[j15]>i15.e50[j15]?'BUY':i15.e20[j15]<i15.e50[j15]?'SELL':null,t1=i1.e20[j1]>i1.e50[j1]?'BUY':i1.e20[j1]<i1.e50[j1]?'SELL':null;return {j15,j1,t15,t1,adx15:i15.x[j15]}}
 const variants=[];
 const add=(strategy,label,params,fn,tpProfiles=[1,1.5,2])=>variants.push({strategy,label,params,fn,tpProfiles});

 // 1) NEW YORK BENCHMARK (fixed logic from selected regime pullback)
 for(const chase of [0.4,0.5,0.6]) add('NEW_YORK','🗽 New York',{chase},i=>{if(!inNY(c5[i].time))return null;const h=htf(i),a=i5.a[i];if(!h||!a||h.t15!==h.t1||!h.t15||!(h.adx15>=22))return null;const side=h.t15,v=i5.v[i],e=i5.e20[i];if(v==null||e==null)return null;const anchor=side==='BUY'?Math.max(e,v):Math.min(e,v);if(Math.abs(c5[i].close-anchor)/a>chase)return null;const rec=c5.slice(Math.max(0,i-3),i+1),tol=.12*a,touch=rec.some(x=>x.low<=e+tol&&x.high>=e-tol)||rec.some(x=>x.low<=v+tol&&x.high>=v-tol);const m=mom(c5,i,3);if(!touch||!candle(c5,i,side)||!m||m.side!==side||bodyAtr(c5,i,i5.a)>.35)return null;return {side,atr:a,lookback:12,buf:.15,minRiskAtr:.55,tag:'NEW_YORK'}},[1.5]);

 // 2) LONDON ASIA RANGE BREAKOUT + RETEST
 for(const adxMin of [18,22]) for(const tolAtr of [.10,.18]) add('LONDON_RETEST','🇬🇧 London Breakout Retest',{adxMin,tolAtr},i=>{if(!inLondon(c5[i].time))return null;const a=i5.a[i];if(!a)return null;const ar=rangeBetween(c5,i,'Europe/London',0,480);if(!ar)return null;const h=htf(i),side=c5[i-1].close>ar.hi?'BUY':c5[i-1].close<ar.lo?'SELL':null;if(!side)return null;if(h?.adx15!=null&&h.adx15<adxMin)return null;const level=side==='BUY'?ar.hi:ar.lo,tol=a*tolAtr,retest=side==='BUY'?c5[i].low<=level+tol&&c5[i].close>level:c5[i].high>=level-tol&&c5[i].close<level;if(!retest||!candle(c5,i,side)||bodyAtr(c5,i,i5.a)>.6)return null;const m=mom(c5,i,2);if(!m||m.side!==side)return null;return {side,atr:a,lookback:8,buf:.10,minRiskAtr:.5,tag:'LONDON_RETEST'}});

 // 3) CONSOLIDATION SWEEP REVERSAL
 for(const widthAtr of [1.8,2.4]) for(const bars of [10,14]) add('CONSOLIDATION_SWEEP','🪤 Consolidation Sweep Reversal',{widthAtr,bars},i=>{const a=i5.a[i];if(!a||i<bars+2)return null;const rg=recentRange(c5,i,bars);if(!rg||((rg.hi-rg.lo)/a)>widthAtr)return null;const bull=c5[i].low<rg.lo&&c5[i].close>rg.lo,bear=c5[i].high>rg.hi&&c5[i].close<rg.hi,side=bull?'BUY':bear?'SELL':null;if(!side)return null;const m=mom(c5,i,2);if(!m||m.side!==side||bodyShare(c5,i)<.45)return null;return {side,atr:a,lookback:bars+2,buf:.10,minRiskAtr:.45,tag:'CONSOLIDATION_SWEEP'}});

 // 4) SESSION SWEEP + CHoCH/FVG proxy (NY only, sweeps Asia/London extremes)
 for(const look of [1,2]) add('SESSION_SWEEP_CHOCH','💧 Session Sweep + CHoCH/FVG',{confirmBars:look},i=>{if(!inNY(c5[i].time)||i<5)return null;const a=i5.a[i];if(!a)return null;const asia=rangeBetween(c5,i,'America/New_York',0,360),lond=rangeBetween(c5,i,'Europe/London',480,720);if(!asia&&!lond)return null;const highs=[asia?.hi,lond?.hi].filter(Number.isFinite),lows=[asia?.lo,lond?.lo].filter(Number.isFinite);if(!highs.length||!lows.length)return null;const hi=Math.max(...highs),lo=Math.min(...lows);const sweptLow=c5[i].low<lo&&c5[i].close>lo,sweptHigh=c5[i].high>hi&&c5[i].close<hi,side=sweptLow?'BUY':sweptHigh?'SELL':null;if(!side)return null;const ref=side==='BUY'?Math.max(...c5.slice(Math.max(0,i-look),i).map(x=>x.high)):Math.min(...c5.slice(Math.max(0,i-look),i).map(x=>x.low));const choch=side==='BUY'?c5[i].close>ref:c5[i].close<ref;if(!choch)return null;const fvg= i>=2 ? (side==='BUY'?c5[i].low>c5[i-2].high:c5[i].high<c5[i-2].low) : false;if(!fvg&&bodyAtr(c5,i,i5.a)<.55)return null;return {side,atr:a,lookback:16,buf:.10,minRiskAtr:.5,tag:'SESSION_SWEEP_CHOCH'}});

 // 5) 2B LIQUIDITY REVERSAL
 for(const k of [12,20]) add('TWO_B','🎯 2B Liquidity Reversal',{lookback:k},i=>{const a=i5.a[i];if(!a||i<k+2)return null;const rg=recentRange(c5,i,k);const bull=c5[i].low<rg.lo&&c5[i].close>rg.lo&&c5[i].close>c5[i-1].close,bear=c5[i].high>rg.hi&&c5[i].close<rg.hi&&c5[i].close<c5[i-1].close,side=bull?'BUY':bear?'SELL':null;if(!side)return null;const h=htf(i);if(h?.t15&&h.t1&&h.t15===h.t1&&h.t15===side)return null;const rr=i5.r14[i];if(rr!=null&&(side==='BUY'?rr>58:rr<42))return null;return {side,atr:a,lookback:k+2,buf:.10,minRiskAtr:.5,tag:'2B_REVERSAL'}});

 // 6) EMA 9/21 SESSION MOMENTUM
 for(const adx5Min of [18,22]) add('EMA921','⚡ EMA 9/21 Session Momentum',{adx5Min},i=>{if(!(inNY(c5[i].time)||inLondon(c5[i].time)))return null;const a=i5.a[i],e9=i5.e9[i],e21=i5.e21[i],rr=i5.r7[i],xx=i5.x[i];if(!a||e9==null||e21==null||rr==null||xx==null||xx<adx5Min)return null;const side=e9>e21?'BUY':e9<e21?'SELL':null;if(!side)return null;const cross= i>0 && (side==='BUY'?i5.e9[i-1]<=i5.e21[i-1]:i5.e9[i-1]>=i5.e21[i-1]);const pullback=Math.abs(c5[i].close-e9)/a<=.35;if(!cross&&!pullback)return null;if(!(side==='BUY'?rr>=52&&rr<=72:rr<=48&&rr>=28)||!candle(c5,i,side))return null;const m=mom(c5,i,2);if(!m||m.side!==side)return null;return {side,atr:a,lookback:8,buf:.10,minRiskAtr:.45,tag:'EMA921'}});

 // 7) ASIA SWEEP -> NY CONTINUATION/REVERSAL
 add('ASIA_SWEEP_NY','🌏 Asia Sweep → NY',{},i=>{if(!inNY(c5[i].time))return null;const a=i5.a[i];if(!a)return null;const asia=rangeBetween(c5,i,'America/New_York',0,360);if(!asia)return null;const last6=c5.slice(Math.max(0,i-6),i+1);const sweptLow=last6.some(x=>x.low<asia.lo&&x.close>asia.lo),sweptHigh=last6.some(x=>x.high>asia.hi&&x.close<asia.hi);if(sweptLow===sweptHigh)return null;const h=htf(i),candidate=sweptLow?'BUY':'SELL';let side=candidate;if(h?.t15&&h.t1&&h.t15===h.t1&&h.t15!==candidate)side=h.t15;const m=mom(c5,i,3);if(!m||m.side!==side||!candle(c5,i,side))return null;return {side,atr:a,lookback:14,buf:.12,minRiskAtr:.5,tag:'ASIA_SWEEP_NY'}});

 const N=c5.length, dEnd=Math.floor(N*.60)-1, vEnd=Math.floor(N*.80)-1;
 const splits={DEV:[80,dEnd],VAL:[dEnd+1,vEnd],FINAL:[vEnd+1,N-2]};
 const byStrategy={};
 for(const v of variants){
   const devResults=v.tpProfiles.map(tp=>{const tr=run(c5,v.fn,...splits.DEV,tp);return {tp,tr,s:summarize(v.label,tr)}}).sort((a,b)=>score(b.s)-score(a.s));
   const chosen=devResults[0];
   const valTr=run(c5,v.fn,...splits.VAL,chosen.tp), val=summarize(v.label,valTr);
   (byStrategy[v.strategy] ||= []).push({...v,chosenTp:chosen.tp,dev:chosen.s,val});
 }
 const selected=[];
 for(const [strategy,arr] of Object.entries(byStrategy)){
   arr.sort((a,b)=>score(b.val)-score(a.val));
   const best=arr[0];
   const finalTr=run(c5,best.fn,...splits.FINAL,best.chosenTp), final=summarize(best.label,finalTr);
   const qualified=final.trades>=8 && final.netR>0 && final.pf>=1.15 && final.exp>0 && final.dd<=12;
   selected.push({strategy,label:best.label,params:best.params,tpR:best.chosenTp,dev:best.dev,val:best.val,final,qualified});
 }
 selected.sort((a,b)=>score(b.final)-score(a.final));
 const qualifiers=selected.filter(x=>x.qualified).slice(0,3);
 console.log('\n🏆 FINAL HOLDOUT RANKING');
 selected.forEach((x,i)=>console.log(`${i+1}. ${x.label} | ${x.qualified?'✅ QUALIFIED':'❌'} | TP=${x.tpR}R | trades=${x.final.trades} | WR=${x.final.winRate.toFixed(1)}% | Net=${x.final.netR.toFixed(2)}R | PF=${x.final.pf.toFixed(2)} | Exp=${x.final.exp.toFixed(3)}R | DD=${x.final.dd.toFixed(2)}R | MFE=${x.final.mfe.toFixed(2)} | MAE=${x.final.mae.toFixed(2)}`));
 console.log('\n🥇 TOP 3 QUALIFIED FOR MULTI-SCALP');
 if(!qualifiers.length) console.log('No strategy passed the qualification gates.');
 qualifiers.forEach((x,i)=>console.log(`${i+1}. ${x.label} | ${JSON.stringify(x.params)} | TP=${x.tpR}R | FINAL Net=${x.final.netR.toFixed(2)}R | PF=${x.final.pf.toFixed(2)} | Exp=${x.final.exp.toFixed(3)}R | DD=${x.final.dd.toFixed(2)}R`));
 const report={generatedAt:new Date().toISOString(),history:{m5:c5.length,m15:c15.length,h1:c1.length},costs:{spread:SPREAD,slippagePerSide:SLIP},split:'60/20/20',qualification:{minFinalTrades:8,minPF:1.15,minNetR:0,minExpectancy:0,maxDD:12},ranking:selected.map(x=>({...x,fn:undefined})),top3:qualifiers.map(x=>({strategy:x.strategy,label:x.label,params:x.params,tpR:x.tpR,final:x.final}))};
 const jp=path.join(OUT,'scalp-candidates-v4-latest.json');fs.writeFileSync(jp,JSON.stringify(report,null,2));
 const cp=path.join(OUT,'scalp-candidates-v4-latest.csv');fs.writeFileSync(cp,'rank,strategy,label,qualified,tp,trades,wr,net_r,pf,exp,dd,mfe,mae\n'+selected.map((x,i)=>[i+1,x.strategy,JSON.stringify(x.label),x.qualified,x.tpR,x.final.trades,x.final.winRate.toFixed(2),x.final.netR.toFixed(2),x.final.pf.toFixed(3),x.final.exp.toFixed(3),x.final.dd.toFixed(2),x.final.mfe.toFixed(3),x.final.mae.toFixed(3)].join(',')).join('\n')+'\n');
 console.log(`\n📄 JSON: ${jp}`);console.log(`📄 CSV : ${cp}`);
})().catch(e=>{console.error('❌ Scalp Tournament V4 failed:',e);process.exitCode=1});
