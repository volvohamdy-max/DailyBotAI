'use strict';
/**
 * PRO BUY core optimizer. Research-only: does not import or modify live strategy.
 * Mirrors PRO live signal, exits and state; varies BUY ADX/ATR/body/momentum only.
 */
const fs=require('fs'),path=require('path'),N=Number,DAY=86400000;
const FROM=new Date(process.env.BACKTEST_FROM||Date.now()-365*DAY),TO=new Date(process.env.BACKTEST_TO||Date.now());
function norm(raw){let a=(raw||[]).map(x=>({t:N(x.timestamp??x.time??x.date),o:N(x.open??x.o),h:N(x.high??x.h),l:N(x.low??x.l),c:N(x.close??x.c),v:N(x.volume??x.v??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);if(a[0]?.t<1e12)a.forEach(x=>x.t*=1000);return a}
function load(){for(const f of [process.env.BACKTEST_FILE,'xauusd-m5-dukascopy.json','xauusd-m5.json'].filter(Boolean)){const p=path.join(__dirname,'../data',f);if(fs.existsSync(p)){const z=JSON.parse(fs.readFileSync(p,'utf8')),a=norm(Array.isArray(z)?z:z.candles||z.data||z.values||[]);if(a.length>1000)return{a,p}}}throw Error('XAUUSD M5 JSON not found')}
function ema(v,p){const o=Array(v.length).fill(NaN),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function rsi(v,p=14){const o=Array(v.length).fill(NaN);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const x=v[j]-v[j-1];gs+=Math.max(x,0);ls+=Math.max(-x,0)}ag=gs/p;al=ls/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}
function atr(r,p=14){const o=Array(r.length).fill(NaN),tr=[];for(let i=0;i<r.length;i++){const pc=i?r[i-1].c:r[i].c;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-pc),Math.abs(r[i].l-pc));if(i>=p-1)o[i]=tr.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p}return o}
function adx(r,p=14){const o=Array(r.length).fill(NaN),tr=[],pd=[],md=[];for(let i=1;i<r.length;i++){const up=r[i].h-r[i-1].h,dn=r[i-1].l-r[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(r[i].h-r[i].l,Math.abs(r[i].h-r[i-1].c),Math.abs(r[i].l-r[i-1].c))}for(let i=p*2;i<r.length;i++){const dx=[];for(let k=i-p+1;k<=i;k++){let ts=0,ps=0,ms=0;for(let j=Math.max(1,k-p+1);j<=k;j++){ts+=tr[j]||0;ps+=pd[j]||0;ms+=md[j]||0}const pi=ts?100*ps/ts:0,mi=ts?100*ms/ts:0;dx.push(pi+mi?100*Math.abs(pi-mi)/(pi+mi):0)}o[i]=dx.reduce((a,b)=>a+b,0)/dx.length}return o}
function agg(r,ms){const a=[];let z;for(const b of r){const t=Math.floor(b.t/ms)*ms;if(!z||z.t!==t){z={t,o:b.o,h:b.h,l:b.l,c:b.c};a.push(z)}else{z.h=Math.max(z.h,b.h);z.l=Math.min(z.l,b.l);z.c=b.c}}return a}
function before(a,t){let lo=0,hi=a.length-1,z=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m].t<t){z=m;lo=m+1}else hi=m-1}return z}
function stat(a){let w=0,gp=0,gl=0,eq=0,pk=0,dd=0;for(const x of a){if(x.r>0){w++;gp+=x.r}else if(x.r<0)gl-=x.r;eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{t:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?99:0),n:eq,dd}}
const fmt=s=>`T${s.t} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} N${s.n>=0?'+':''}${s.n.toFixed(2)}R DD${s.dd.toFixed(2)}`;
const {a:ALL,p}=load(),M=ALL.filter(x=>x.t>=FROM.getTime()-100*DAY&&x.t<=TO.getTime()),C=M.map(x=>x.c),R=rsi(C),A=atr(M),D=adx(M),DY=agg(M,DAY),DC=DY.map(x=>x.c),DE=ema(DC,50);
const base=[];
for(let i=260;i<M.length-289;i++){const b=M[i],hr=new Date(b.t).getUTCHours(),dow=new Date(b.t).getUTCDay();if(b.t<FROM.getTime()||b.t>TO.getTime()||!A[i])continue;const d=before(DY,b.t),bias=d>=50?(DC[d]>DE[d]?'BUY':'SELL'):null;if(!(R[i-1]>=45&&R[i]<45&&bias==='BUY'))continue;if(hr===1||hr===6||hr===8||(hr>=14&&hr<=19)||(dow===3&&hr>=17&&hr<=20))continue;const prior=A.slice(i-50,i).filter(Number.isFinite),avg=prior.length===50?prior.reduce((a,x)=>a+x,0)/50:null,ar=avg?A[i]/avg:null,rg=b.h-b.l,body=rg?Math.abs(b.c-b.o)/rg:0,mom=i>=36?(b.c-M[i-36].c)/A[i]:null;if(ar===null||mom===null||!Number.isFinite(D[i]))continue;base.push({i,t:b.t,adx:D[i],ar,body,mom})}
function replay(q){const out=[];let day='',loss=0,cd=0;for(const s of base){const ds=new Date(s.t).toISOString().slice(0,10);if(ds!==day){day=ds;loss=0}if(loss>=2||s.t<cd)continue;if(s.adx<q.adx||s.ar<q.amin||s.ar>q.amax||s.body<q.body||s.mom<q.mom)continue;const e=M[s.i+1].o,sl=e-14;let x=null;for(let j=s.i+1;j<=Math.min(s.i+288,M.length-1);j++){if(M[j].l<=sl){x={r:-1,end:j};break}if(R[j]>=54){x={r:(M[j].c-e)/14,end:j};break}}if(!x){const j=Math.min(s.i+288,M.length-1);x={r:(M[j].c-e)/14,end:j}}out.push({t:s.t,r:x.r});if(x.r<=0){loss++;cd=M[x.end].t+180*60000}}return out}
const live={adx:20,amin:.50,amax:1.30,body:.55,mom:-25},L=replay(live),LS=stat(L),mid=(FROM.getTime()+TO.getTime())/2;
console.log('\nPRO BUY — CORE OPTIMIZER');console.log(`${FROM.toISOString()} -> ${TO.toISOString()} | ${p}`);console.log('LIVE | '+fmt(LS)+' | H1 '+fmt(stat(L.filter(x=>x.t<=mid)))+' | H2 '+fmt(stat(L.filter(x=>x.t>mid))));
const rows=[];for(const adxv of [18,20,22,24,26])for(const amin of [.40,.50,.60,.70])for(const amax of [1.15,1.30,1.45])for(const body of [.45,.50,.55,.60,.65])for(const mom of [-30,-25,-20,-15,-10]){const q={adx:adxv,amin,amax,body,mom},a=replay(q),s=stat(a);if(s.t<Math.max(120,LS.t*.65))continue;const h1=stat(a.filter(x=>x.t<=mid)),h2=stat(a.filter(x=>x.t>mid));rows.push({q,a,s,h1,h2})}
rows.sort((a,b)=>(b.s.n-a.s.n)||(b.s.pf-a.s.pf)||(a.s.dd-b.s.dd));
console.log('\nTOP 30 — NET (trade-preserving floor)');rows.slice(0,30).forEach((x,k)=>console.log(`${k+1} | ADX>=${x.q.adx} ATR${x.q.amin}-${x.q.amax} BODY>=${x.q.body} MOM>=${x.q.mom} | ${fmt(x.s)} | H1 ${fmt(x.h1)} | H2 ${fmt(x.h2)}`));
rows.sort((a,b)=>((b.s.pf*10+b.s.n-b.s.dd)-(a.s.pf*10+a.s.n-a.s.dd)));
console.log('\nTOP 20 — BALANCED');rows.slice(0,20).forEach((x,k)=>console.log(`${k+1} | ADX>=${x.q.adx} ATR${x.q.amin}-${x.q.amax} BODY>=${x.q.body} MOM>=${x.q.mom} | ${fmt(x.s)} | H1 ${fmt(x.h1)} | H2 ${fmt(x.h2)}`));

