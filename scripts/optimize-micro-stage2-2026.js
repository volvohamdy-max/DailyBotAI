'use strict';
/**
 * Exact-current-live-rules replay for the six strategies enabled by src/services/goldScalper.js.
 * Signal predicates/indicator math mirror the live files as of 2026-09-25.
 * Historical entry proxy: next M5 open (live uses getPrice); entry-gap gates are checked against that proxy.
 * Same-bar SL+TP => SL first (conservative).
 */
const fs=require('fs'),path=require('path');
const DAY=86400000,N=Number;
const YEAR=process.env.BACKTEST_YEAR?Number(process.env.BACKTEST_YEAR):null;
const FROM=new Date(process.env.BACKTEST_FROM||(YEAR?`${YEAR}-01-01T00:00:00Z`:Date.now()-365*DAY)),TO=new Date(process.env.BACKTEST_TO||(YEAR?`${YEAR}-12-31T23:59:59.999Z`:Date.now()));
function norm(raw){let a=(raw||[]).map(x=>({t:N(x.timestamp??x.time??x.date),o:N(x.open??x.o),h:N(x.high??x.h),l:N(x.low??x.l),c:N(x.close??x.c),v:N(x.volume??x.v??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);if(a[0]?.t<1e12)a.forEach(x=>x.t*=1000);return a}
function load(){const requested=process.env.BACKTEST_FILE?[process.env.BACKTEST_FILE]:[];for(const f of [...requested,'xauusd-m5-dukascopy.json','xauusd-m5.json']){const p=path.join(__dirname,'../data',f);if(fs.existsSync(p)){const z=JSON.parse(fs.readFileSync(p,'utf8')),a=norm(Array.isArray(z)?z:z.candles||z.data||z.values||[]);if(a.length>1000)return{a,p}}}throw Error('Local XAUUSD M5 JSON not found')}
function ema(v,p){const o=Array(v.length).fill(NaN),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function emaAll(v,p){const o=Array(v.length).fill(NaN),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(NaN);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const x=v[j]-v[j-1];gs+=Math.max(x,0);ls+=Math.max(-x,0)}ag=gs/p;al=ls/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atrLive(r,p=14){const o=Array(r.length).fill(NaN);for(let i=p;i<r.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=r[j-1].c;s+=Math.max(r[j].h-r[j].l,Math.abs(r[j].h-pc),Math.abs(r[j].l-pc))}o[i]=s/p}return o}
function atrRapid(r,p=14){const o=Array(r.length).fill(NaN);let s=0;for(let i=1;i<r.length;i++){const tr=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c));s+=tr;if(i>p){const j=i-p,old=Math.max(r[j].h-r[j].l,Math.abs(r[j].h-r[j-1].c),Math.abs(r[j].l-r[j-1].c));s-=old}if(i>=p)o[i]=s/p}return o}
function atrPro(r,p=14){const o=Array(r.length).fill(NaN),tr=[];for(let i=0;i<r.length;i++){const pc=i?r[i-1].c:r[i].c;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-pc),Math.abs(r[i].l-pc));if(i>=p-1)o[i]=tr.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p}return o}
function adxW(r,p=14){const o=Array(r.length).fill(NaN),tr=Array(r.length).fill(0),pd=Array(r.length).fill(0),md=Array(r.length).fill(0);for(let i=1;i<r.length;i++){const up=r[i].h-r[i-1].h,dn=r[i-1].l-r[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c))}let ts=0,ps=0,ms=0;for(let i=1;i<=p&&i<r.length;i++){ts+=tr[i];ps+=pd[i];ms+=md[i]}const dx=Array(r.length).fill(NaN);for(let i=p;i<r.length;i++){if(i>p){ts=ts-ts/p+tr[i];ps=ps-ps/p+pd[i];ms=ms-ms/p+md[i]}if(ts>0){const a=100*ps/ts,b=100*ms/ts;if(a+b>0)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0,last=NaN;for(let i=p;i<r.length;i++){if(!Number.isFinite(dx[i]))continue;if(n<p){seed+=dx[i];n++;if(n===p)last=o[i]=seed/p}else last=o[i]=(last*(p-1)+dx[i])/p}return o}
function adxPro(r,p=14){const o=Array(r.length).fill(NaN),tr=[],pd=[],md=[];for(let i=1;i<r.length;i++){const up=r[i].h-r[i-1].h,dn=r[i-1].l-r[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c))}for(let i=p*2;i<r.length;i++){const dx=[];for(let k=i-p+1;k<=i;k++){let ts=0,ps=0,ms=0;for(let j=Math.max(1,k-p+1);j<=k;j++){ts+=tr[j]||0;ps+=pd[j]||0;ms+=md[j]||0}const pi=ts?100*ps/ts:0,mi=ts?100*ms/ts:0;dx.push(pi+mi?100*Math.abs(pi-mi)/(pi+mi):0)}o[i]=dx.reduce((a,b)=>a+b,0)/dx.length}return o}
function agg(r,ms){const a=[];let z;for(const b of r){const t=Math.floor(b.t/ms)*ms;if(!z||z.t!==t){z={t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v};a.push(z)}else{z.h=Math.max(z.h,b.h);z.l=Math.min(z.l,b.l);z.c=b.c;z.v+=b.v}}return a}
function before(a,t){let lo=0,hi=a.length-1,z=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m].t<t){z=m;lo=m+1}else hi=m-1}return z}
function exitFixed(M,i,side,e,sl,tp,max){for(let j=i+1;j<=Math.min(i+max,M.length-1);j++){const hs=side==='BUY'?M[j].l<=sl:M[j].h>=sl,ht=side==='BUY'?M[j].h>=tp:M[j].l<=tp;if(hs&&ht)return{r:-1,end:j,won:false};if(hs)return{r:-1,end:j,won:false};if(ht)return{r:Math.abs(tp-e)/Math.abs(e-sl),end:j,won:true}}const j=Math.min(i+max,M.length-1),r=(side==='BUY'?M[j].c-e:e-M[j].c)/Math.abs(e-sl);return{r,end:j,won:r>0}}
function push(a,i,side,x,t,risk){if(t>=FROM.getTime()&&t<=TO.getTime()&&Number.isFinite(x?.r))a.push({i,side,r:x.r,t,end:x.end,won:x.won,risk:Number(risk)||0})}
function stat(a){let w=0,gp=0,gl=0,eq=0,pk=0,dd=0;for(const x of a){if(x.r>0){w++;gp+=x.r}else if(x.r<0)gl-=x.r;eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{t:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?99:0),n:eq,dd}}
function print(n,a){const f=s=>`T${s.t} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} N${s.n>=0?'+':''}${s.n.toFixed(1)}R DD${s.dd.toFixed(1)}`;console.log(n.padEnd(12),'|',f(stat(a)),'| BUY',f(stat(a.filter(x=>x.side==='BUY'))),'| SELL',f(stat(a.filter(x=>x.side==='SELL'))))}
const {a:ALL,p}=load();let M=ALL.filter(x=>x.t>=FROM.getTime()-100*DAY&&x.t<=TO.getTime());const C=M.map(x=>x.c),R=rsi(C),E9=ema(C,9),E21=ema(C,21),E50A=emaAll(C,50),A=atrLive(M),AR=atrRapid(M),AP=atrPro(M),DW=adxW(M),DP=adxPro(M);
const H=agg(M,3600000),HC=H.map(x=>x.c),H20=ema(HC,20),H50=ema(HC,50),H200=ema(HC,200),HAR=atrRapid(H),HA=atrLive(H),HD=adxW(H);
const DY=agg(M,DAY),DC=DY.map(x=>x.c),DE50=ema(DC,50);
const EX=[],RA=[],GR=[],PR=[],SW=[],MI=[];let proDay='',proLoss=0,proCd=0;
for(let i=260;i<M.length-20;i++){const b=M[i],hr=new Date(b.t).getUTCHours(),dow=new Date(b.t).getUTCDay(),entry=M[i+1]?.o;if(!Number.isFinite(entry)||b.t<FROM.getTime()||b.t>TO.getTime())continue;
 // Exhaustion V3 exact live predicate; i is exhaustion bar, i+1 confirmation, entry proxy i+2 open.
 if(i+2<M.length&&[0,2,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].includes(hr)&&A[i]>0){const start=M[i-3].c,end=M[i-1].c,disp=end-start,side=disp<0?'BUY':disp>0?'SELL':null;if(side){const burst=side==='BUY'?2.15:2.6,rg=b.h-b.l,body=rg?Math.abs(b.c-b.o)/rg:99,adxMax=side==='SELL'?28:31,wick=side==='BUY'?(Math.min(b.o,b.c)-b.l)/rg:(b.h-Math.max(b.o,b.c))/rg;let agree=0;for(let k=i-3;k<i;k++){if(disp>0&&M[k].c>M[k].o)agree++;if(disp<0&&M[k].c<M[k].o)agree++}const cf=M[i+1],ret=side==='BUY'?.175:.15,good=side==='BUY'?(cf.c>b.l+rg*ret&&cf.l>=b.l-A[i]*.25):(cf.c<b.h-rg*ret&&cf.h<=b.h+A[i]*.25),e=M[i+2].o;if(Math.abs(disp)>=A[i]*burst&&agree>=2&&rg>0&&body<=(side==='SELL'?.55:.50)&&Number.isFinite(DW[i])&&DW[i]<=adxMax&&wick>=.30&&good&&Math.abs(e-cf.c)<=A[i]*.30)push(EX,i+1,side,exitFixed(M,i+1,side,e,side==='BUY'?e-10:e+10,side==='BUY'?e+12:e-12,3),cf.t,10)}}
 // Rapid V5 exact.
 if([0,1,3,4,5,7,8,9,10,11,13,14,15,16,17,21,23].includes(hr)&&AR[i]>0){const h=before(H,b.t);if(h>=52&&HAR[h]>0){const sep=Math.abs(H20[h]-H50[h])/HAR[h],bull=HC[h]>H20[h]&&H20[h]>H50[h]&&H20[h]>H20[h-2],bear=HC[h]<H20[h]&&H20[h]<H50[h]&&H20[h]<H20[h-2],hi=Math.max(...M.slice(i-3,i).map(x=>x.h)),lo=Math.min(...M.slice(i-3,i).map(x=>x.l)),rg=b.h-b.l,body=Math.abs(b.c-b.o),pos=rg?(b.c-b.l)/rg:.5;let side=bull&&b.c>hi&&pos>=.79&&b.c>E21[i]?'BUY':bear&&b.c<lo&&pos<=.15&&b.c<E21[i]?'SELL':null;if(side&&sep>=(side==='BUY'?.10:.06)&&body/AR[i]>=.60&&rg/AR[i]<=2&&Math.abs(b.c-E21[i])/AR[i]<=1.2&&!(side==='BUY'&&[3,16,17].includes(hr))&&Math.abs(entry-b.c)<=AR[i]*.3){const swing=side==='BUY'?Math.min(b.l,M[i-1].l):Math.max(b.h,M[i-1].h),base=Math.max(AR[i]*.65,Math.abs(entry-swing));if(base<=AR[i]*1.35){const risk=base*(side==='BUY'?.90:1.05),td=base*(side==='BUY'?.85*.90:.8*.85);push(RA,i,side,exitFixed(M,i,side,entry,side==='BUY'?entry-risk:entry+risk,side==='BUY'?entry+td:entry-td,10),b.t,risk)}}}
 // Grok92 exact.
 if(A[i]>0){const up=E9[i-1]<=E21[i-1]&&E9[i]>E21[i],dn=E9[i-1]>=E21[i-1]&&E9[i]<E21[i];let side=up&&R[i]>52?'BUY':dn&&R[i]<48?'SELL':null;const gapMin=.02;if(side&&Math.abs(E9[i]-E21[i])/A[i]>=gapMin){const va=M.slice(i-20,i).reduce((s,x)=>s+x.v,0)/20,h=before(H,b.t),volMin=side==='BUY'?1.25:1.00,adxMin=side==='BUY'?20:22,distMin=side==='BUY'?.40:.15;if(va>0&&b.v>=va*volMin&&h>=229&&HD[h]>=adxMin&&HA[h]>0){const bias=HC[h]>H200[h]?'BUY':HC[h]<H200[h]?'SELL':null;if(side===bias&&Math.abs(HC[h]-H200[h])/HA[h]>=distMin){const base=A[i]*1.5,risk=base*1.225,td=base*.8*(side==='BUY'?.90:.85);push(GR,i,side,exitFixed(M,i,side,entry,side==='BUY'?entry-risk:entry+risk,side==='BUY'?entry+td:entry-td,24),b.t,risk)}}}}
 // Pro exact signal filters + live state: 2 losses/day, 180m cooldown after a loss.
 {const ds=new Date(b.t).toISOString().slice(0,10);if(ds!==proDay){proDay=ds;proLoss=0}if(proLoss<2&&b.t>=proCd&&AP[i]>0){const d=before(DY,b.t),bias=d>=50?(DC[d]>DE50[d]?'BUY':'SELL'):null;let side=R[i-1]>=45&&R[i]<45&&bias==='BUY'?'BUY':R[i-1]<=55&&R[i]>55&&bias==='SELL'?'SELL':null;if(side&&!(hr===1||hr===6||hr===8||(hr>=14&&hr<=19)||(dow===3&&hr>=17&&hr<=20))){const prior=AP.slice(i-50,i).filter(Number.isFinite),avg=prior.length===50?prior.reduce((a,x)=>a+x,0)/50:null,ratio=avg?AP[i]/avg:null,rg=b.h-b.l,body=rg?Math.abs(b.c-b.o)/rg:0,mom=i>=36?(b.c-M[i-36].c)/AP[i]:null,ok=side==='BUY'?(DP[i]>=20&&ratio>=.40&&ratio<=1.30&&body>=.55&&mom!==null&&mom>=-25):(DP[i]>=18&&ratio>=.75&&ratio<=1.30&&body>=.45);if(ok){const risk=side==='BUY'?14:12,sl=side==='BUY'?entry-risk:entry+risk;let x=null;for(let j=i+1;j<=Math.min(i+288,M.length-1);j++){if((side==='BUY'&&M[j].l<=sl)||(side==='SELL'&&M[j].h>=sl)){x={r:-1,end:j,won:false};break}if((side==='BUY'&&R[j]>=54)||(side==='SELL'&&R[j]<=50)){const rr=(side==='BUY'?M[j].c-entry:entry-M[j].c)/risk;x={r:rr,end:j,won:rr>0};break}}if(!x){const j=Math.min(i+288,M.length-1),rr=(side==='BUY'?M[j].c-entry:entry-M[j].c)/risk;x={r:rr,end:j,won:rr>0}}push(PR,i,side,x,b.t,risk);if(!x.won){proLoss++;proCd=M[x.end]?.t+180*60000}}}}}}
 // Sweep5 exact.
 if([9,10,11,12,17].includes(hr)&&A[i]>0){const ph=Math.max(...M.slice(i-6,i).map(x=>x.h)),rg=b.h-b.l,uw=rg?(b.h-Math.max(b.o,b.c))/rg:0,pm=Math.abs(M[i-1].c-M[i-3].c);if(rg>0&&b.h>=ph+A[i]*.04&&b.c<ph&&b.c<b.o&&uw>=.60&&pm>=A[i]*.50)push(SW,i,'SELL',exitFixed(M,i,'SELL',entry,entry+5,entry-5,4),b.t,5)}
 // Micro exact: BUY-only, all day except 16/17/20/21, 2ATR SL, 1:1, 10 bars.
 if(![16,17,20,21].includes(hr)&&A[i]>0){const EA9=emaAll(C,9),EA21=emaAll(C,21); /* values match live all-bar EMA */ const rg=b.h-b.l,body=Math.abs(b.c-b.o);if(rg>0&&body/rg>=.65&&Math.abs(EA9[i]-EA21[i])/A[i]>=.15&&EA9[i]>EA21[i]&&EA21[i]>E50A[i]&&EA21[i]>EA21[i-3]){const is=i-4,ie=i-2,imp=M[ie].c-M[is].o;if(imp>=1.2*A[i]){let pl=Infinity;for(let j=ie+1;j<i;j++)pl=Math.min(pl,M[j].l);const retr=(M[ie].c-pl)/imp,pos=(b.c-b.l)/rg;if(retr>=.12&&retr<=.35&&pos>=.78&&b.c>M[i-1].h){const risk=2*A[i];push(MI,i,'BUY',exitFixed(M,i,'BUY',entry,entry-risk,entry+risk,10),b.t,risk)}}}}
}

