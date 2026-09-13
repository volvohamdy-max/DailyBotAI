#!/usr/bin/env node
'use strict';
// RESEARCH ONLY — XAUUSD M5 rolling 15m breakout, fixed $7 SL / $7 TP, 24H.
// Does NOT touch live strategies.
const fs=require('fs'),path=require('path');
const DATA=path.join(__dirname,'../data/backtests/history-cache/XAUUSD_5min.json');
const raw=JSON.parse(fs.readFileSync(DATA,'utf8'));
const c=(Array.isArray(raw)?raw:(raw.candles||raw.data||raw.items||[]))
  .map(x=>({t:+(x.timestamp??x.time??x.t),o:+x.open,h:+x.high,l:+x.low,c:+x.close}))
  .filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.o)&&Number.isFinite(x.h)&&Number.isFinite(x.l)&&Number.isFinite(x.c))
  .sort((a,b)=>a.t-b.t);
if(c.length<100) throw new Error('Not enough candles in '+DATA);
const MAX_HOLD=24,RANGE_BARS=3,COOLDOWN_BARS=3;
function ema(p){let a=[],x=c[0].c,k=2/(p+1);for(let i=0;i<c.length;i++){x=i?c[i].c*k+x*(1-k):x;a[i]=x}return a}
function atr(p=14){let out=[],sum=0,tr=[];for(let i=1;i<c.length;i++){tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));sum+=tr[i];if(i>p)sum-=tr[i-p];if(i>=p)out[i]=sum/p}return out}
function rsi(p=14){let out=[],g=0,l=0;for(let i=1;i<=p;i++){let d=c[i].c-c[i-1].c;if(d>=0)g+=d;else l-=d}g/=p;l/=p;for(let i=p;i<c.length;i++){if(i>p){let d=c[i].c-c[i-1].c;g=(g*(p-1)+Math.max(d,0))/p;l=(l*(p-1)+Math.max(-d,0))/p}let rs=l?g/l:999;out[i]=100-(100/(1+rs))}return out}
function adx(p=14){let tr=[],plus=[],minus=[],out=[];for(let i=1;i<c.length;i++){tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));let up=c[i].h-c[i-1].h,dn=c[i-1].l-c[i].l;plus[i]=up>dn&&up>0?up:0;minus[i]=dn>up&&dn>0?dn:0}let atrS=0,pS=0,mS=0,dx=[];for(let i=1;i<c.length;i++){if(i<=p){atrS+=tr[i];pS+=plus[i];mS+=minus[i];if(i<p)continue}else{atrS=atrS-atrS/p+tr[i];pS=pS-pS/p+plus[i];mS=mS-mS/p+minus[i]}let pdi=atrS?100*pS/atrS:0,mdi=atrS?100*mS/atrS:0;dx[i]=(pdi+mdi)?100*Math.abs(pdi-mdi)/(pdi+mdi):0;if(i>=2*p-1){if(i===2*p-1){let s=0;for(let j=p;j<=i;j++)s+=dx[j]||0;out[i]=s/p}else out[i]=(out[i-1]*(p-1)+dx[i])/p}}return out}
const E20=ema(20),E50=ema(50),A=atr(),R=rsi(),D=adx();
const trades=[];let nextAllowed=60;
for(let i=60;i<c.length-MAX_HOLD-1;i++){
 if(i<nextAllowed||!A[i]||!D[i]||!R[i]||A[i]>7||D[i]<19)continue;
 const b=c[i],range=b.h-b.l;if(range>1.4*A[i])continue;
 let hi=-Infinity,lo=Infinity;for(let j=i-RANGE_BARS;j<i;j++){hi=Math.max(hi,c[j].h);lo=Math.min(lo,c[j].l)}
 let side=null;if(b.c>hi&&E20[i]>E50[i]&&b.c>E20[i]&&R[i]>52)side='BUY';else if(b.c<lo&&E20[i]<E50[i]&&b.c<E20[i]&&R[i]<48)side='SELL';if(!side)continue;
 const en=c[i+1].o,sl=side==='BUY'?en-7:en+7,tp=side==='BUY'?en+7:en-7;let r=0,bars=MAX_HOLD;
 for(let j=i+1;j<=i+MAX_HOLD;j++){const loss=side==='BUY'?c[j].l<=sl:c[j].h>=sl,win=side==='BUY'?c[j].h>=tp:c[j].l<=tp;if(loss||win){r=loss?-1:1;bars=j-i;break}}
 if(!r){const x=c[i+MAX_HOLD].c;r=Math.max(-1,Math.min(1,(side==='BUY'?x-en:en-x)/7))}
 trades.push({r,bars,side,t:c[i].t,hour:new Date(c[i].t).getUTCHours()});nextAllowed=i+COOLDOWN_BARS;
}
function st(t){let net=0,g=0,l=0,w=0,pk=0,dd=0,ls=0,cur=0,buy=0,sell=0;for(const x of t){net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net);x.side==='BUY'?buy++:sell++;if(x.r>0){w++;g+=x.r;cur=0}else if(x.r<0){l-=x.r;cur++;ls=Math.max(ls,cur)}}return{n:t.length,wr:t.length?100*w/t.length:0,net,pf:l?g/l:(g?999:0),dd,ls,buy,sell}}
function fmt(s){return `T${s.n} B${s.buy}/S${s.sell} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net.toFixed(1)}R DD${s.dd.toFixed(1)}R LS${s.ls}`}
const all=st(trades),cut=Math.floor(trades.length*.75),dev=st(trades.slice(0,cut)),hold=st(trades.slice(cut));
console.log(`🧪 GOLD ROLLING 7x7 24H — RESEARCH ONLY | M5=${c.length}`);
console.log(`Period: ${new Date(c[0].t).toISOString()} -> ${new Date(c[c.length-1].t).toISOString()}`);
console.log('Rules: rolling 15m breakout | ADX>=19 | EMA20/50 | RSI52/48 | ATR<=7 | candle<=1.4ATR | SL=$7 TP=$7');
console.log(`\n🌍 ALL 24H | ${fmt(all)} | DEV PF${dev.pf.toFixed(2)} Net${dev.net.toFixed(1)}R | HOLD PF${hold.pf.toFixed(2)} Net${hold.net.toFixed(1)}R`);
console.log('\n🕐 BY UTC HOUR');for(let h=0;h<24;h++){const s=st(trades.filter(x=>x.hour===h));if(s.n)console.log(`${String(h).padStart(2,'0')}:00 | ${fmt(s)}`)}
console.log('\n🛒 BUY ONLY | '+fmt(st(trades.filter(x=>x.side==='BUY'))));console.log('💰 SELL ONLY | '+fmt(st(trades.filter(x=>x.side==='SELL'))));
