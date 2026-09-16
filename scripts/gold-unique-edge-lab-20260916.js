'use strict';
/* UNIQUE GOLD EDGE LAB — research only, never live.
Tests three price-only proxies for genuinely different edge families using the existing 1Y XAU M5 file:
A) Liquidity Trap: sweep prior high/low then reclaim.
B) Compression Expansion: low recent range then confirmed breakout.
C) Failed Expansion Reversal: oversized impulse fails/reclaims.
DEV first 75%, untouched HOLD last 25%. Next-bar-open entry. One trade/model. SL before TP if both hit same bar.
External DXY/US10Y is intentionally NOT faked here: we do not have synchronized historical series in the repo dataset.
*/
const fs=require('fs');const F='data/xauusd-m5-dukascopy.json';if(!fs.existsSync(F)){console.error('missing '+F);process.exit(1)}
const j=JSON.parse(fs.readFileSync(F,'utf8')),R=Array.isArray(j)?j:(j.candles||j.data||[]);const M=R.map(x=>({t:+new Date(x.t||x.time||x.timestamp),o:+(x.o??x.open),h:+(x.h??x.high),l:+(x.l??x.low),c:+(x.c??x.close)})).filter(x=>Number.isFinite(x.t+x.o+x.h+x.l+x.c)).sort((a,b)=>a.t-b.t),N=M.length;
function atr(n=14){let o=Array(N).fill(null),tr=M.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-M[i-1].c),Math.abs(b.l-M[i-1].c)):b.h-b.l),s=0;for(let i=0;i<N;i++){if(i<n){s+=tr[i];if(i===n-1)o[i]=s/n}else o[i]=(o[i-1]*(n-1)+tr[i])/n}return o}const A=atr(),split=Math.floor(N*.75);
function levels(i,L){let h=-Infinity,l=Infinity;for(let k=i-L;k<i;k++){h=Math.max(h,M[k].h);l=Math.min(l,M[k].l)}return[h,l]}
function signal(type,p,i){if(!A[i]||i<Math.max(60,p.look||1))return null;const b=M[i],rg=b.h-b.l,body=Math.abs(b.c-b.o);if(rg<=0)return null;const [hh,ll]=levels(i,p.look);if(type==='TRAP'){const up=b.h>hh+p.sweep*A[i]&&b.c<hh&&((b.h-Math.max(b.o,b.c))/rg)>=p.wick;const dn=b.l<ll-p.sweep*A[i]&&b.c>ll&&((Math.min(b.o,b.c)-b.l)/rg)>=p.wick;return up?'SELL':dn?'BUY':null}
if(type==='COMP'){let hi=-Infinity,lo=Infinity;for(let k=i-p.comp;k<i;k++){hi=Math.max(hi,M[k].h);lo=Math.min(lo,M[k].l)}const width=(hi-lo)/A[i],bf=body/rg,cp=(b.c-b.l)/rg;if(width>p.width||bf<p.body)return null;if(b.c>hi&&cp>=p.close)return'BUY';if(b.c<lo&&(1-cp)>=p.close)return'SELL';return null}
if(type==='FAIL'){const prev=M[i-1],pr=prev.h-prev.l,pb=Math.abs(prev.c-prev.o);if(pr/A[i]<p.big||pb/pr<p.body)return null;const up=prev.c>prev.o&&b.c<prev.o&&b.l<prev.l+p.reclaim*A[i];const dn=prev.c<prev.o&&b.c>prev.o&&b.h>prev.h-p.reclaim*A[i];return up?'SELL':dn?'BUY':null}return null}
function run(type,p,lo,hi){let out=[],o=null;for(let i=lo;i<=hi;i++){if(o){const b=M[i];let px=null;if(o.s==='BUY'){if(b.l<=o.sl)px=o.sl;else if(b.h>=o.tp)px=o.tp}else{if(b.h>=o.sl)px=o.sl;else if(b.l<=o.tp)px=o.tp}if(px==null&&i-o.ei>=p.hold)px=b.c;if(px!=null){out.push({...o,r:o.s==='BUY'?(px-o.en)/(o.en-o.sl):(o.en-px)/(o.sl-o.en)});o=null}continue}const s=signal(type,p,i);if(!s)continue;const en=M[i+1].o,risk=p.sl*A[i];o={s,en,sl:s==='BUY'?en-risk:en+risk,tp:s==='BUY'?en+p.rr*risk:en-p.rr*risk,ei:i+1}}return out}
function stat(a){let gp=0,gl=0,w=0,e=0,pk=0,dd=0,ls=0,ml=0;for(const x of a){e+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl+=-x.r;ls++;ml=Math.max(ml,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{n:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:99,net:e,dd,ls:ml}}
let cand=[];function add(type,p){const d=stat(run(type,p,60,split-2));if(d.n>=30)cand.push({type,p,d,score:d.net-d.dd+Math.min(d.pf,3)})}
for(const look of[6,12,20,30])for(const sweep of[.03,.08,.15,.25])for(const wick of[.35,.5,.65])for(const rr of[.8,1,1.25,1.5])add('TRAP',{look,sweep,wick,rr,sl:1,hold:12});
for(const comp of[6,12,18,24])for(const width of[1.5,2,2.5,3])for(const body of[.55,.7])for(const close of[.7,.8])for(const rr of[1,1.25,1.5])add('COMP',{look:comp,comp,width,body,close,rr,sl:1,hold:12});
for(const big of[1.2,1.5,1.8,2.2])for(const body of[.6,.75])for(const reclaim of[.05,.15,.3])for(const rr of[.8,1,1.25,1.5])add('FAIL',{look:2,big,body,reclaim,rr,sl:1,hold:12});
cand.sort((a,b)=>b.score-a.score);console.log('UNIQUE GOLD EDGE LAB — DEV / UNTOUCHED HOLD');console.log(`M5=${N} | DEV=${split} | HOLD=${N-split} | models=${cand.length}`);console.log('\n🏆 TOP 30 DEV');cand.slice(0,30).forEach((x,k)=>console.log(`${k+1} | ${x.type} ${JSON.stringify(x.p)} | T${x.d.n} WR${x.d.wr.toFixed(1)} PF${x.d.pf.toFixed(2)} N${x.d.net>=0?'+':''}${x.d.net.toFixed(2)}R DD${x.d.dd.toFixed(2)} LS${x.d.ls}`));
console.log('\n🔐 HOLDOUT — TOP 20 DEV');cand.slice(0,20).forEach((x,k)=>{const h=stat(run(x.type,x.p,split,N-2));console.log(`${k+1} | ${x.type} | DEV T${x.d.n} PF${x.d.pf.toFixed(2)} N${x.d.net.toFixed(2)} DD${x.d.dd.toFixed(2)} || HOLD T${h.n} WR${h.wr.toFixed(1)} PF${h.pf.toFixed(2)} N${h.net>=0?'+':''}${h.net.toFixed(2)}R DD${h.dd.toFixed(2)} LS${h.ls} | ${JSON.stringify(x.p)}`)});
console.log('\nRULE: no live addition from this output. A survivor must next pass walk-forward + BUY/SELL + monthly stability + portfolio collision tests.');