console.log('\n🧪 MICRO OPTIMIZER — CURRENT LIVE MICRO BASELINE');
console.log(`${FROM.toISOString()} -> ${TO.toISOString()} | M5=${M.length} | ${p}`);
console.log('Research-only optimizer. Live files are NOT changed. Baseline entry/SL/TP stays identical to current Micro.');

const EA9=emaAll(C,9),EA21=emaAll(C,21);
const candidates=[];
for(let i=260;i<M.length-20;i++){
 const b=M[i],hr=new Date(b.t).getUTCHours(),entry=M[i+1]?.o;
 if(!Number.isFinite(entry)||b.t<FROM.getTime()||b.t>TO.getTime()||[16,17,20,21].includes(hr)||!(A[i]>0))continue;
 const rg=b.h-b.l,body=Math.abs(b.c-b.o);
 if(!(rg>0&&body/rg>=.65&&Math.abs(EA9[i]-EA21[i])/A[i]>=.15&&EA9[i]>EA21[i]&&EA21[i]>E50A[i]&&EA21[i]>EA21[i-3]))continue;
 const is=i-4,ie=i-2,imp=M[ie].c-M[is].o;
 if(!(imp>=1.2*A[i]))continue;
 let pl=Infinity;for(let j=ie+1;j<i;j++)pl=Math.min(pl,M[j].l);
 const retr=(M[ie].c-pl)/imp,pos=(b.c-b.l)/rg;
 if(!(retr>=.12&&retr<=.35&&pos>=.78&&b.c>M[i-1].h))continue;
 const risk=2*A[i],x=exitFixed(M,i,'BUY',entry,entry-risk,entry+risk,10);
 const h=before(H,b.t);
 candidates.push({i,t:b.t,hr,r:x.r,won:x.won,
   rsi:R[i],adx:DW[i],atr:A[i],atrRatio:i>=50?A[i]/(A.slice(i-50,i).filter(Number.isFinite).reduce((s,v)=>s+v,0)/(A.slice(i-50,i).filter(Number.isFinite).length||1)):NaN,
   emaGap:Math.abs(EA9[i]-EA21[i])/A[i],bodyRatio:body/rg,impulse:imp/A[i],retr,pos,
   hAdx:h>=0?HD[h]:NaN,hSlope:h>=3&&HA[h]>0?(H20[h]-H20[h-3])/HA[h]:NaN,
   hDist:h>=0&&HA[h]>0?Math.abs(HC[h]-H20[h])/HA[h]:NaN});
}
function S(a){let w=0,gp=0,gl=0,eq=0,pk=0,dd=0;for(const x of [...a].sort((x,y)=>x.t-y.t)){if(x.r>0){w++;gp+=x.r}else if(x.r<0)gl-=x.r;eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{t:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?99:0),net:eq,dd}}
const b=S(candidates);
console.log(`BASELINE | T${b.t} WR${b.wr.toFixed(1)} PF${b.pf.toFixed(2)} N${b.net>=0?'+':''}${b.net.toFixed(2)}R DD${b.dd.toFixed(2)}R`);

