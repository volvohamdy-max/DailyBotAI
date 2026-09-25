'use strict';

/**
 * Fresh read-only XAUUSD M5 backtest runner.
 * Independent from the old backtest-all-live-gold-strategies.js.
 *
 * Data source: Dukascopy via dukascopy-node (cached locally).
 * Default period: last 365 days ending now.
 * No live files are modified.
 */
const { getHistoricalRates } = require('dukascopy-node');\nconst fs=require('fs'),path=require('path');

const DAY = 86400000;
const N = Number;
const FROM = new Date(process.env.BACKTEST_FROM || (Date.now() - 365 * DAY));
const TO = new Date(process.env.BACKTEST_TO || Date.now());

function normalize(raw){
 let M=(raw||[]).map(x=>({t:N(x.timestamp??x.time??x.date),o:N(x.open??x.o),h:N(x.high??x.h),l:N(x.low??x.l),c:N(x.close??x.c),v:N(x.volume??x.v??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(N.isFinite)).sort((a,b)=>a.t-b.t);
 if(M[0]?.t<1e12)M.forEach(x=>x.t*=1000);
 return M;
}
function localData(){
 for(const f of ['xauusd-m5-dukascopy.json','xauusd-m5.json']){
  const p=path.join(__dirname,'../data',f);
  if(fs.existsSync(p)){const x=JSON.parse(fs.readFileSync(p,'utf8'));const M=normalize(Array.isArray(x)?x:x.candles||x.data||x.values||[]);if(M.length>=1000)return{M,source:p}}
 }
 return null;
}
async function downloadChunked(){
 const start=new Date(FROM.getTime()-100*DAY),end=TO,all=[];
 for(let t=start.getTime();t<end.getTime();t+=14*DAY){
  const a=new Date(t),b=new Date(Math.min(t+14*DAY,end.getTime()));
  process.stdout.write(`  Dukascopy ${a.toISOString().slice(0,10)} -> ${b.toISOString().slice(0,10)} ... `);
  try{
   const x=await getHistoricalRates({instrument:'xauusd',dates:{from:a,to:b},timeframe:'m5',format:'json',priceType:'bid',volumes:true,batchSize:1,pauseBetweenBatchesMs:1400,useCache:true,cacheFolderPath:'./data/dukascopy-cache',retryCount:1,retryOnEmpty:false});
   console.log((x||[]).length); if(x?.length)all.push(...x);
  }catch(e){console.log('skip ('+(e.message||e)+')')}
 }
 return normalize(all);
}

function ema(v,p){const a=Array(v.length).fill(NaN);if(!v.length)return a;let e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function rsi(v,p=14){const a=Array(v.length).fill(NaN);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const z=v[j]-v[j-1];gs+=Math.max(z,0);ls+=Math.max(-z,0)}ag=gs/p;al=ls/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)a[i]=al===0?100:100-100/(1+ag/al)}return a}
function atr(r,p=14){const a=Array(r.length).fill(NaN),tr=Array(r.length).fill(0);for(let i=0;i<r.length;i++){const pc=i?r[i-1].c:r[i].c;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-pc),Math.abs(r[i].l-pc));if(i>=p-1){let s=0;for(let j=i-p+1;j<=i;j++)s+=tr[j];a[i]=s/p}}return a}
function adx(r,p=14){const out=Array(r.length).fill(NaN),tr=[],pd=[],md=[];for(let i=1;i<r.length;i++){const up=r[i].h-r[i-1].h,dn=r[i-1].l-r[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c))}for(let i=p*2;i<r.length;i++){let sum=0,n=0;for(let k=i-p+1;k<=i;k++){let ts=0,ps=0,ms=0;for(let j=Math.max(1,k-p+1);j<=k;j++){ts+=tr[j]||0;ps+=pd[j]||0;ms+=md[j]||0}const pi=ts?100*ps/ts:0,mi=ts?100*ms/ts:0;if(pi+mi){sum+=100*Math.abs(pi-mi)/(pi+mi);n++}}if(n)out[i]=sum/n}return out}
function aggregate(rows,ms){const a=[];let z;for(const b of rows){const t=Math.floor(b.t/ms)*ms;if(!z||z.t!==t){z={t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v};a.push(z)}else{z.h=Math.max(z.h,b.h);z.l=Math.min(z.l,b.l);z.c=b.c;z.v+=b.v}}return a}
function before(a,t){let lo=0,hi=a.length-1,z=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m].t<t){z=m;lo=m+1}else hi=m-1}return z}
function fixed(rows,i,side,sl,tp,maxBars){const e=rows[i+1]?.o;if(!N.isFinite(e))return null;for(let j=i+1;j<=Math.min(i+maxBars,rows.length-1);j++){const hitSL=side==='BUY'?rows[j].l<=sl:rows[j].h>=sl,hitTP=side==='BUY'?rows[j].h>=tp:rows[j].l<=tp;if(hitSL&&hitTP)return -1; // conservative same-candle ordering
if(hitSL)return -1;if(hitTP)return Math.abs(tp-e)/Math.abs(e-sl)}const q=rows[Math.min(i+maxBars,rows.length-1)].c;return(side==='BUY'?q-e:e-q)/Math.abs(e-sl)}
function stats(a){let w=0,gp=0,gl=0,eq=0,peak=0,dd=0;for(const x of a){if(x.r>0){w++;gp+=x.r}else if(x.r<0)gl-=x.r;eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq)}return{t:a.length,w,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?99:0),net:eq,dd}}
function print(name,a){const s=stats(a),b=stats(a.filter(x=>x.side==='BUY')),q=stats(a.filter(x=>x.side==='SELL'));const f=x=>`T${x.t} WR${x.wr.toFixed(1)} PF${x.pf.toFixed(2)} N${x.net>=0?'+':''}${x.net.toFixed(1)}R DD${x.dd.toFixed(1)}`;console.log(`${name.padEnd(12)} | ${f(s)} | BUY ${f(b)} | SELL ${f(q)}`)}
function add(a,i,side,r,t){if(t>=FROM.getTime()&&t<=TO.getTime()&&N.isFinite(r))a.push({i,side,r,t})}

