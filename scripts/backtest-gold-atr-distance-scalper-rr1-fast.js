'use strict';
// Research reconstruction of the public XAUUSD ATR-distance scalper concept.
// NOT a copy of proprietary EA logic. Tests transparent variants on our data.
// Hard rule: TP = SL (1:1), no grid, martingale, averaging, or time/session filter.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const C=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
function atr(p){const a=Array(C.length).fill(NaN);let q=[],s=0;for(let i=1;i<C.length;i++){const v=Math.max(C[i].h-C[i].l,Math.abs(C[i].h-C[i-1].c),Math.abs(C[i].l-C[i-1].c));q.push(v);s+=v;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}
const A=atr(14);
function ema(p){const e=Array(C.length).fill(NaN),k=2/(p+1);let v=C[0].c;for(let i=0;i<C.length;i++){v=i?C[i].c*k+v*(1-k):C[i].c;e[i]=v}return e}const E20=ema(20),E50=ema(50);
function result(i,buy,risk,hold){const e=C[i].c,sl=buy?e-risk:e+risk,tp=buy?e+risk:e-risk;for(let k=i+1;k<=Math.min(C.length-1,i+hold);k++){const x=C[k];if(buy){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
const configs=[];for(const riskATR of [.55,.7,.85,1,1.2])for(const pull of [.2,.35,.5,.7,1])for(const bodyMin of [.2,.35,.5,.65])for(const hold of [6,9,12,18])configs.push({riskATR,pull,bodyMin,hold});
const cut1=Math.floor(C.length*.6),cut2=Math.floor(C.length*.8);
function test(P,lo,hi){let w=0,l=0,to=0,n=0;for(let i=Math.max(lo,60);i<Math.min(hi,C.length-P.hold-1);i++){const a=A[i];if(!(a>0))continue;const x=C[i],r=x.h-x.l;if(!(r>0)||Math.abs(x.c-x.o)/r<P.bodyMin)continue;const up=E20[i]>E50[i],dn=E20[i]<E50[i];let buy=false,sell=false;
// Trend + ATR-distance pullback/reclaim: price stretches from fast mean then closes back with trend.
const prev=C[i-1];if(up&&prev.l<=E20[i-1]-P.pull*a&&x.c>E20[i]&&x.c>x.o)buy=true;if(dn&&prev.h>=E20[i-1]+P.pull*a&&x.c<E20[i]&&x.c<x.o)sell=true;if(!buy&&!sell)continue;
const y=result(i,buy,P.riskATR*a,P.hold);n++;if(y>0)w++;else if(y<0)l++;else to++}
const wr=n?100*w/n:0,pf=l?w/l:99;return{n,w,l,to,wr,pf,net:w-l}}
console.log(`🔎 Testing ${configs.length} transparent ATR-distance RR1 variants on ${C.length} XAUUSD M5 candles...`);
const rows=[];for(const p of configs){const d=test(p,0,cut1);if(d.n<100||d.wr<54||d.net<=0)continue;const v=test(p,cut1,cut2);if(v.n<30||v.wr<54||v.net<=0)continue;const h=test(p,cut2,C.length);rows.push({p,d,v,h,score:v.wr*3+d.wr+h.wr})}rows.sort((a,b)=>b.score-a.score);
const f=s=>`T${s.n} W${s.w}/L${s.l}/TO${s.to} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net}R`;
console.log('\n🥇 ATR-DISTANCE GOLD SCALPER — STRICT RR 1:1');console.log('No grid | No martingale | No session filter | timeouts count against WR');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if(!rows.length){console.log('NO ATR-DISTANCE VARIANT PASSED ROBUSTNESS GATE');process.exit(0)}
rows.slice(0,25).forEach((x,i)=>console.log(`${i+1} | riskATR=${x.p.riskATR} pullATR=${x.p.pull} body=${x.p.bodyMin} hold=${x.p.hold}\n   DISC ${f(x.d)} | VAL ${f(x.v)} | HOLD ${f(x.h)}`));