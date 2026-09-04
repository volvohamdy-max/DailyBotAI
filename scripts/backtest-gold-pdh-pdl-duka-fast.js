#!/usr/bin/env node
'use strict';
// FAST Gold PDH/PDL sweep/reclaim test using LOCAL Dukascopy M5 data only.
// Tests fixed $10/$10 and $15/$15. BOTH BUY and SELL. Chronological DEV/OOS.
const fs=require('fs'),path=require('path');
const FILE=path.join(__dirname,'../data/xauusd-m5-dukascopy.json');
if(!fs.existsSync(FILE)) throw new Error('Missing Dukascopy file: '+FILE);
let raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
if(!Array.isArray(raw)) raw=raw.candles||raw.data||raw.values||[];
const n=v=>Number(v);
const C=raw.map(x=>({t:n(x.timestamp??x.time??x.datetime??x.date),o:n(x.open??x.o),h:n(x.high??x.h),l:n(x.low??x.l),c:n(x.close??x.c)})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.o)&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c)).sort((a,b)=>a.t-b.t);
if(!C.length) throw new Error('Could not parse Dukascopy candles');
if(C[0].t<1e12) C.forEach(x=>x.t*=1000);
function ema(p){let a=[],v=C[0].c,k=2/(p+1);for(let i=0;i<C.length;i++){v=i?C[i].c*k+v*(1-k):v;a[i]=v}return a}const E50=ema(50),E200=ema(200);
function key(t){let d=new Date(t);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}
let D={},order=[];for(let i=0;i<C.length;i++){let k=key(C[i].t);if(!D[k]){D[k]={h:-Infinity,l:Infinity,idx:[]};order.push(k)}D[k].h=Math.max(D[k].h,C[i].h);D[k].l=Math.min(D[k].l,C[i].l);D[k].idx.push(i)}
let prev={};for(let j=1;j<order.length;j++)prev[order[j]]=D[order[j-1]];
function run(q){let tr=[];for(let di=1;di<order.length;di++){let dk=order[di],pd=prev[dk],done=false;for(const i of D[dk].idx){if(done||i<210||i+q.hold>=C.length)continue;let hr=new Date(C[i].t).getUTCHours();if(hr<q.h0||hr>q.h1)continue;let b=C[i],p=C[i-1],side=null,biasUp=E50[i]>E200[i],biasDn=E50[i]<E200[i];let buy=b.l<pd.l-q.sweep&&b.c>pd.l&&b.c>b.o&&biasUp;let sell=b.h>pd.h+q.sweep&&b.c<pd.h&&b.c<b.o&&biasDn;if(buy)side='BUY';else if(sell)side='SELL';if(!side)continue;let en=C[i+1].o,sl=side==='BUY'?en-q.dist:en+q.dist,tp=side==='BUY'?en+q.dist:en-q.dist,r=0;for(let j=i+1;j<=i+q.hold;j++){let loss=side==='BUY'?C[j].l<=sl:C[j].h>=sl,win=side==='BUY'?C[j].h>=tp:C[j].l<=tp;if(loss||win){r=loss?-1:1;break}}if(!r)r=Math.max(-1,Math.min(1,(side==='BUY'?C[i+q.hold].c-en:en-C[i+q.hold].c)/q.dist));tr.push({r,side,t:C[i].t});done=true}}return tr}
function st(a){let w=0,g=0,l=0,net=0,pk=0,dd=0;for(const x of a){net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net);if(x.r>0){w++;g+=x.r}else if(x.r<0)l-=x.r}return{n:a.length,wr:a.length?100*w/a.length:0,pf:l?g/l:999,net,dd}}
function all(t){let k=Math.floor(t.length*.7);return{a:st(t),d:st(t.slice(0,k)),o:st(t.slice(k)),b:st(t.filter(x=>x.side==='BUY')),s:st(t.filter(x=>x.side==='SELL'))}}
let rows=[],tests=0;for(const dist of [10,15])for(const sweep of [0,0.5,1])for(const sess of [[7,20],[10,20],[12,20]])for(const hold of [36,72]){tests++;let q={dist,sweep,h0:sess[0],h1:sess[1],hold},t=run(q);if(t.length<20)continue;rows.push({q,...all(t)})}
const f=x=>`$${x.q.dist}/${x.q.dist} Sweep${x.q.sweep} H${x.q.h0}-${x.q.h1} Hold${x.q.hold*5}m | T${x.a.n} WR${x.a.wr.toFixed(1)} PF${x.a.pf.toFixed(2)} Net${x.a.net.toFixed(1)}R DD${x.a.dd.toFixed(1)} | BUY ${x.b.n}/${x.b.wr.toFixed(1)}% | SELL ${x.s.n}/${x.s.wr.toFixed(1)}% | DEV ${x.d.wr.toFixed(1)} PF${x.d.pf.toFixed(2)} | OOS ${x.o.wr.toFixed(1)} PF${x.o.pf.toFixed(2)}`;
console.log(`⚡ DUKASCOPY GOLD PDH/PDL FAST | ${C.length} M5 candles | ${tests} tests`);console.log(`Source: data/xauusd-m5-dukascopy.json`);
let pass=rows.filter(x=>x.a.n>=50&&x.b.n>=15&&x.s.n>=15&&x.a.wr>=60&&x.d.wr>=57&&x.o.wr>=57&&x.d.pf>1.1&&x.o.pf>1.1).sort((a,b)=>b.a.wr-a.a.wr||b.o.wr-a.o.wr);
console.log('\n🏆 PASSED');if(!pass.length)console.log('NO CANDIDATE PASSED GATE');else pass.slice(0,15).forEach((x,i)=>console.log(`${i+1}. ${f(x)}`));
console.log('\n📊 TOP AVAILABLE');rows.sort((a,b)=>b.a.wr-a.a.wr||b.o.wr-a.o.wr).slice(0,20).forEach((x,i)=>console.log(`${i+1}. ${f(x)}`));