(async()=>{
 console.log('Loading XAUUSD M5...');
 const local=localData(); let M,source;
 if(local){M=local.M;source='LOCAL '+local.source;console.log('Using local candles:',M.length)}
 else{console.log('No local M5 JSON found; downloading Dukascopy in 14-day chunks (empty chunks are skipped).');M=await downloadChunked();source='DUKASCOPY CHUNKED'}
 if(M.length<1000)throw Error('Not enough M5 candles after local/chunked fallback: '+M.length);
 M=M.filter(x=>x.t>=FROM.getTime()-100*DAY&&x.t<=TO.getTime());
 const C=M.map(x=>x.c),A=atr(M),R=rsi(C),D=adx(M),E9=ema(C,9),E20=ema(C,20),E21=ema(C,21),E50=ema(C,50);
 const H=aggregate(M,3600000),HC=H.map(x=>x.c),H20=ema(HC,20),H50=ema(HC,50),H200=ema(HC,200),HA=atr(H),HD=adx(H);
 const DY=aggregate(M,DAY),DC=DY.map(x=>x.c),DE50=ema(DC,50);
 const EX=[],RA=[],GR=[],PR=[],RM=[],SW=[],MI=[];
 for(let i=250;i<M.length-300;i++){const b=M[i],hr=new Date(b.t).getUTCHours(),dow=new Date(b.t).getUTCDay();if(b.t<FROM.getTime()||b.t>TO.getTime())continue;
  // EXHAUSTION V3
  if(hr>=4&&hr<=20&&A[i]>0&&i>=4){const disp=M[i-1].c-M[i-3].c,side=disp<0?'BUY':'SELL',q=side==='BUY'?{burst:2.2,wick:.30}:{burst:2.6,wick:.25};if(Math.abs(disp)>=A[i]*q.burst){let agree=0;for(let k=i-3;k<i;k++)if((disp>0&&M[k].c>M[k].o)||(disp<0&&M[k].c<M[k].o))agree++;const rg=b.h-b.l;if(rg>0){const wick=side==='BUY'?(Math.min(b.o,b.c)-b.l)/rg:(b.h-Math.max(b.o,b.c))/rg;if(agree>=2&&wick>=q.wick){const cf=M[i+1],good=side==='BUY'?(cf.c>b.l+rg*.15&&cf.l>=b.l-A[i]*.25):(cf.c<b.h-rg*.15&&cf.h<=b.h+A[i]*.25);if(good){const e=M[i+2]?.o;if(e){const risk=Math.max(A[i]*1.25,2),rew=Math.max(A[i]*.6,2);add(EX,i+1,side,fixed(M,i+1,side,side==='BUY'?e-risk:e+risk,side==='BUY'?e+rew:e-rew,3),b.t)}}}}}}
  // RAPID V5
  if([0,4,11,12,13,14,15,17].includes(hr)&&A[i]>0){const h=before(H,b.t),sep=h>=2&&HA[h]>0?Math.abs(H20[h]-H50[h])/HA[h]:0,bull=h>=2&&HC[h]>H20[h]&&H20[h]>H50[h]&&H20[h]>H20[h-2],bear=h>=2&&HC[h]<H20[h]&&H20[h]<H50[h]&&H20[h]<H20[h-2],hi=Math.max(...M.slice(i-3,i).map(x=>x.h)),lo=Math.min(...M.slice(i-3,i).map(x=>x.l)),rg=b.h-b.l,body=Math.abs(b.c-b.o),pos=rg?(b.c-b.l)/rg:.5,side=bull&&b.c>hi&&pos>=.72&&b.c>E20[i]?'BUY':bear&&b.c<lo&&pos<=.28&&b.c<E20[i]?'SELL':null;if(side&&sep>=.08&&body/A[i]>=.65&&rg/A[i]<=2&&Math.abs(b.c-E20[i])/A[i]<=1.5){const e=M[i+1].o,swing=side==='BUY'?Math.min(b.l,M[i-1].l):Math.max(b.h,M[i-1].h),risk=Math.max(A[i]*.65,Math.abs(e-swing));if(risk<=A[i]*1.35)add(RA,i,side,fixed(M,i,side,side==='BUY'?e-risk:e+risk,side==='BUY'?e+risk:e-risk,8),b.t)}}
  // GROK92
  if(A[i]>0){const up=E9[i-1]<=E21[i-1]&&E9[i]>E21[i],dn=E9[i-1]>=E21[i-1]&&E9[i]<E21[i],side=up&&R[i]>52?'BUY':dn&&R[i]<48?'SELL':null;if(side&&Math.abs(E9[i]-E21[i])/A[i]>=.04){const va=M.slice(i-20,i).reduce((s,x)=>s+x.v,0)/20,h=before(H,b.t);if(va>0&&b.v>=va*1.25&&h>=220&&HD[h]>=20&&HA[h]>0){const bias=HC[h]>H200[h]?'BUY':HC[h]<H200[h]?'SELL':null;if(side===bias&&Math.abs(HC[h]-H200[h])/HA[h]>=.10){const e=M[i+1].o,risk=A[i]*1.5;add(GR,i,side,fixed(M,i,side,side==='BUY'?e-risk:e+risk,side==='BUY'?e+risk*.8:e-risk*.8,24),b.t)}}}}
  // PRO MEGA P1 - current live rules (45/55 entry, 54/50 exit, current hours/filters, $14/$12 SL)
  if(A[i]>0){const d=before(DY,b.t),bias=d>=50?(DC[d]>DE50[d]?'BUY':'SELL'):null,side=R[i-1]>=45&&R[i]<45&&bias==='BUY'?'BUY':R[i-1]<=55&&R[i]>55&&bias==='SELL'?'SELL':null;if(side){if(hr===1||hr===6||hr===8||(hr>=14&&hr<=19)||(dow===3&&hr>=17&&hr<=20)){}else{const prior=A.slice(i-50,i).filter(N.isFinite),avg=prior.length===50?prior.reduce((a,x)=>a+x,0)/50:null,ratio=avg?A[i]/avg:null,rg=b.h-b.l,body=rg?Math.abs(b.c-b.o)/rg:0,mom=i>=36?(b.c-M[i-36].c)/A[i]:null;const ok=side==='BUY'?(D[i]>=20&&ratio>=.50&&ratio<=1.30&&body>=.55&&mom!==null&&mom>=-25):(D[i]>=18&&ratio>=.75&&ratio<=1.30&&body>=.45);if(ok){const e=M[i+1].o,risk=side==='BUY'?14:12,sl=side==='BUY'?e-risk:e+risk;let rr=null;for(let j=i+1;j<=Math.min(i+288,M.length-1);j++){if((side==='BUY'&&M[j].l<=sl)||(side==='SELL'&&M[j].h>=sl)){rr=-1;break}if((side==='BUY'&&R[j]>=54)||(side==='SELL'&&R[j]<=50)){rr=(side==='BUY'?M[j].c-e:e-M[j].c)/risk;break}}if(rr===null){const q=M[Math.min(i+288,M.length-1)].c;rr=(side==='BUY'?q-e:e-q)/risk}add(PR,i,side,rr,b.t)}}}}
  // RANGE MR MEGA N4 BUY
  if(A[i]>0){const sm=A.slice(i-50,i).filter(N.isFinite),av=sm.length?sm.reduce((a,x)=>a+x,0)/sm.length:0,ratio=av?A[i]/av:99,slope=Math.abs(E20[i]-E20[i-6])/A[i],look=M.slice(i-30,i),hi=Math.max(...look.map(x=>x.h)),lo=Math.min(...look.map(x=>x.l)),w=hi-lo,rg=b.h-b.l,body=rg?Math.abs(b.c-b.o)/rg:99,lw=rg?(Math.min(b.o,b.c)-b.l)/rg:0;if(D[i]<=14&&ratio>=.55&&ratio<=1.6&&slope<=.2&&w>=A[i]*1.8&&w<=A[i]*8&&body<=.75){const edge=Math.max(A[i]*.3,w*.1),lt=look.filter(x=>x.l<=lo+edge).length,ht=look.filter(x=>x.h>=hi-edge).length;if(lt&&ht&&b.l<=lo+edge&&b.c>=lo+edge*.75&&lw>=.25&&R[i]<=46){const e=M[i+1].o,sd=Math.min(Math.max(A[i]*.55,e-(lo-A[i]*.12)),A[i]*1.4),td=Math.min((hi+lo)/2-e,sd*1.5);if(sd>0&&td/sd>=.7)add(RM,i,'BUY',fixed(M,i,'BUY',e-sd,e+td,12),b.t)}}}
  // SWEEP5
  if([9,10,11,12,17].includes(hr)&&A[i]>0){const ph=Math.max(...M.slice(i-6,i).map(x=>x.h)),rg=b.h-b.l,uw=rg?(b.h-Math.max(b.o,b.c))/rg:0,pm=Math.abs(M[i-1].c-M[i-3].c);if(rg>0&&b.h>=ph+A[i]*.04&&b.c<ph&&b.c<b.o&&uw>=.60&&pm>=A[i]*.5){const e=M[i+1].o;add(SW,i,'SELL',fixed(M,i,'SELL',e+5,e-5,4),b.t)}}
  // MICRO PULLBACK
  if(hr>=10&&hr<=19&&A[i]>0){const rg=b.h-b.l,body=Math.abs(b.c-b.o),side=E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]?'BUY':E9[i]<E21[i]&&E21[i]<E50[i]&&E21[i]<E21[i-3]?'SELL':null;if(side&&rg>0&&body/rg>=.55&&Math.abs(E9[i]-E21[i])/A[i]>=.08){const is=i-4,ie=i-2,imp=side==='BUY'?M[ie].c-M[is].o:M[is].o-M[ie].c,ph=M[ie+1].h,pl=M[ie+1].l,retr=side==='BUY'?(M[ie].c-pl)/imp:(ph-M[ie].c)/imp,pos=(b.c-b.l)/rg,confirm=side==='BUY'?(pos>=.62&&b.c>M[i-1].h):(pos<=.38&&b.c<M[i-1].l);if(imp>=1.2*A[i]&&retr>=.12&&retr<=.45&&confirm){const e=M[i+1].o,risk=1.1*A[i];add(MI,i,side,fixed(M,i,side,side==='BUY'?e-risk:e+risk,side==='BUY'?e+risk*.7:e-risk*.7,10),b.t)}}}
 }
 console.log('\n🧪 FRESH XAUUSD LIVE-RULES BACKTEST');
 console.log(`${FROM.toISOString()} -> ${TO.toISOString()} | M5=${M.length} | ${source} | conservative same-bar SL first`);
 const groups=[['EXHAUSTION',EX],['RAPID',RA],['GROK92',GR],['PRO',PR],['RANGE',RM],['SWEEP5',SW],['MICRO',MI]];let all=[];for(const [n,a] of groups){print(n,a);all=all.concat(a)}all.sort((a,b)=>a.t-b.t);print('TOTAL RAW',all);
 console.log('READ ONLY: no strategy/live file changed.');
})().catch(e=>{console.error('BACKTEST FAILED:',e.stack||e);process.exitCode=1});
