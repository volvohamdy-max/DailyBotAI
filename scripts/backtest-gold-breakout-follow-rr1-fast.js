'use strict';
// Exact-entry reconstruction of jzd101/breakout-follow-101, normalized to strict RR 1:1.
// Research only. Native M15 is built from cached XAUUSD M5. No live wiring.
const fs=require('fs'),path=require('path');
const raw=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));
const m5=(Array.isArray(raw)?raw:(raw.data||raw.candles||[])).slice(-50000).map(z=>({t:+(z.timestamp??z.time),o:+z.open,h:+z.high,l:+z.low,c:+z.close,v:+(z.volume??z.vol??z.tick_volume??1)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite));
// Aggregate 3x M5 -> M15, aligned by timestamp bucket.
const map=new Map();for(const x of m5){const t=Math.floor(x.t/900000)*900000;let b=map.get(t);if(!b){b={t,o:x.o,h:x.h,l:x.l,c:x.c,v:0,n:0};map.set(t,b)}b.h=Math.max(b.h,x.h);b.l=Math.min(b.l,x.l);b.c=x.c;b.v+=Number.isFinite(x.v)?x.v:1;b.n++}const c=[...map.values()].filter(x=>x.n>=3).sort((a,b)=>a.t-b.t);
function ema(a,p){const out=new Float64Array(a.length),k=2/(p+1);out[0]=a[0].c;for(let i=1;i<a.length;i++)out[i]=a[i].c*k+out[i-1]*(1-k);return out}
function smaVal(a,i,p,key){let s=0;for(let j=i-p+1;j<=i;j++)s+=a[j][key];return s/p}
function sdClose(a,i,p,mean){let s=0;for(let j=i-p+1;j<=i;j++){const d=a[j].c-mean;s+=d*d}return Math.sqrt(s/p)}
function atr(a,p){const out=new Float64Array(a.length);let seed=0;for(let i=1;i<a.length;i++){const tr=Math.max(a[i].h-a[i].l,Math.abs(a[i].h-a[i-1].c),Math.abs(a[i].l-a[i-1].c));if(i<=p){seed+=tr;if(i===p)out[i]=seed/p}else out[i]=(out[i-1]*(p-1)+tr)/p}return out}
function stats(t){let n=t.length,w=0,l=0,to=0,e=0,pk=0,dd=0;for(const x of t){x.r===1?w++:x.r===-1?l++:to++;e+=x.r;pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{n,w,l,to,wr:n?w/n*100:0,pf:l?w/l:(w?99:0),net:e,dd}}
const E=ema(c,200),A=atr(c,18),events=[];
// Source rules: close vs EMA200, close outside BB(15,1.5), volume > SMA15; execute next bar open.
for(let i=210;i<c.length-15;i++){const b=c[i],basis=smaVal(c,i,15,'c'),sd=sdClose(c,i,15,basis),upper=basis+1.5*sd,lower=basis-1.5*sd,vol=smaVal(c,i,15,'v');let side=null;if(b.c>E[i]&&b.c>upper&&b.v>vol)side='BUY';else if(b.c<E[i]&&b.c<lower&&b.v>vol)side='SELL';if(!side)continue;events.push({i,side,time:c[i+1].t,entry:c[i+1].o,atr:A[i]})}
function sim(p){const o=[];let blocked=-1;for(const e of events){if(e.i<=blocked||!(e.atr>0))continue;const risk=e.atr*p.sl,tp=e.side==='BUY'?e.entry+risk:e.entry-risk,sl=e.side==='BUY'?e.entry-risk:e.entry+risk;let R=0,exit=e.i+p.hold;for(let k=e.i+1;k<=Math.min(c.length-1,e.i+p.hold);k++){const x=c[k],hs=e.side==='BUY'?x.l<=sl:x.h>=sl,ht=e.side==='BUY'?x.h>=tp:x.l<=tp;if(hs){R=-1;exit=k;break}if(ht){R=1;exit=k;break}}o.push({r:R,time:e.time,side:e.side});blocked=exit+p.cool}return o}
const cut1=c[Math.floor(c.length*.6)].t,cut2=c[Math.floor(c.length*.8)].t,R=[];
// Tiny deterministic grid: exact entry edge; only risk distance/holding/cooldown vary. RR always 1.
for(const sl of [.5,.65,.8,1,1.2,1.5,1.8,2])for(const hold of [4,6,8,12,16,24])for(const cool of [0,2,4,6]){const p={sl,hold,cool,rr:1},t=sim(p),d=t.filter(x=>x.time<cut1),v=t.filter(x=>x.time>=cut1&&x.time<cut2),h=t.filter(x=>x.time>=cut2),D=stats(d),V=stats(v),H=stats(h),S=stats(t);if(D.n<50||V.n<15||H.n<15)continue;if(D.wr<55||V.wr<55||H.wr<55)continue;R.push({p,S,D,V,H,score:H.wr*5+V.wr*3+D.wr*2-S.dd*.1})}
R.sort((a,b)=>b.score-a.score);console.log(`\n🚀 BREAKOUT FOLLOW TREND — STRICT RR 1:1 | native M15 | ${c.length} bars | ${events.length} raw signals\nExact published entry family: EMA200 + BB(15,1.5) breakout + Volume>SMA15 | next-bar open\n192 fast exit variants | 60/20/20 | SL-first | timeout = non-win\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);if(!R.length){console.log('NO ROBUST BREAKOUT-FOLLOW RR1 CANDIDATE PASSED GATE');process.exit(0)}for(const [i,x] of R.slice(0,20).entries())console.log(`${i+1} | ALL T${x.S.n} WR${x.S.wr.toFixed(1)} PF${x.S.pf.toFixed(2)} Net${x.S.net.toFixed(0)}R DD${x.S.dd.toFixed(0)} | DISC T${x.D.n} WR${x.D.wr.toFixed(1)} | VAL T${x.V.n} WR${x.V.wr.toFixed(1)} | HOLD T${x.H.n} WR${x.H.wr.toFixed(1)} PF${x.H.pf.toFixed(2)}\n ${JSON.stringify(x.p)}`);