const filters=[];
function test(name,fn){const a=candidates.filter(fn),s=S(a);if(a.length>=Math.max(80,Math.floor(b.t*.55)))filters.push({name,...s,kept:100*a.length/b.t})}
for(const v of [50,52,54,56,58,60])test(`RSI>=${v}`,x=>x.rsi>=v);
for(const v of [15,18,20,22,24,26])test(`ADX>=${v}`,x=>x.adx>=v);
for(const v of [.18,.20,.22,.25,.28,.30,.35])test(`EMA_GAP>=${v}`,x=>x.emaGap>=v);
for(const v of [.68,.70,.72,.75,.78])test(`BODY>=${v}`,x=>x.bodyRatio>=v);
for(const v of [1.3,1.4,1.5,1.6,1.8,2.0])test(`IMPULSE>=${v}ATR`,x=>x.impulse>=v);
for(const v of [.80,.82,.85,.88,.90])test(`CLOSE_POS>=${v}`,x=>x.pos>=v);
for(const v of [.8,.9,1.0,1.1,1.2,1.3])test(`ATR_RATIO>=${v}`,x=>Number.isFinite(x.atrRatio)&&x.atrRatio>=v);
for(const v of [15,18,20,22,24,26])test(`H1_ADX>=${v}`,x=>Number.isFinite(x.hAdx)&&x.hAdx>=v);
for(const v of [-.10,-.05,0,.03,.05,.08,.10])test(`H1_SLOPE>=${v}`,x=>Number.isFinite(x.hSlope)&&x.hSlope>=v);
for(const v of [.2,.3,.4,.5,.6,.8,1.0])test(`H1_DIST<=${v}`,x=>Number.isFinite(x.hDist)&&x.hDist<=v);
for(const h of [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,18,19,22,23])test(`BLOCK_HOUR_${String(h).padStart(2,'0')}`,x=>x.hr!==h);

