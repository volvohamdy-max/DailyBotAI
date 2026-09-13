#!/usr/bin/env node
'use strict';
// RESEARCH ONLY — choose contiguous BUY-only windows INSIDE 19:00→02:00 UTC using DEV only,
// then reveal HOLD. One active trade at a time, fixed $7/$7, assumed $0.20 round-trip cost.
const fs=require('fs'),path=require('path');
const DATA=path.join(__dirname,'../data/backtests/history-cache/XAUUSD_5min.json');
const raw=JSON.parse(fs.readFileSync(DATA,'utf8'));
const c=(Array.isArray(raw)?raw:(raw.candles||raw.data||raw.items||[])).map(x=>({t:+(x.timestamp??x.time??x.t),o:+x.open,h:+x.high,l:+x.low,c:+x.close})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
if(c.length<100)throw new Error('Not enough candles');
const MAX_HOLD=24,COST=.20;
function ema(p){let a=[],x=c[0].c,k=2/(p+1);for(let i=0;i<c.length;i++){x=i?c[i].c*k+x*(1-k):x;a[i]=x}return a}
function atr(p=14){let o=[],s=0,tr=[];for(let i=1;i<c.length;i++){tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));s+=tr[i];if(i>p)s-=tr[i-p];if(i>=p)o[i]=s/p}return o}
function rsi(p=14){let o=[],g=0,l=0;for(let i=1;i<=p;i++){let d=c[i].c-c[i-1].c;d>=0?g+=d:l-=d}g/=p;l/=p;for(let i=p;i<c.length;i++){if(i>p){let d=c[i].c-c[i-1].c;g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}o[i]=100-100/(1+(l?g/l:999))}return o}
function adx(p=14){let tr=[],pl=[],mi=[],o=[];for(let i=1;i<c.length;i++){tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));let u=c[i].h-c[i-1].h,d=c[i-1].l-c[i].l;pl[i]=u>d&&u>0?u:0;mi[i]=d>u&&d>0?d:0}let ts=0,ps=0,ms=0,dx=[];for(let i=1;i<c.length;i++){if(i<=p){ts+=tr[i];ps+=pl[i];ms+=mi[i];if(i<p)continue}else{ts=ts-ts/p+tr[i];ps=ps-ps/p+pl[i];ms=ms-ms/p+mi[i]}let pdi=ts?100*ps/ts:0,mdi=ts?100*ms/ts:0;dx[i]=(pdi+mdi)?100*Math.abs(pdi-mdi)/(pdi+mdi):0;if(i>=2*p-1){if(i===2*p-1){let s=0;for(let j=p;j<=i;j++)s+=dx[j]||0;o[i]=s/p}else o[i]=(o[i-1]*(p-1)+dx[i])/p}}return o}
const E20=ema(20),E50=ema(50),A=atr(),R=rsi(),D=adx();
const cutT=c[0].t+(c[c.length-1].t-c[0].t)*.75;
const starts=[19,20,21,22,23,0,1];
function spanHours(start,dur){let a=[];for(let k=0;k<dur;k++)a.push((start+k)%24);return a}
const windows=[];for(const s of starts){for(let dur=2;dur<=7;dur++){const hs=spanHours(s,dur);if(hs.every(h=>starts.includes(h))&&hs.includes(s))windows.push({s,dur,hs})}}
function run(win){const t=[];let nextFree=60;for(let i=60;i<c.length-MAX_HOLD-1;i++){if(i<nextFree)continue;const h=new Date(c[i].t).getUTCHours();if(!win.hs.includes(h)||!A[i]||!D[i]||!R[i]||A[i]>7||D[i]<19)continue;const b=c[i];if(b.h-b.l>1.4*A[i])continue;let hi=-Infinity;for(let j=i-3;j<i;j++)hi=Math.max(hi,c[j].h);if(!(b.c>hi&&E20[i]>E50[i]&&b.c>E20[i]&&R[i]>52))continue;const en=c[i+1].o,sl=en-7,tp=en+7;let rawR=0,exit=i+MAX_HOLD;for(let j=i+1;j<=i+MAX_HOLD;j++){const loss=c[j].l<=sl,winhit=c[j].h>=tp;if(loss||winhit){rawR=loss?-1:1;exit=j;break}}if(!rawR)rawR=Math.max(-1,Math.min(1,(c[exit].c-en)/7));t.push({r:rawR-COST/7,t:c[i].t,h});nextFree=exit+1}return t}
function st(t){let net=0,g=0,l=0,w=0,pk=0,dd=0,ls=0,cur=0;for(const x of t){net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net);if(x.r>0){w++;g+=x.r;cur=0}else if(x.r<0){l-=x.r;cur++;ls=Math.max(ls,cur)}}return{n:t.length,wr:t.length?100*w/t.length:0,pf:l?g/l:(g?999:0),net,dd,ls}}
function fmt(s){return `T${s.n} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net.toFixed(1)}R DD${s.dd.toFixed(1)}R LS${s.ls}`}
function lab(x){let end=(x.s+x.dur)%24;return `${String(x.s).padStart(2,'0')}:00→${String(end).padStart(2,'0')}:00 (${x.dur}h)`}
const rows=windows.map(w=>{const t=run(w),dev=t.filter(x=>x.t<cutT),hold=t.filter(x=>x.t>=cutT);return{w,t,dev,hold,ds:st(dev),hs:st(hold),as:st(t)}}).filter(x=>x.ds.n>=20).sort((a,b)=>(b.ds.pf-a.ds.pf)||(b.ds.net-a.ds.net)||(b.ds.n-a.ds.n));
console.log(`🧪 GOLD BUY 7x7 DEV-SELECT SESSION LAB — RESEARCH ONLY | M5=${c.length}`);
console.log(`Period: ${new Date(c[0].t).toISOString()} -> ${new Date(c[c.length-1].t).toISOString()}`);
console.log('Rules: BUY only | one active trade | rolling 15m breakout | ADX>=19 | EMA20>EMA50 | RSI>52 | ATR<=7 | candle<=1.4ATR | SL=$7 TP=$7 | cost=$0.20');
console.log('Selection: rank windows by DEV PF only; HOLD is revealed after ranking and is NOT used for selection.');
console.log('\n🏆 DEV-RANKED CONTIGUOUS WINDOWS');
rows.slice(0,15).forEach((x,k)=>console.log(`${k+1}. ${lab(x.w)} | DEV ${fmt(x.ds)} | HOLD ${fmt(x.hs)} | ALL ${fmt(x.as)}`));
if(rows[0]){const x=rows[0];console.log(`\n🔐 CHOSEN BY DEV ONLY: ${lab(x.w)}`);console.log('DEV  | '+fmt(x.ds));console.log('HOLD | '+fmt(x.hs));console.log('ALL  | '+fmt(x.as));}
