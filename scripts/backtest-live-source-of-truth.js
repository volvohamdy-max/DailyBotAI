'use strict';

/**
 * LIVE SOURCE-OF-TRUTH BACKTEST
 *
 * IMPORTANT:
 * - This file MUST NOT import or copy logic from any historical backtest script.
 * - Strategy CONFIG is loaded directly from the current LIVE strategy modules.
 * - The historical replay below is intentionally generated from those live CONFIG values.
 * - If a live strategy changes, this harness reads the new CONFIG on the next run.
 */

const { getHistoricalRates } = require('dukascopy-node');
const exhaustionLive = require('../src/services/scalpStrategies/goldExhaustionV3Strategy');
const rapidLive = require('../src/services/scalpStrategies/goldRapidScalpStrategy');
const grokLive = require('../src/services/scalpStrategies/grokGold92Strategy');
const proLive = require('../src/services/scalpStrategies/proStrategy');
const rangeLive = require('../src/services/scalpStrategies/goldRangeMrStrategy');
const sweepLive = require('../src/services/scalpStrategies/goldSweep5Strategy');

const FROM = process.argv[2] || '2025-08-26';
const TO = process.argv[3] || '2026-08-26';
const CACHE = './data/dukascopy-cache';

const LIVE = {
  EXHAUSTION: exhaustionLive.CONFIG,
  RAPID: rapidLive.CONFIG,
  GROK92: grokLive.CONFIG,
  PRO: proLive.CONFIG,
  RANGE: rangeLive.CONFIG,
  SWEEP5: sweepLive.CONFIG,
};

function assertLiveConfigs() {
  for (const [name, cfg] of Object.entries(LIVE)) {
    if (!cfg || !cfg.id || !cfg.pair) throw new Error(`Missing LIVE CONFIG: ${name}`);
  }
}

function printLiveConfigs() {
  console.log('\n🔒 LIVE SOURCE OF TRUTH');
  for (const [name, cfg] of Object.entries(LIVE)) {
    console.log(`${name.padEnd(10)} -> ${cfg.id} | ${cfg.label}`);
    console.log(JSON.stringify(cfg));
  }
}

function tf(rows, minutes) {
  const ms = minutes * 60000, out = [], map = new Map();
  for (const b of rows) {
    const t = Math.floor(b.timestamp / ms) * ms;
    let x = map.get(t);
    if (!x) { x={timestamp:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0}; map.set(t,x); out.push(x); }
    else { x.high=Math.max(x.high,b.high); x.low=Math.min(x.low,b.low); x.close=b.close; x.volume+=(b.volume||0); }
  }
  return out;
}

function ema(v,p){const o=Array(v.length).fill(null);if(!v.length)return o;const k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e;}return o;}
function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0);}ag=G/p;al=L/p;}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc));}o[i]=s/p;}return o;}
function adx(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));}let T=0,P=0,M=0;for(let i=1;i<=p&&i<c.length;i++){T+=tr[i];P+=pd[i];M+=md[i];}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){T=T-T/p+tr[i];P=P-P/p+pd[i];M=M-M/p+md[i];}if(T){const a=100*P/T,b=100*M/T;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b);}}let seed=0,n=0;for(let i=p;i<c.length;i++)if(Number.isFinite(dx[i])){if(n<p){seed+=dx[i];n++;if(n===p)o[i]=seed/p;}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p;}return o;}
function prev(rows,ts){let lo=0,hi=rows.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].timestamp<ts){ans=m;lo=m+1}else hi=m-1;}return ans;}

function exitFixed(m5,start,side,en,sl,tp,maxBars){const end=Math.min(m5.length-1,start+maxBars);for(let j=start;j<=end;j++){const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp:b.low<=tp;if(loss||win)return{j,r:loss?-1:Math.abs(tp-en)/Math.abs(en-sl)};}const b=m5[end],risk=Math.abs(en-sl),raw=(side==='BUY'?b.close-en:en-b.close)/risk;return{j:end,r:Math.max(-1,Math.min(Math.abs(tp-en)/risk,raw))};}

