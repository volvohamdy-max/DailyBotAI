'use strict';
// Gold Streak Exhaustion RR1 — research only. No live wiring.
// Idea: after 3-5 same-direction M5 candles, hunt failed continuation/rejection.
// HARD RULE: TP distance === SL distance (1:1). Timeouts count as non-wins.
const fs=require('fs'),path=require('path');
function load(){const x=JSON.parse(fs.readFileSync(path.resolve('data/backtests/history-cache/XAUUSD_5min.json'),'utf8'));return(Array.isArray(x)?x:(x.data||x.candles||[])).slice(-50000).map(z=>({timestamp:+(z.timestamp??z.time),open:+z.open,high:+z.high,low:+z.low,close:+z.close})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite))}
function atr(c,p=14){const a=Array(c.length).fill(NaN),q=[];let s=0;for(let i=1;i<c.length;i++){const t=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));q.push(t);s+=t;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}
function stats(t){let n=t.length,w=0,l=0,to=0,e=0,pk=0,dd=0,ls=0,maxls=0;for(const x of t){if(x.r===1)w++;else if(x.r===-1)l++;else to++;e+=x.r;pk=Math.max(pk,e);dd=Math.max(dd,pk-e);if(x.r<0){ls++;maxls=Math.max(maxls,ls)}else ls=0}return{n,w,l,to,wr:n?w/n*100:0,pf:l?w/l:(w?99:0),net:e,dd,ls:maxls}}
function pick(a){return a[Math.floor(Math.random()*a.length)]}
function simulate(c,A,p){const out=[];for(let i=40;i<c.length-p.hold-1;i++){
 const a=A[i],tr=c[i];if(!(a>0))continue;
 // preceding streak excludes trigger candle
 let up=true,dn=true,move=0,minBody=1,avgBody=0;
 for(let j=i-p.streak;j<i;j++){const x=c[j],rg=x.high-x.low;if(!(rg>0)){up=dn=false;break}up=up&&x.close>x.open;dn=dn&&x.close<x.open;avgBody+=Math.abs(x.close-x.open)/rg;minBody=Math.min(minBody,Math.abs(x.close-x.open)/rg)}
 if(!up&&!dn)continue;avgBody/=p.streak;
 const first=c[i-p.streak],last=c[i-1];move=(up?last.close-first.open:first.open-last.close)/a;if(move<p.move||avgBody<p.streakBody||minBody<p.minBody)continue;
 const rg=tr.high-tr.low,bd=Math.abs(tr.close-tr.open);if(!(rg>0)||rg/a<p.triggerRange||bd/rg<p.triggerBody)continue;
 let side=null,reject=0,failed=0;
 if(up){ // exhaustion of bullish streak => SELL
   reject=(tr.high-Math.max(tr.open,tr.close))/rg;
   failed=tr.high>last.high && tr.close<last.high;
   if(tr.close>=tr.open||reject<p.wick||!failed)continue;
   if((tr.close-tr.low)/rg>p.closeLoc)continue;
   side='SELL';
 }else{ // exhaustion of bearish streak => BUY
   reject=(Math.min(tr.open,tr.close)-tr.low)/rg;
   failed=tr.low<last.low && tr.close>last.low;
   if(tr.close<=tr.open||reject<p.wick||!failed)continue;
   if((tr.high-tr.close)/rg>p.closeLoc)continue;
   side='BUY';
 }
 const entry=tr.close,risk=a*p.sl,sl=side==='BUY'?entry-risk:entry+risk,tp=side==='BUY'?entry+risk:entry-risk;let R=0;
 for(let k=i+1;k<=i+p.hold;k++){const x=c[k];const hitSL=side==='BUY'?x.low<=sl:x.high>=sl,hitTP=side==='BUY'?x.high>=tp:x.low<=tp;if(hitSL){R=-1;break}if(hitTP){R=1;break}}
 // unresolved = 0 => counts against WR; no flattering mark-to-market
 out.push({r:R,time:tr.timestamp,side});i+=p.cool;
 }return out}
const c=load(),A=atr(c);const cut1=c[Math.floor(c.length*.60)].timestamp,cut2=c[Math.floor(c.length*.80)].timestamp;const R=[];
for(let z=0;z<22000;z++){
 const p={streak:pick([3,4,5]),move:pick([1.0,1.3,1.6,1.9,2.2,2.5]),streakBody:pick([.38,.45,.52,.60]),minBody:pick([.15,.25,.35]),triggerRange:pick([.55,.7,.85,1.0,1.15]),triggerBody:pick([.18,.25,.32,.40,.48]),wick:pick([.18,.25,.32,.40]),closeLoc:pick([.25,.35,.45,.55]),sl:pick([.55,.7,.85,1.0,1.15,1.3]),hold:pick([4,6,8,10,12,14]),cool:pick([1,2,3])};
 const t=simulate(c,A,p),d=t.filter(x=>x.time<cut1),v=t.filter(x=>x.time>=cut1&&x.time<cut2),h=t.filter(x=>x.time>=cut2),D=stats(d),V=stats(v),H=stats(h),S=stats(t);
 if(D.n<120||V.n<35||H.n<35)continue;if(D.wr<58||V.wr<57||H.wr<57)continue;if(D.pf<1.35||V.pf<1.30||H.pf<1.30||D.net<=0||V.net<=0||H.net<=0)continue;
 R.push({p,S,D,V,H,score:H.wr*5+V.wr*3+D.wr*2+Math.log10(S.n)*5-S.dd*.15});
}
R.sort((a,b)=>b.score-a.score);
console.log(`\n🔥 GOLD STREAK EXHAUSTION — STRICT RR 1:1 | ${c.length} M5 candles | 22000 tests\n3-5 same-direction candles -> failed continuation/rejection -> reverse\n60/20/20 chronological | timeouts are NON-WINS | research only\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if(!R.length){console.log('NO ROBUST STREAK-EXHAUSTION CANDIDATE PASSED GATE');process.exit(0)}
for(const [i,x] of R.slice(0,30).entries())console.log(`${i+1} | ALL T${x.S.n} WR${x.S.wr.toFixed(1)} PF${x.S.pf.toFixed(2)} Net${x.S.net.toFixed(1)}R DD${x.S.dd.toFixed(1)} LS${x.S.ls} | DISC T${x.D.n} WR${x.D.wr.toFixed(1)} PF${x.D.pf.toFixed(2)} | VAL T${x.V.n} WR${x.V.wr.toFixed(1)} PF${x.V.pf.toFixed(2)} | HOLD T${x.H.n} WR${x.H.wr.toFixed(1)} PF${x.H.pf.toFixed(2)} Net${x.H.net.toFixed(1)}R\n  ${JSON.stringify(x.p)}`);
