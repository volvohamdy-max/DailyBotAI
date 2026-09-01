'use strict';
// Refine the discovered 2-red BUY family using continuous candle relations.
// Pure M5 price action, no hour/session/indicators. Strict TP=SL=1 ATR, 12 bars.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const c=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
function atr(p=14){const a=new Float64Array(c.length);let q=[],s=0;for(let i=1;i<c.length;i++){const v=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(v);s+=v;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
function feat(i){const x=c[i-1],y=c[i],a=A[i],r1=x.h-x.l,r2=y.h-y.l;if(!(a>0&&r1>0&&r2>0)||x.c>=x.o||y.c>=y.o)return null;return{b1:Math.abs(x.c-x.o)/r1,l1:(Math.min(x.o,x.c)-x.l)/r1,u1:(x.h-Math.max(x.o,x.c))/r1,b2:Math.abs(y.c-y.o)/r2,l2:(Math.min(y.o,y.c)-y.l)/r2,u2:(y.h-Math.max(y.o,y.c))/r2,ratio:r2/r1,breakLow:(x.l-y.l)/a,closeBelow:(x.l-y.c)/a,highBelow:(x.h-y.h)/a,cp2:(y.c-y.l)/r2}}
function outcome(i){const a=A[i],e=c[i].c,sl=e-a,tp=e+a;for(let k=i+1;k<=i+12;k++){if(c[k].l<=sl)return-1;if(c[k].h>=tp)return 1}return 0}
const rows=[];for(let i=30;i<c.length-13;i++){const f=feat(i);if(f)rows.push({i,t:c[i].t,f,y:outcome(i)})}
const t1=c[Math.floor(c.length*.6)].t,t2=c[Math.floor(c.length*.8)].t;
const pools={D:rows.filter(x=>x.t<t1),V:rows.filter(x=>x.t>=t1&&x.t<t2),H:rows.filter(x=>x.t>=t2)};
const atoms=[
 ['b1','<=',[.2,.3,.4,.5]],['l1','>=',[.3,.4,.5,.6]],['u1','<=',[.15,.25,.35,.45]],
 ['b2','>=',[.35,.45,.55,.65]],['l2','<=',[.15,.25,.35,.45]],['u2','<=',[.15,.25,.35,.45]],
 ['ratio','>=',[.7,.9,1.1,1.3]],['ratio','<=',[1.2,1.5,1.8,2.2]],['breakLow','>=',[0,.05,.1,.2,.3]],
 ['closeBelow','>=',[0,.05,.1,.2]],['highBelow','>=',[-.5,-.25,0,.15]],['cp2','<=',[.25,.4,.55]]
];
const all=[];for(const[k,op,vs]of atoms)for(const v of vs)all.push({k,op,v});
function pass(f,a){return a.op==='>='?f[a.k]>=a.v:f[a.k]<=a.v}
function stats(pool,r){let w=0,l=0,to=0;for(const x of pool){let ok=1;for(const a of r)if(!pass(x.f,a)){ok=0;break}if(!ok)continue;if(x.y===1)w++;else if(x.y===-1)l++;else to++}const n=w+l;return{n,w,l,to,wr:n?100*w/n:0,pf:l?w/l:99,net:w-l}}
// deterministic candidate enumeration: one-, two-, and selected three-condition families.
const rules=[];for(let i=0;i<all.length;i++){rules.push([all[i]]);for(let j=i+1;j<all.length;j++){if(all[i].k===all[j].k)continue;rules.push([all[i],all[j]])}}
// Add 20k deterministic 3-atom combinations, unique feature names.
let seed=24051986;const rnd=()=>{seed=(seed+0x6D2B79F5)|0;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};
for(let z=0;z<20000;z++){const r=[];while(r.length<3){const a=all[Math.floor(rnd()*all.length)];if(!r.some(x=>x.k===a.k))r.push(a)}rules.push(r)}
console.log(`🧪 TWO-RED REVERSAL REFINER | ${rows.length} base occurrences | ${rules.length} rules`);
const best=[];for(const r of rules){const d=stats(pools.D,r);if(d.n<100||d.wr<58||d.pf<1.35)continue;const v=stats(pools.V,r);if(v.n<30||v.wr<57||v.net<=0)continue;const h=stats(pools.H,r);best.push({r,d,v,h,score:v.wr*4+d.wr+Math.log10(d.n+v.n)*3})}best.sort((a,b)=>b.score-a.score);
console.log('\n🔥 GOLD TWO-RED REVERSAL — NEIGHBORHOOD SEARCH | STRICT RR 1:1 | NO TIME\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if(!best.length){console.log('NO ROBUST NEIGHBORHOOD PASSED GATE');process.exit(0)}
const fmt=s=>`T${s.n} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} ${s.net>=0?'+':''}${s.net}R TO${s.to}`;
best.slice(0,30).forEach((x,i)=>{console.log(`${i+1} | DISC ${fmt(x.d)} | VAL ${fmt(x.v)} | HOLD ${fmt(x.h)}`);console.log('   '+x.r.map(a=>`${a.k}${a.op}${a.v}`).join(' + '))});