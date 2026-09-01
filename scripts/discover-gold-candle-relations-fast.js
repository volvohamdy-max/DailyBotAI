'use strict';
// Fast relational candle-family miner: shape + relationships, NO clock/session, strict TP=SL 1:1.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const c=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
console.log(`🧠 Building relational candle families from ${c.length} M5 candles...`);
function atr(p=14){const a=new Float64Array(c.length);let q=[],s=0;for(let i=1;i<c.length;i++){const x=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(x);s+=x;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
function out(i,buy){const a=A[i],e=c[i].c,sl=buy?e-a:e+a,tp=buy?e+a:e-a;for(let k=i+1;k<=i+12;k++){const x=c[k];if(buy){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
const b=(v,x)=>v<x?0:1;
function candle(i){const x=c[i],a=A[i],r=x.h-x.l;if(!(a>0&&r>0))return null;return{d:x.c>=x.o?1:0,body:Math.abs(x.c-x.o)/r,up:(x.h-Math.max(x.o,x.c))/r,lo:(Math.min(x.o,x.c)-x.l)/r,sz:r/a,cp:(x.c-x.l)/r,r}}
function key(i,len){const z=[];for(let j=i-len+1;j<=i;j++){const x=candle(j);if(!x)return null;z.push(x)}const q=[];for(const x of z)q.push(`${x.d}${b(x.body,.45)}${b(x.up,.3)}${b(x.lo,.3)}`);for(let j=1;j<z.length;j++){const p=z[j-1],x=z[j],cur=c[i-len+1+j],prev=c[i-len+j];const rel=[b(x.r/p.r,.85),b(x.r/p.r,1.2),b(cur.c,prev.h),b(cur.c,prev.l),b(cur.h,prev.h),b(cur.l,prev.l),b(x.cp,.5)];q.push(rel.join(''))}return q.join('.')}
const t1=c[Math.floor(c.length*.6)].t,t2=c[Math.floor(c.length*.8)].t,D=new Map(),V=new Map(),H=new Map();
function add(M,k,y){let x=M.get(k);if(!x)M.set(k,x={w:0,l:0,to:0});if(y===1)x.w++;else if(y===-1)x.l++;else x.to++}
for(let i=40;i<c.length-13;i++){const M=c[i].t<t1?D:c[i].t<t2?V:H;for(let len=2;len<=5;len++){const k=key(i,len);if(!k)continue;add(M,`B|${len}|${k}`,out(i,1));add(M,`S|${len}|${k}`,out(i,0))}}
console.log(`⚡ Families indexed: DISC ${D.size} | VAL ${V.size} | HOLD ${H.size}`);
function st(x){if(!x)return{n:0,w:0,l:0,to:0,wr:0,pf:0,net:0};const n=x.w+x.l;return{...x,n,wr:n?100*x.w/n:0,pf:x.l?x.w/x.l:99,net:x.w-x.l}}
const best=[];for(const[k,d]of D){const ds=st(d);if(ds.n<70||ds.wr<60||ds.pf<1.5)continue;const vs=st(V.get(k));if(vs.n<22||vs.wr<57||vs.net<=0)continue;const hs=st(H.get(k));best.push({k,ds,vs,hs,rank:vs.wr*3+ds.wr+Math.log10(ds.n+vs.n)*5})}best.sort((a,b)=>b.rank-a.rank);
console.log(`\n🧬 GOLD RELATIONAL CANDLE FAMILIES — FAST\nPURE PRICE ACTION | NO TIME | STRICT TP=SL 1:1 | 60/20/20\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if(!best.length){console.log('NO RELATIONAL CANDLE FAMILY PASSED GATE');process.exit(0)}
function decode(k){const[side,len,...r]=k.split('|'),p=r.join('|').split('.'),sh=p.slice(0,+len),rel=p.slice(+len);const lines=[];sh.forEach((x,i)=>lines.push(`C${i+1}: ${x[0]==='1'?'GREEN':'RED'}, body ${x[1]==='1'?'solid':'small'}, upper ${x[2]==='1'?'long':'short'}, lower ${x[3]==='1'?'long':'short'}`));rel.forEach((x,i)=>lines.push(`C${i+2} vs C${i+1}: ${x[0]==='1'?'not much smaller':'smaller'} / ${x[1]==='1'?'large expansion':'no large expansion'} / close>${x[2]==='1'?'prevHigh':'no'} / close>${x[3]==='1'?'prevLow':'below prevLow'} / high ${x[4]==='1'?'>=':'<'} prev / low ${x[5]==='1'?'>=':'<'} prev / close ${x[6]==='1'?'upper':'lower'} half`));return{side:side==='B'?'BUY':'SELL',len,lines}}
best.slice(0,25).forEach((x,i)=>{const d=decode(x.k);console.log(`\n${i+1} | ${d.side} | ${d.len} candles | DISC T${x.ds.n} WR${x.ds.wr.toFixed(1)} PF${x.ds.pf.toFixed(2)} ${x.ds.net>=0?'+':''}${x.ds.net}R | VAL T${x.vs.n} WR${x.vs.wr.toFixed(1)} PF${x.vs.pf.toFixed(2)} ${x.vs.net>=0?'+':''}${x.vs.net}R | HOLD T${x.hs.n} WR${x.hs.wr.toFixed(1)} PF${x.hs.pf.toFixed(2)} ${x.hs.net>=0?'+':''}${x.hs.net}R TO${x.hs.to}`);d.lines.forEach(s=>console.log('   '+s))});