const singles=[...filters].sort((a,b)=>(b.net-a.net)||(b.pf-a.pf)||(b.wr-a.wr)).slice(0,15);
console.log('\n🏆 TOP SINGLE FILTERS — ranked by Net R, then PF/WR');
for(let i=0;i<singles.length;i++){const z=singles[i];console.log(`${String(i+1).padStart(2)} | ${z.name.padEnd(18)} | T${z.t} Keep${z.kept.toFixed(0)}% WR${z.wr.toFixed(1)} PF${z.pf.toFixed(2)} N${z.net>=0?'+':''}${z.net.toFixed(2)}R DD${z.dd.toFixed(2)}R`)}

const atoms=[
 ...[52,54,56,58].map(v=>({n:`RSI>=${v}`,f:x=>x.rsi>=v})),
 ...[18,20,22,24].map(v=>({n:`ADX>=${v}`,f:x=>x.adx>=v})),
 ...[.20,.22,.25,.28].map(v=>({n:`GAP>=${v}`,f:x=>x.emaGap>=v})),
 ...[.70,.72,.75].map(v=>({n:`BODY>=${v}`,f:x=>x.bodyRatio>=v})),
 ...[1.3,1.4,1.5,1.6].map(v=>({n:`IMP>=${v}`,f:x=>x.impulse>=v})),
 ...[18,20,22].map(v=>({n:`HADX>=${v}`,f:x=>Number.isFinite(x.hAdx)&&x.hAdx>=v})),
 ...[-.05,0,.03,.05].map(v=>({n:`HSLOPE>=${v}`,f:x=>Number.isFinite(x.hSlope)&&x.hSlope>=v}))
];
const combos=[];
for(let i=0;i<atoms.length;i++)for(let j=i+1;j<atoms.length;j++){
 const a=candidates.filter(x=>atoms[i].f(x)&&atoms[j].f(x)),s=S(a);
 if(a.length>=100)combos.push({name:`${atoms[i].n} + ${atoms[j].n}`,...s,kept:100*a.length/b.t});
}
combos.sort((a,b)=>(b.net-a.net)||(b.pf-a.pf)||(b.wr-a.wr));
console.log('\n🥇 TOP 20 TWO-FILTER COMBOS — minimum 100 trades');
for(let i=0;i<Math.min(20,combos.length);i++){const z=combos[i];console.log(`${String(i+1).padStart(2)} | ${z.name.padEnd(30)} | T${z.t} Keep${z.kept.toFixed(0)}% WR${z.wr.toFixed(1)} PF${z.pf.toFixed(2)} N${z.net>=0?'+':''}${z.net.toFixed(2)}R DD${z.dd.toFixed(2)}R`)}