function exhaustion(m5){const C=LIVE.EXHAUSTION,A=atr(m5,14),out=[];let busy=-1;for(let i=40;i<m5.length-2;i++){if(i<=busy||!(A[i]>0))continue;const hr=new Date(m5[i].timestamp).getUTCHours();if(!C.hoursUTC.includes(hr))continue;const start=m5[i-3].close,end=m5[i-1].close,disp=end-start;if(!disp)continue;const side=disp<0?'BUY':'SELL',q=side==='BUY'?C.buy:C.sell;if(Math.abs(disp)<A[i]*q.burstATR)continue;let agreeing=0;for(let k=i-3;k<i;k++){if(disp>0&&m5[k].close>m5[k].open)agreeing++;if(disp<0&&m5[k].close<m5[k].open)agreeing++;}if(agreeing<2)continue;const ex=m5[i],rg=ex.high-ex.low;if(!(rg>0))continue;const uw=(ex.high-Math.max(ex.open,ex.close))/rg,lw=(Math.min(ex.open,ex.close)-ex.low)/rg;if(side==='BUY'&&lw<q.wick||side==='SELL'&&uw<q.wick)continue;const cf=m5[i+1];if(side==='BUY'){if(cf.close<=ex.low+rg*q.retrace||cf.low<ex.low-A[i]*.25)continue;}else{if(cf.close>=ex.high-rg*q.retrace||cf.high>ex.high+A[i]*.25)continue;}const en=m5[i+2].open;if(Math.abs(en-cf.close)>A[i]*.30)continue;const risk=A[i]*q.slATR,reward=A[i]*q.tpATR,sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+reward:en-reward,z=exitFixed(m5,i+2,side,en,sl,tp,q.maxBars);out.push({strategy:'EXHAUSTION',time:m5[i+2].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side});busy=z.j;}return out;}

function rapid(m5,h1){const C=LIVE.RAPID,cl=m5.map(x=>x.close),E=ema(cl,20),A=atr(m5),hc=h1.map(x=>x.close),H20=ema(hc,20),H50=ema(hc,50),HA=atr(h1),out=[];let busy=-1;for(let i=60;i<m5.length-1;i++){if(i<=busy||!(A[i]>0))continue;const hr=new Date(m5[i].timestamp).getUTCHours();if(!C.hoursUTC.includes(hr))continue;const h=prev(h1,m5[i].timestamp);if(h<55||!(HA[h]>0))continue;const sep=Math.abs(H20[h]-H50[h])/HA[h];if(sep<C.h1Sep)continue;if(!(hc[h]>H20[h]&&H20[h]>H50[h]&&H20[h]>H20[h-2]))continue;let hi=-Infinity;for(let j=i-3;j<i;j++)hi=Math.max(hi,m5[j].high);const rg=m5[i].high-m5[i].low,body=Math.abs(m5[i].close-m5[i].open);if(!rg||body/A[i]<C.bodyMin||rg/A[i]>C.rangeMax)continue;const pos=(m5[i].close-m5[i].low)/rg;if(pos<C.closePos||Math.abs(m5[i].close-E[i])/A[i]>C.emaDistMax||!(m5[i].close>hi+C.breakAtr*A[i]&&m5[i].close>E[i]))continue;const en=m5[i+1].open;if(Math.abs(en-m5[i].close)>A[i]*.3)continue;const swing=Math.min(m5[i].low,m5[i-1].low),risk=Math.max(A[i]*C.slAtr,Math.abs(en-swing));if(risk>A[i]*C.riskCap)continue;const sl=en-risk,tp=en+risk*C.rr,z=exitFixed(m5,i+1,'BUY',en,sl,tp,C.maxBars);out.push({strategy:'RAPID',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side:'BUY'});busy=z.j;}return out;}

function grok(m5,h1){const C=LIVE.GROK92,out=[],cl=m5.map(x=>x.close),E9=ema(cl,C.fastEma),E21=ema(cl,C.slowEma),R=rsi(cl,C.rsiPeriod),A=atr(m5,C.atrPeriod),hc=h1.map(x=>x.close),E200=ema(hc,200),HA=atr(h1,C.atrPeriod),HD=adx(h1,C.atrPeriod);let busy=-1;for(let i=60;i<m5.length-1;i++){if(i<=busy||!(A[i]>0))continue;let side=null;if(E9[i-1]<=E21[i-1]&&E9[i]>E21[i]&&R[i]>C.rsiBuyMin)side='BUY';if(E9[i-1]>=E21[i-1]&&E9[i]<E21[i]&&R[i]<C.rsiSellMax)side='SELL';if(!side||Math.abs(E9[i]-E21[i])/A[i]<C.emaGapAtr)continue;const vols=m5.slice(Math.max(0,i-C.volumePeriod),i).map(x=>x.volume||0),va=vols.reduce((a,b)=>a+b,0)/vols.length;if(!(va>0&&(m5[i].volume||0)>=va*C.volumeSpikeMult))continue;const h=prev(h1,m5[i].timestamp);if(h<200||!(HA[h]>0)||HD[h]<C.adxMin)continue;const bias=hc[h]>E200[h]?'BUY':hc[h]<E200[h]?'SELL':null;if(side!==bias||Math.abs(hc[h]-E200[h])/HA[h]<C.h1DistanceAtr)continue;const en=m5[i+1].open,risk=A[i]*C.stopAtr,sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+risk*C.rewardR:en-risk*C.rewardR;const z=exitFixed(m5,i+1,side,en,sl,tp,5000);out.push({strategy:'GROK92',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side});busy=z.j;}return out;}

