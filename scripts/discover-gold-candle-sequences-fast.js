'use strict';
// Fast XAUUSD M5 candle-language miner. NO hour/session features. Strict TP=SL 1:1.
// Each candle becomes a compact relative-shape token; mine exact 2..6 candle sequences.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const c=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
console.log(`🧬 Building candle language from ${c.length} M5 candles...`);
function atr(p=14){const a=new Float64Array(c.length);let q=[],s=0;for(let i=1;i<c.length;i++){const x=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(x);s+=x;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
const bucket=(v,a,b)=>v<a?0:v<b?1:2;
function token(i){const b=c[i],a=A[i],rg=b.h-b.l;if(!(a>0&&rg>0))return null;const dir=b.c>=b.o?1:0,body=Math.abs(b.c-b.o)/rg,up=(b.h-Math.max(b.o,b.c))/rg,lo=(Math.min(b.o,b.c)-b.l)/rg,size=rg/a,cp=(b.c-b.l)/rg;return `${dir}${bucket(body,.3,.6)}${bucket(up,.2,.5)}${bucket(lo,.2,.5)}${bucket(size,.75,1.25)}${bucket(cp,.33,.67)}`}
const tok=c.map((_,i)=>token(i));
function out(i,side){const a=A[i],e=c[i].c,sl=side?e-a:e+a,tp=side?e+a:e-a;for(let k=i+1;k<=i+12;k++){const x=c[k];if(side){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
const cut1=c[Math.floor(c.length*.6)].t,cut2=c[Math.floor(c.length*.8)].t;
function add(m,key,y){let x=m.get(key);if(!x)m.set(key,x={s:0,w:0,l:0,to:0});x.s++;if(y===1)x.w++;else if(y===-1)x.l++;else x.to++}
const D=new Map(),V=new Map(),H=new Map();
for(let i=30;i<c.length-13;i++){if(!tok[i])continue;const M=c[i].t<cut1?D:c[i].t<cut2?V:H;for(let len=2;len<=6;len++){const a=i-len+1;if(a<0||tok.slice(a,i+1).some(x=>!x))continue;const seq=tok.slice(a,i+1).join('.');add(M,`B|${len}|${seq}`,out(i,1));add(M,`S|${len}|${seq}`,out(i,0))}}
console.log(`⚡ Indexed sequences: DISC ${D.size} | VAL ${V.size} | HOLD ${H.size}`);
const st=x=>{if(!x)return{n:0,wr:0,pf:0,net:0,to:0};const n=x.w+x.l;return{n,wr:n?100*x.w/n:0,pf:x.l?x.w/x.l:99,net:x.w-x.l,to:x.to}};
const best=[];for(const[key,d]of D){const ds=st(d);if(ds.n<45||ds.wr<62||ds.pf<1.6)continue;const vs=st(V.get(key));if(vs.n<15||vs.wr<58||vs.net<=0)continue;const hs=st(H.get(key));best.push({key,ds,vs,hs,rank:vs.wr*3+ds.wr+Math.log10(ds.n+vs.n)*4})}
best.sort((a,b)=>b.rank-a.rank);
function explain(code){const p=code.split('');return`${p[0]==='1'?'GREEN':'RED'} body=${['small','medium','large'][+p[1]]} upper=${['short','medium','long'][+p[2]]} lower=${['short','medium','long'][+p[3]]} range=${['small','medium','large'][+p[4]]} close=${['low','middle','high'][+p[5]]}`}
console.log(`\n🕯️ GOLD CANDLE SEQUENCE MINER — FAST | STRICT RR 1:1\nNO TIME / NO SESSION / PURE CANDLE BEHAVIOR | 60/20/20\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if(!best.length){console.log('NO ROBUST CANDLE SEQUENCE PASSED GATE');process.exit(0)}
for(const[x,j]of best.slice(0,30).map((x,i)=>[x,i])){const[side,len,...parts]=x.key.split('|');console.log(`${j+1} | ${side==='B'?'BUY':'SELL'} | ${len} candles | DISC T${x.ds.n} WR${x.ds.wr.toFixed(1)} PF${x.ds.pf.toFixed(2)} ${x.ds.net>=0?'+':''}${x.ds.net}R | VAL T${x.vs.n} WR${x.vs.wr.toFixed(1)} PF${x.vs.pf.toFixed(2)} ${x.vs.net>=0?'+':''}${x.vs.net}R | HOLD T${x.hs.n} WR${x.hs.wr.toFixed(1)} PF${x.hs.pf.toFixed(2)} ${x.hs.net>=0?'+':''}${x.hs.net}R TO${x.hs.to}`);parts.join('|').split('.').forEach((q,k)=>console.log(`   C${k+1}: ${explain(q)}`))}
