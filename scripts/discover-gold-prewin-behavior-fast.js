'use strict';
// Reverse discovery: start from strict RR1 outcomes, then discover what candle behavior preceded wins.
// Pure XAUUSD M5 price action. NO time/session/EMA/RSI. Deterministic + fast.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const c=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
function atr(p=14){const a=new Float64Array(c.length);let q=[],s=0;for(let i=1;i<c.length;i++){const v=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(v);s+=v;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
function outcome(i,buy){const a=A[i],e=c[i].c,sl=buy?e-a:e+a,tp=buy?e+a:e-a;for(let k=i+1;k<=i+12;k++){const x=c[k];if(buy){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
function f(i){const x=c[i],p=c[i-1],a=A[i],r=x.h-x.l,pr=p.h-p.l;if(!(a>0&&r>0&&pr>0))return null;const body=Math.abs(x.c-x.o),pb=Math.abs(p.c-p.o);return{d:x.c>=x.o?1:0,body:body/r,up:(x.h-Math.max(x.o,x.c))/r,lo:(Math.min(x.o,x.c)-x.l)/r,sz:r/a,cp:(x.c-x.l)/r,expand:r/pr,bodyExpand:pb?body/pb:2,hh:x.h>p.h?1:0,ll:x.l<p.l?1:0,closeUp:x.c>p.c?1:0}}
// Compact behavior code deliberately coarse: groups similar candles instead of exact shapes.
function code(i){const x=f(i);if(!x)return null;return ''+x.d+(x.body>=.5?1:0)+(x.up>=.3?1:0)+(x.lo>=.3?1:0)+(x.sz>=1?1:0)+(x.cp>=.5?1:0)+x.hh+x.ll+x.closeUp}
function family(i,len,mask){const z=[];for(let j=i-len+1;j<=i;j++){const s=code(j);if(!s)return null;let o='';for(const m of mask)o+=s[m];z.push(o)}return z.join('.')}
const masks=[[0,1,2,3],[0,1,4,5],[0,1,6,7,8],[0,2,3,6,7],[0,1,3,7,8],[0,1,2,3,6,7]];
const t1=c[Math.floor(c.length*.6)].t,t2=c[Math.floor(c.length*.8)].t,D=new Map(),V=new Map(),H=new Map();
function add(M,k,y){let s=M.get(k);if(!s)M.set(k,s={w:0,l:0,to:0});if(y===1)s.w++;else if(y===-1)s.l++;else s.to++}
console.log(`🔬 Reverse-mining ${c.length} M5 candles: outcomes first → preceding behavior...`);
for(let i=40;i<c.length-13;i++){const M=c[i].t<t1?D:c[i].t<t2?V:H;for(let len=2;len<=6;len++)for(let m=0;m<masks.length;m++){const k=family(i,len,masks[m]);if(!k)continue;add(M,`B|${len}|${m}|${k}`,outcome(i,true));add(M,`S|${len}|${m}|${k}`,outcome(i,false))}}
function st(x){if(!x)return{n:0,w:0,l:0,to:0,wr:0,pf:0,net:0,commercial:0};const n=x.w+x.l+x.to,wr=n?100*x.w/n:0;return{...x,n,wr,pf:x.l?x.w/x.l:99,net:x.w-x.l,commercial:wr}}
const best=[];for(const[k,x]of D){const d=st(x);if(d.n<100||d.wr<57||d.pf<1.35)continue;const v=st(V.get(k));if(v.n<30||v.wr<56||v.net<=0)continue;const h=st(H.get(k));best.push({k,d,v,h,score:v.wr*4+d.wr+Math.log10(d.n+v.n)*4})}best.sort((a,b)=>b.score-a.score);
console.log(`⚡ Indexed behavior families: DISC ${D.size} | VAL ${V.size} | HOLD ${H.size}`);
console.log('\n🧠 GOLD PRE-WIN BEHAVIOR DISCOVERY — STRICT RR 1:1\nOUTCOME-FIRST | PURE CANDLES | NO TIME/SESSION | TIMEOUT COUNTS AS NON-WIN\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if(!best.length){console.log('NO PRE-WIN BEHAVIOR FAMILY PASSED ROBUSTNESS GATE');process.exit(0)}
const fmt=s=>`T${s.n} W${s.w} L${s.l} TO${s.to} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} ${s.net>=0?'+':''}${s.net}R`;
function desc(k){const[side,len,mi,...seq]=k.split('|'),mask=masks[+mi],names=['dir','body','upperWick','lowerWick','rangeATR','closeHalf','higherHigh','lowerLow','closeVsPrev'];return`${side==='B'?'BUY':'SELL'} | ${len} candles | language=[${mask.map(x=>names[x]).join(', ')}] | ${seq.join('|')}`}
best.slice(0,30).forEach((x,i)=>console.log(`${i+1} | ${desc(x.k)}\n   DISC ${fmt(x.d)} | VAL ${fmt(x.v)} | HOLD ${fmt(x.h)}`));