function pro(m5,h1){const C=LIVE.PRO,out=[],R=rsi(m5.map(x=>x.close),C.rsiPeriod),D=adx(m5,C.adxPeriod),A=atr(m5,C.atrPeriod),days=tf(h1,1440),DE=ema(days.map(x=>x.close),C.dailyEmaPeriod);let busy=-1,cool=0,day='',losses=0;for(let i=80;i<m5.length-2;i++){if(i<=busy)continue;const now=m5[i+1].timestamp,dt=new Date(now),dk=dt.toISOString().slice(0,10);if(day!==dk){day=dk;losses=0;}if(losses>=C.maxLossesPerDay||now<cool||C.blockedUtcHours.has(dt.getUTCHours()))continue;if(dt.getUTCDay()===3){const mn=dt.getUTCHours()*60+dt.getUTCMinutes();if(mn>=17*60&&mn<=20*60+30)continue;}const di=prev(days,m5[i].timestamp);if(di<C.dailyEmaPeriod||!Number.isFinite(DE[di]))continue;const bias=days[di].close>DE[di]?'BUY':'SELL';if(!Number.isFinite(D[i])||!Number.isFinite(A[i]))continue;const pa=A.slice(i-C.atrAverageLookback,i).filter(Number.isFinite);if(pa.length<C.atrAverageLookback||A[i]/(pa.reduce((a,b)=>a+b,0)/pa.length)>C.atrRatioMax)continue;let side=null;if(R[i-1]>=C.buyLevel&&R[i]<C.buyLevel&&bias==='BUY')side='BUY';if(R[i-1]<=C.sellLevel&&R[i]>C.sellLevel&&bias==='SELL')side='SELL';if(!side)continue;const req=side==='BUY'?C.buyAdxMin:C.sellAdxMin;if(D[i]<req)continue;const rg=m5[i].high-m5[i].low;if(!(rg>0)||Math.abs(m5[i].close-m5[i].open)/rg<C.minBodyRange)continue;const en=m5[i+1].open,sl=side==='BUY'?en-C.stopDistance:en+C.stopDistance;let z=null;for(let j=i+1;j<m5.length;j++){const b=m5[j];if(side==='BUY'?b.low<=sl:b.high>=sl){z={j,r:-1,won:false};break;}if(side==='BUY'?R[j]>=C.sellLevel:R[j]<=C.buyLevel){const rr=(side==='BUY'?b.close-en:en-b.close)/C.stopDistance;z={j,r:rr,won:rr>=0};break;}const q=new Date(b.timestamp);if(q.getUTCDay()===5&&(q.getUTCHours()>21||(q.getUTCHours()===21&&q.getUTCMinutes()>=45))){const rr=(side==='BUY'?b.close-en:en-b.close)/C.stopDistance;z={j,r:rr,won:rr>=0};break;}}if(!z)continue;out.push({strategy:'PRO',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side});busy=z.j;if(!z.won){losses++;cool=m5[z.j].timestamp+C.cooldownMinutes*60000;}}return out;}