console.log('\nPRO BUY — QUALITY / ROBUST SHORTLIST');
const months=[...new Set(L.map(x=>new Date(x.t).toISOString().slice(0,7)))];
function monthly(a){return months.map(m=>({m,s:stat(a.filter(x=>new Date(x.t).toISOString().slice(0,7)===m))}))}
const lm=monthly(L),rob=[];
for(const x of rows){if(x.s.t<LS.t||x.s.pf<LS.pf||x.s.dd>LS.dd)continue;const cm=monthly(x.a);let better=0,worse=0,tie=0,worst=Infinity;for(let j=0;j<months.length;j++){const d=cm[j].s.n-lm[j].s.n;worst=Math.min(worst,d);if(d>.05)better++;else if(d<-.05)worse++;else tie++}rob.push({...x,better,worse,tie,worst})}
rob.sort((a,b)=>((b.better-b.worse)-(a.better-a.worse))||(b.s.n-a.s.n)||(b.s.pf-a.s.pf)||(a.s.dd-b.s.dd));
if(!rob.length)console.log('No candidate simultaneously keeps >= live trades, PF >= live, and DD <= live.');
else rob.slice(0,30).forEach((x,k)=>console.log(`${k+1} | ADX>=${x.q.adx} ATR${x.q.amin}-${x.q.amax} BODY>=${x.q.body} MOM>=${x.q.mom} | ${fmt(x.s)} | H1 ${fmt(x.h1)} | H2 ${fmt(x.h2)} | M +${x.better}/-${x.worse}/=${x.tie} | worst ${x.worst.toFixed(2)}R`));
