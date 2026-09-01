'use strict';
// Multi-phase price-action miner: PUSH -> PAUSE -> TRIGGER, strict RR 1:1.
// Pure XAUUSD M5 candles. No time/session/EMA/RSI. Deterministic and fast.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const C=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
function atr(p=14){const a=new Float64Array(C.length);let q=[],s=0;for(let i=1;i<C.length;i++){const v=Math.max(C[i].h-C[i].l,Math.abs(C[i].h-C[i-1].c),Math.abs(C[i].l-C[i-1].c));q.push(v);s+=v;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
function out(i,buy){const a=A[i],e=C[i].c,sl=buy?e-a:e+a,tp=buy?e+a:e-a;for(let k=i+1;k<=i+12;k++){const x=C[k];if(buy){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
function features(i){const a=A[i];if(!(a>0)||i<8)return null;const t=C[i],r=t.h-t.l;if(!(r>0))return null;const push=C.slice(i-5,i-2),pause=C.slice(i-2,i);const po=push[0].o,pc=push[2].c,pdir=pc>=po?1:-1,pmove=Math.abs(pc-po)/a;let ph=-Infinity,pl=Infinity,pr=0;for(const x of push){ph=Math.max(ph,x.h);pl=Math.min(pl,x.l);pr+=x.h-x.l}let qh=-Infinity,ql=Infinity,qr=0;for(const x of pause){qh=Math.max(qh,x.h);ql=Math.min(ql,x.l);qr+=x.h-x.l}const body=Math.abs(t.c-t.o)/r,up=(t.h-Math.max(t.o,t.c))/r,lo=(Math.min(t.o,t.c)-t.l)/r;return{pdir,pmove,persist:push.filter(x=>(x.c>=x.o)===(pdir===1)).length,pauseRatio:qr/Math.max(pr,1e-9),pauseInside:(qh<=ph&&ql>=pl)?1:0,trigDir:t.c>=t.o?1:-1,body,up,lo,trigSize:r/a,breakPushHi:t.c>ph?1:0,breakPushLo:t.c<pl?1:0,breakPauseHi:t.c>qh?1:0,breakPauseLo:t.c<ql?1:0,closePos:(t.c-t.l)/r}}
// Coarse phase language. Multiple views reduce exact-match sparsity.
const views=[
 f=>`${f.pdir}|${f.pmove>=.8?1:0}|${f.persist>=2?1:0}|${f.pauseRatio<=.55?1:0}|${f.trigDir}|${f.body>=.5?1:0}|${f.breakPauseHi}|${f.breakPauseLo}`,
 f=>`${f.pdir}|${f.pmove>=1.2?1:0}|${f.pauseInside}|${f.trigDir}|${f.trigSize>=1?1:0}|${f.breakPushHi}|${f.breakPushLo}`,
 f=>`${f.pdir}|${f.persist>=2?1:0}|${f.pauseRatio<=.7?1:0}|${f.trigDir}|${f.body>=.4?1:0}|${f.up>=.3?1:0}|${f.lo>=.3?1:0}|${f.closePos>=.5?1:0}`,
 f=>`${f.pdir}|${f.pmove>=.6?1:0}|${f.pauseInside}|${f.pauseRatio<=.6?1:0}|${f.trigDir}|${f.breakPauseHi}|${f.breakPauseLo}|${f.closePos>=.5?1:0}`
];
const t1=C[Math.floor(C.length*.6)].t,t2=C[Math.floor(C.length*.8)].t,D=new Map(),V=new Map(),H=new Map();
function add(M,k,y){let s=M.get(k);if(!s)M.set(k,s={w:0,l:0,to:0});if(y===1)s.w++;else if(y===-1)s.l++;else s.to++}
console.log(`🧠 Mining PUSH → PAUSE → TRIGGER behavior from ${C.length} M5 candles...`);
for(let i=40;i<C.length-13;i++){const f=features(i);if(!f)continue;const M=C[i].t<t1?D:C[i].t<t2?V:H;for(let vi=0;vi<views.length;vi++){const k=views[vi](f);add(M,`B|${vi}|${k}`,out(i,true));add(M,`S|${vi}|${k}`,out(i,false))}}
function st(x){if(!x)return{n:0,w:0,l:0,to:0,wr:0,pf:0,net:0};const n=x.w+x.l+x.to;return{...x,n,wr:n?100*x.w/n:0,pf:x.l?x.w/x.l:99,net:x.w-x.l}}
const best=[];for(const[k,x]of D){const d=st(x);if(d.n<130||d.wr<56||d.pf<1.3)continue;const v=st(V.get(k));if(v.n<40||v.wr<55||v.net>0){if(v.n<40||v.wr<55||v.net<=0)continue}const h=st(H.get(k));best.push({k,d,v,h,score:v.wr*4+d.wr+Math.log10(d.n+v.n)*4})}best.sort((a,b)=>b.score-a.score);
console.log(`⚡ Phase families: DISC ${D.size} | VAL ${V.size} | HOLD ${H.size}`);
console.log('\n🌊 GOLD MULTI-PHASE BEHAVIOR — STRICT RR 1:1\nPUSH → PAUSE → TRIGGER | NO TIME/SESSION | TIMEOUT = NON-WIN\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if(!best.length){console.log('NO MULTI-PHASE FAMILY PASSED ROBUSTNESS GATE');process.exit(0)}
const fmt=s=>`T${s.n} W${s.w} L${s.l} TO${s.to} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} ${s.net>=0?'+':''}${s.net}R`;
best.slice(0,30).forEach((x,i)=>{const p=x.k.split('|');console.log(`${i+1} | ${p[0]==='B'?'BUY':'SELL'} | VIEW ${p[1]} | CODE ${p.slice(2).join('|')}\n   DISC ${fmt(x.d)} | VAL ${fmt(x.v)} | HOLD ${fmt(x.h)}`)});