function range(m5){const C=LIVE.RANGE,out=[],cl=m5.map(x=>x.close),E=ema(cl,20),R=rsi(cl,14),A=atr(m5,14),D=adx(m5,14);let busy=-1;for(let i=100;i<m5.length-1;i++){if(i<=busy||![E[i],E[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0)||D[i]>C.adxMax)continue;const sm=A.slice(i-50,i).filter(Number.isFinite);if(sm.length<45)continue;const av=sm.reduce((a,b)=>a+b,0)/sm.length,ratio=A[i]/av;if(ratio<C.atrLo||ratio>C.atrHi||Math.abs(E[i]-E[i-6])/A[i]>C.emaSlopeMax)continue;const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;if(width<A[i]*C.widthMin||width>A[i]*C.widthMax)continue;const edge=Math.max(A[i]*C.edgeAtr,width*C.edgeWidth);let lt=0,ht=0;for(const b of look){if(b.low<=lo+edge)lt++;if(b.high>=hi-edge)ht++;}if(lt<2||ht<2||look.slice(-6).some(b=>b.close<lo-A[i]*.10||b.close>hi+A[i]*.10))continue;const b=m5[i],br=Math.max(1e-9,b.high-b.low),body=Math.abs(b.close-b.open)/br,lw=(Math.min(b.open,b.close)-b.low)/br,uw=(b.high-Math.max(b.open,b.close))/br,mid=(hi+lo)/2;let side=null;if((C.side==='BOTH'||C.side==='BUY')&&b.low<=lo+edge&&b.close>=lo+edge*.75&&lw>=C.wickMin&&body<=C.bodyMax&&R[i]<=C.rsiEdge&&b.close>lo&&b.close<mid)side='BUY';if(!side&&(C.side==='BOTH'||C.side==='SELL')&&b.high>=hi-edge&&b.close<=hi-edge*.75&&uw>=C.wickMin&&body<=C.bodyMax&&R[i]>=100-C.rsiEdge&&b.close<hi&&b.close>mid)side='SELL';if(!side)continue;const en=m5[i+1].open,ss=side==='BUY'?Math.max(A[i]*C.slMinAtr,en-(lo-A[i]*C.stopPadAtr)):Math.max(A[i]*C.slMinAtr,(hi+A[i]*C.stopPadAtr)-en),sd=Math.min(ss,A[i]*C.slCapAtr),md=side==='BUY'?mid-en:en-mid,td=Math.min(md,sd*C.maxRR),rr=td/sd;if(!(sd>0&&rr>=C.minRR&&rr<=C.maxRR))continue;const sl=side==='BUY'?en-sd:en+sd,tp=side==='BUY'?en+td:en-td,z=exitFixed(m5,i+1,side,en,sl,tp,C.maxBars);out.push({strategy:'RANGE',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side});busy=z.j;}return out;}

function sweep(m5){const C=LIVE.SWEEP5,A=atr(m5,14),out=[];let busy=-1;for(let i=30;i<m5.length-1;i++){if(i<=busy||!(A[i]>0))continue;const hr=new Date(m5[i].timestamp).getUTCHours();if(hr<C.sessionUTC[0]||hr>=C.sessionUTC[1])continue;let ph=-Infinity;for(let k=i-C.lookback;k<i;k++)ph=Math.max(ph,m5[k].high);const b=m5[i],rg=b.high-b.low;if(!(rg>0))continue;const uw=(b.high-Math.max(b.open,b.close))/rg,pm=Math.abs(m5[i-1].close-m5[i-3].close);if(b.high<ph+A[i]*C.sweepAtr||!(b.close<ph)||!(b.close<b.open)||uw<C.upperWickMin||pm<A[i]*C.priorMoveAtr)continue;const en=m5[i+1].open,sl=en+C.slUsd,tp=en-C.tpUsd,z=exitFixed(m5,i+1,'SELL',en,sl,tp,C.maxBars);out.push({strategy:'SWEEP5',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side:'SELL'});busy=z.j;}return out;}

function stats(z){let eq=0,peak=0,dd=0,w=0,g=0,l=0;for(const x of z){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(x.r>0){w++;g+=x.r}else l+=-x.r;}return{trades:z.length,wr:z.length?100*w/z.length:0,net:eq,pf:l?g/l:(g?Infinity:0),dd};}
function fmt(s){return `${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${Number.isFinite(s.pf)?s.pf.toFixed(2):'∞'} | DD ${s.dd.toFixed(2)}R`;}

(async()=>{
  assertLiveConfigs();
  console.log('🔥 BACKTEST — LIVE SOURCE OF TRUTH ONLY');
  console.log(`📅 ${FROM} → ${TO}`);
  console.log('🚫 Old backtest scripts/results are NOT imported.');
  printLiveConfigs();
  console.log('\n📥 Loading fresh historical XAUUSD M5...');
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:CACHE});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp),h1=tf(m5,60);
  console.log(`✅ M5 ${m5.length} | H1 ${h1.length}`);
  const sets=[exhaustion(m5),rapid(m5,h1),grok(m5,h1),pro(m5,h1),range(m5),sweep(m5)];
  console.log('\n━━━━━━━━ LIVE STRATEGY RESULTS ━━━━━━━━');
  for(const z of sets){const name=z[0]?.strategy||['EXHAUSTION','RAPID','GROK92','PRO','RANGE','SWEEP5'][sets.indexOf(z)];console.log(`${name.padEnd(10)} ${fmt(stats(z))}`);const buy=z.filter(x=>x.side==='BUY'),sell=z.filter(x=>x.side==='SELL');if(buy.length)console.log(`  BUY      ${fmt(stats(buy))}`);if(sell.length)console.log(`  SELL     ${fmt(stats(sell))}`);}
  const all=sets.flat().sort((a,b)=>a.time-b.time);
  console.log('\n━━━━━━━━ ALL RAW LIVE SIGNALS ━━━━━━━━');
  console.log(fmt(stats(all)));
  for(const y of [...new Set(all.map(x=>new Date(x.time).getUTCFullYear()))].sort())console.log(`${y} | ${fmt(stats(all.filter(x=>new Date(x.time).getUTCFullYear()===y)))}`);
})().catch(e=>{console.error(e);process.exit(1);});
