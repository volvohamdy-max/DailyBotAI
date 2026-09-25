'use strict';
/**
 * Exact-current-live-rules replay for the six strategies enabled by src/services/goldScalper.js.
 * Signal predicates/indicator math mirror the live files as of 2026-09-25.
 * Historical entry proxy: next M5 open (live uses getPrice); entry-gap gates are checked against that proxy.
 * Same-bar SL+TP => SL first (conservative).
 */
const fs=require('fs'),path=require('path');
const DAY=86400000,N=Number;
const FROM=new Date(process.env.BACKTEST_FROM||Date.now()-365*DAY),TO=new Date(process.env.BACKTEST_TO||Date.now());
function norm(raw){let a=(raw||[]).map(x=>({t:N(x.timestamp??x.time??x.date),o:N(x.open??x.o),h:N(x.high??x.h),l:N(x.low??x.l),c:N(x.close??x.c),v:N(x.volume??x.v??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);if(a[0]?.t<1e12)a.forEach(x=>x.t*=1000);return a}
function load(){for(const f of ['xauusd-m5-dukascopy.json','xauusd-m5.json']){const p=path.join(__dirname,'../data',f);if(fs.existsSync(p)){const z=JSON.parse(fs.readFileSync(p,'utf8')),a=norm(Array.isArray(z)?z:z.candles||z.data||z.values||[]);if(a.length>1000)return{a,p}}}throw Error('Local XAUUSD M5 JSON not found')}
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
function push(a,i,side,x,t){if(t>=FROM.getTime()&&t<=TO.getTime()&&Number.isFinite(x?.r))a.push({i,side,r:x.r,t,end:x.end,won:x.won})}
function stat(a){let w=0,gp=0,gl=0,eq=0,pk=0,dd=0;for(const x of a){if(x.r>0){w++;gp+=x.r}else if(x.r<0)gl-=x.r;eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{t:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?99:0),n:eq,dd}}
function print(n,a){const f=s=>`T${s.t} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} N${s.n>=0?'+':''}${s.n.toFixed(1)}R DD${s.dd.toFixed(1)}`;console.log(n.padEnd(12),'|',f(stat(a)),'| BUY',f(stat(a.filter(x=>x.side==='BUY'))),'| SELL',f(stat(a.filter(x=>x.side==='SELL'))))}
const {a:ALL,p}=load();let M=ALL.filter(x=>x.t>=FROM.getTime()-100*DAY&&x.t<=TO.getTime());const C=M.map(x=>x.c),R=rsi(C),E9=ema(C,9),E21=ema(C,21),E50A=emaAll(C,50),A=atrLive(M),AR=atrRapid(M),AP=atrPro(M),DW=adxW(M),DP=adxPro(M);
const H=agg(M,3600000),HC=H.map(x=>x.c),H20=ema(HC,20),H50=ema(HC,50),H200=ema(HC,200),HAR=atrRapid(H),HA=atrLive(H),HD=adxW(H);
const DY=agg(M,DAY),DC=DY.map(x=>x.c),DE50=ema(DC,50);

const EXC=[];
for(let i=260;i<M.length-5;i++){const b=M[i],hr=new Date(b.t).getUTCHours();if(!(A[i]>0)||i+2>=M.length)continue;
 const start=M[i-3].c,end=M[i-1].c,disp=end-start,side=disp<0?'BUY':disp>0?'SELL':null;if(!side)continue;
 const rg=b.h-b.l;if(!(rg>0))continue;let agree=0;for(let k=i-3;k<i;k++){if(disp>0&&M[k].c>M[k].o)agree++;if(disp<0&&M[k].c<M[k].o)agree++}
 const body=Math.abs(b.c-b.o)/rg,wick=side==='BUY'?(Math.min(b.o,b.c)-b.l)/rg:(b.h-Math.max(b.o,b.c))/rg,cf=M[i+1],confirmStrength=side==='BUY'?(cf.c-b.l)/rg:(b.h-cf.c)/rg,invalid=(side==='BUY'?(b.l-cf.l):(cf.h-b.h))/A[i],entry=M[i+2].o,gap=Math.abs(entry-cf.c)/A[i];
 if(agree<2||!Number.isFinite(DW[i])||!Number.isFinite(entry))continue;
 const burst=Math.abs(disp)/A[i],x=exitFixed(M,i+1,side,entry,side==='BUY'?entry-10:entry+10,side==='BUY'?entry+12:entry-12,3);
 if(cf.t>=FROM.getTime()&&cf.t<=TO.getTime())EXC.push({side,t:cf.t,r:x.r,won:x.won,end:x.end,m:{hr,burst,body,adx:DW[i],wick,confirm:confirmStrength,invalid,gap}});
}
function ef(s){return `T${s.t} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} N${s.n>=0?'+':''}${s.n.toFixed(2)}R DD${s.dd.toFixed(2)}`}
function pick(side,p){return EXC.filter(x=>x.side===side&&p.hours.includes(x.m.hr)&&x.m.burst>=p.burst&&x.m.body<=p.body&&x.m.adx<=p.adx&&x.m.wick>=p.wick&&x.m.confirm>p.retrace&&x.m.invalid<=.25&&x.m.gap<=.30)}
const mid=FROM.getTime()+Math.floor((TO.getTime()-FROM.getTime())/2),hours=[0,2,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
console.log('\nEXHAUSTION V3 — CORE FILTER OPTIMIZER (research only; live unchanged)');
for(const side of ['BUY','SELL']){
 const live={hours,burst:side==='BUY'?2.2:2.6,body:side==='BUY'?.50:.55,adx:side==='BUY'?32:28,wick:.30,retrace:.15};
 const ba=pick(side,live);console.log('\n'+side+' LIVE BASE | '+ef(stat(ba))+' | H1 '+ef(stat(ba.filter(x=>x.t<=mid)))+' | H2 '+ef(stat(ba.filter(x=>x.t>mid))));
 const rows=[];
 for(const burst of (side==='BUY'?[1.8,2.0,2.2,2.4,2.6]:[2.0,2.2,2.4,2.6,2.8]))
 for(const body of [.40,.45,.50,.55,.60])
 for(const adx of [24,26,28,30,32,34])
 for(const wick of [.25,.30,.35,.40])
 for(const retrace of [.10,.15,.20,.25]){
  const p={hours,burst,body,adx,wick,retrace},a=pick(side,p);if(a.length<25)continue;const s=stat(a),h1=stat(a.filter(x=>x.t<=mid)),h2=stat(a.filter(x=>x.t>mid));if(h1.t<8||h2.t<8)continue;rows.push({p,...s,h1,h2});
 }
 rows.sort((a,b)=>b.n-a.n||b.pf-a.pf||a.dd-b.dd).slice(0,25).forEach((s,k)=>console.log(`${String(k+1).padStart(2)} | BURST>=${s.p.burst.toFixed(1)} BODY<=${s.p.body.toFixed(2)} ADX<=${s.p.adx} WICK>=${s.p.wick.toFixed(2)} RET>${s.p.retrace.toFixed(2)} | ${ef(s)} | H1 ${ef(s.h1)} | H2 ${ef(s.h2)}`));
}

console.log('\nEXHAUSTION BUY — CANDIDATE #17 VALIDATION');
const buyLive={hours,burst:2.2,body:.50,adx:32,wick:.30,retrace:.15};
const variants=[
 ['LIVE',buyLive],
 ['BURST_ONLY',{...buyLive,burst:1.8}],
 ['ADX_ONLY',{...buyLive,adx:24}],
 ['RETRACE_ONLY',{...buyLive,retrace:.20}],
 ['BURST+ADX',{...buyLive,burst:1.8,adx:24}],
 ['BURST+RETRACE',{...buyLive,burst:1.8,retrace:.20}],
 ['ADX+RETRACE',{...buyLive,adx:24,retrace:.20}],
 ['CANDIDATE',{...buyLive,burst:1.8,adx:24,retrace:.20}]
];
for(const [name,p] of variants){const a=pick('BUY',p);console.log(name.padEnd(15)+' | '+ef(stat(a))+' | H1 '+ef(stat(a.filter(x=>x.t<=mid)))+' | H2 '+ef(stat(a.filter(x=>x.t>mid))))}
console.log('\nBUY MONTHLY — LIVE vs CANDIDATE');
const la=pick('BUY',buyLive),cp={...buyLive,burst:1.8,adx:24,retrace:.20},ca=pick('BUY',cp);
const months=[...new Set([...la,...ca].map(x=>new Date(x.t).toISOString().slice(0,7)))].sort();
for(const m of months){const l=stat(la.filter(x=>new Date(x.t).toISOString().startsWith(m))),v=stat(ca.filter(x=>new Date(x.t).toISOString().startsWith(m)));console.log(m+' | LIVE '+ef(l)+' | CAND '+ef(v))}