console.log('\n🎯 WR-FIRST CANDIDATES — WR>=63%, T>=100, ranked by Net R');
const wr=[...filters,...combos].filter(x=>x.wr>=63&&x.t>=100).sort((a,b)=>(b.net-a.net)||(b.pf-a.pf));
if(!wr.length)console.log('No candidate met WR>=63% with at least 100 trades.');
else for(let i=0;i<Math.min(15,wr.length);i++){const z=wr[i];console.log(`${String(i+1).padStart(2)} | ${z.name.padEnd(30)} | T${z.t} WR${z.wr.toFixed(1)} PF${z.pf.toFixed(2)} N${z.net>=0?'+':''}${z.net.toFixed(2)}R DD${z.dd.toFixed(2)}R`)}


console.log('\nDo not promote a filter from this optimizer directly to live. Validate the shortlist on a separate holdout/time split first.');

console.log('\n🧪 STAGE 2 — MARKET FILTER HOLDOUT CHECK');
const split2=FROM.getTime()+(TO.getTime()-FROM.getTime())*.70,dev2=candidates.filter(x=>x.t<=split2),hold2=candidates.filter(x=>x.t>split2);
console.log('DEV 70% | '+JSON.stringify(S(dev2)));
console.log('HOLDOUT 30% | '+JSON.stringify(S(hold2)));
const stage2=[
 ['ADX20_BODY72',x=>x.adx>=20&&x.bodyRatio>=.72],
 ['ADX20_BODY75',x=>x.adx>=20&&x.bodyRatio>=.75],
 ['ADX20_HADX20',x=>x.adx>=20&&x.hAdx>=20],
 ['ADX18_BODY75',x=>x.adx>=18&&x.bodyRatio>=.75],
 ['ADX20_BODY72_HADX20',x=>x.adx>=20&&x.bodyRatio>=.72&&x.hAdx>=20],
 ['ADX20_BODY72_HSLOPE0',x=>x.adx>=20&&x.bodyRatio>=.72&&x.hSlope>=0],
 ['ADX20_HADX20_HSLOPE0',x=>x.adx>=20&&x.hAdx>=20&&x.hSlope>=0],
 ['BODY72_HADX20_HSLOPE0',x=>x.bodyRatio>=.72&&x.hAdx>=20&&x.hSlope>=0],
 ['ADX18_BODY72_HADX20',x=>x.adx>=18&&x.bodyRatio>=.72&&x.hAdx>=20],
 ['ADX20_GAP20_BODY72',x=>x.adx>=20&&x.emaGap>=.20&&x.bodyRatio>=.72],
 ['ADX20_IMP14_BODY72',x=>x.adx>=20&&x.impulse>=1.4&&x.bodyRatio>=.72],
 ['ADX20_ATRREL09_BODY72',x=>x.adx>=20&&x.atrRatio>=.9&&x.bodyRatio>=.72]
];
const rows2=stage2.map(([name,fn])=>({name,dev:S(dev2.filter(fn)),hold:S(hold2.filter(fn)),all:S(candidates.filter(fn))}))
 .sort((a,b)=>b.dev.n-a.dev.n);
function L2(z){return 'T'+z.t+' WR'+z.wr.toFixed(1)+' PF'+z.pf.toFixed(2)+' N'+(z.n>=0?'+':'')+z.n.toFixed(2)+'R DD'+z.dd.toFixed(2)+'R'}
for(const z of rows2){console.log('\n'+z.name);console.log(' DEV  '+L2(z.dev));console.log(' HOLD '+L2(z.hold));console.log(' ALL  '+L2(z.all))}
console.log('\n🛡️ STAGE 2 ROBUST: DEV WR>=63/PF>=1.90 and HOLD positive/PF>=1.50');
const robust2=rows2.filter(z=>z.dev.wr>=63&&z.dev.pf>=1.90&&z.hold.t>=20&&z.hold.n>0&&z.hold.pf>=1.50);
if(!robust2.length)console.log('NONE — keep Micro unchanged.');
else for(const z of robust2)console.log(z.name+' | DEV '+L2(z.dev)+' | HOLD '+L2(z.hold)+' | ALL '+L2(z.all));

