'use strict';
// Frozen validation of clusters discovered by discover-gold-rr1-patterns.js.
// STRICT 1:1, conservative same-bar SL-first. Reports yearly/monthly and TP/SL only.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const c=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close}));
function atr(p=14){const a=Array(c.length).fill(NaN),q=[];let s=0;for(let i=1;i<c.length;i++){const x=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(x);s+=x;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr();
function feat(i){const a=A[i],b=c[i],rg=b.h-b.l;if(!(a>0&&rg>0))return null;let up3=0,hi=-Infinity,lo=Infinity;for(let j=i-12;j<i;j++){hi=Math.max(hi,c[j].h);lo=Math.min(lo,c[j].l)}for(let j=i-2;j<=i;j++)up3+=c[j].c>c[j].o?1:-1;let old=0,rec=0;for(let j=i-30;j<i-10;j++)old+=A[j];for(let j=i-5;j<i;j++)rec+=A[j];return{hour:new Date(b.t).getUTCHours(),range:rg/a,persist3:up3,lower:(Math.min(b.o,b.c)-b.l)/a,move5:(b.c-c[i-5].c)/a,move8:(b.c-c[i-8].c)/a,fromHi:(hi-b.c)/a,fromLo:(b.c-lo)/a,volRatio:(rec/5)/(old/20)}}
const P=[
{name:'A BUY 21 compact',side:'BUY',ok:f=>f.hour===21&&f.range<=.7&&f.persist3<=1},
{name:'B BUY 21 low-wick',side:'BUY',ok:f=>f.hour===21&&f.range<=.7&&f.lower<=.6},
{name:'C BUY 21 move5',side:'BUY',ok:f=>f.hour===21&&f.move5>=-1&&f.lower<=.6},
{name:'D BUY 21 broad',side:'BUY',ok:f=>f.hour===21&&f.move5>=-1&&f.fromLo>=0},
{name:'E SELL 09 vol',side:'SELL',ok:f=>f.hour===9&&f.volRatio>=1.1},
{name:'F SELL 10 persist',side:'SELL',ok:f=>f.hour===10&&f.persist3>=3},
{name:'G SELL 17 location',side:'SELL',ok:f=>f.hour===17&&f.fromHi<=.5}
];
function result(i,side){const a=A[i],e=c[i].c,sl=side==='BUY'?e-a:e+a,tp=side==='BUY'?e+a:e-a;for(let k=i+1;k<=i+12;k++){const x=c[k];if(side==='BUY'){if(x.l<=sl)return-1;if(x.h>=tp)return 1}else{if(x.h>=sl)return-1;if(x.l<=tp)return 1}}return 0}
function stat(t){const tp=t.filter(x=>x.r===1).length,sl=t.filter(x=>x.r===-1).length,to=t.filter(x=>x.r===0).length,n=tp+sl,wr=n?tp/n*100:0;return{signals:t.length,tp,sl,to,n,wr,pf:sl?tp/sl:99,net:tp-sl}}
function trades(p){const t=[];for(let i=45;i<c.length-13;i++){const f=feat(i);if(f&&p.ok(f))t.push({t:c[i].t,r:result(i,p.side)})}return t}
function fmt(s){return`Sig${s.signals} TP${s.tp} SL${s.sl} TO${s.to} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net}R`}
console.log('\n🧪 GOLD RR1 DISCOVERED CLUSTERS — FROZEN VALIDATION\nTP=SL EXACTLY | SL-first same-bar | 12-bar horizon\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for(const p of P){const t=trades(p),s=stat(t);console.log(`\n${p.name} | ${p.side} | ${fmt(s)}`);const years={};for(const x of t){const y=new Date(x.t).getUTCFullYear();(years[y]??=[]).push(x)}console.log('YEAR: '+Object.entries(years).map(([y,a])=>`${y}:${fmt(stat(a))}`).join(' | '));const months={};for(const x of t){const d=new Date(x.t),m=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;(months[m]??=[]).push(x)}const ms=Object.entries(months).map(([m,a])=>[m,stat(a)]);const bad=ms.filter(([,x])=>x.n>=5&&x.wr<50),good=ms.filter(([,x])=>x.n>=5&&x.wr>=60);console.log(`MONTHS: ${ms.length} | bad<50%=${bad.length} | strong>=60%=${good.length}`);if(bad.length)console.log('BAD: '+bad.map(([m,x])=>`${m} ${x.wr.toFixed(0)}%(${x.n})`).join(', '));
// chronological 5-fold stability
const folds=[];for(let k=0;k<5;k++){const a=Math.floor(t.length*k/5),b=Math.floor(t.length*(k+1)/5);folds.push(stat(t.slice(a,b)))}console.log('5-FOLD: '+folds.map((x,i)=>`F${i+1} ${x.wr.toFixed(1)}%/${x.n}`).join(' | '));}
