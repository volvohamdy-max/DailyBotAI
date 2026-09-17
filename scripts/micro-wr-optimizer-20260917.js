'use strict';
/* MICRO WR OPTIMIZER — 2026-09-17
   Entry-quality only. 70% DEV / 30% untouched HOLD. Current Q1164 is BASE.
   Goal: improve WR robustly without sacrificing PF/DD/sample.
*/
const fs=require('fs'),P='data/xauusd-m5-dukascopy.json';
const M=JSON.parse(fs.readFileSync(P,'utf8')).map(x=>({t:+(x.timestamp??x.time),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
function ema(p){let a=Array(M.length).fill(NaN),k=2/(p+1),x=M[0].c;for(let i=0;i<M.length;i++){x=i?M[i].c*k+x*(1-k):x;a[i]=x}return a}
function atr(p=14){let a=Array(M.length).fill(NaN);for(let i=p;i<M.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=Math.max(M[j].h-M[j].l,Math.abs(M[j].h-M[j-1].c),Math.abs(M[j].l-M[j-1].c));a[i]=s/p}return a}
const E9=ema(9),E21=ema(21),E50=ema(50),A=atr();
function signals(q){let z=[];for(let i=60;i<M.length-1;i++){let b=M[i],a=A[i],hr=new Date(b.t).getUTCHours();if(q.block.includes(hr)||![a,E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite)||!(a>0))continue;let rg=b.h-b.l,body=Math.abs(b.c-b.o);if(!(rg>0)||body/rg<q.body)continue;if(Math.abs(E9[i]-E21[i])/a<q.sep)continue;if(!(E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]))continue;let is=i-4,ie=i-2,imp=M[ie].c-M[is].o;if(imp<q.imp*a)continue;let pl=Infinity;for(let j=ie+1;j<i;j++)pl=Math.min(pl,M[j].l);let retr=(M[ie].c-pl)/imp;if(retr<q.rmin||retr>q.rmax)continue;let pos=(b.c-b.l)/rg;if(pos<q.pos||b.c<=M[i-1].h)continue;z.push(i)}return z}
function trades(q){let sig=new Set(signals(q)),out=[],p=null;for(let i=60;i<M.length;i++){if(p){let b=M[i],sl=b.l<=p.sl,tp=b.h>=p.tp;if(sl||tp||i-p.ei+1>=10){let px=sl?p.sl:tp?p.tp:b.c;out.push({t:M[p.si].t,r:(px-p.en)/p.risk});p=null}if(p)continue}let si=i-1;if(sig.has(si)){let en=M[i].o,risk=2*A[si];p={en,risk,sl:en-risk,tp:en+risk,ei:i,si}}}return out}
function S(a){let gp=0,gl=0,w=0,e=0,pk=0,dd=0,ls=0,mx=0;for(const x of a){e+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else if(x.r<0){gl-=x.r;ls++;mx=Math.max(mx,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{n:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?Infinity:0),net:e,dd,ls:mx}}
const F=s=>`T${s.n} WR${s.wr.toFixed(1)} PF${s.pf===Infinity?'∞':s.pf.toFixed(2)} N${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.ls}`;
const split=M[Math.floor(M.length*.70)].t;
// Exact current live Q1164 entry quality.
const base={block:[16,17,20],sep:.15,imp:1.3,body:.65,pos:.78,rmin:.12,rmax:.45};
const B=trades(base),BD=B.filter(x=>x.t<split),BH=B.filter(x=>x.t>=split),bsd=S(BD),bsh=S(BH);
console.log('MICRO Q1164 — WR OPTIMIZER');console.log('70% DEV / 30% UNTOUCHED HOLD | exits unchanged');console.log('Split:',new Date(split).toISOString());console.log('BASE DEV ',F(bsd));console.log('BASE HOLD',F(bsh));console.log('BASE ALL ',F(S(B)),'\n');
// Tight, interpretable quality search around Q1164. HOLD is never used for ranking.
const extraBlocks=[[],[13],[14],[15],[18],[19],[21],[22],[13,19],[14,19],[15,19],[18,19],[19,21],[13,21],[14,21]],seps=[.15,.18,.21,.24],imps=[1.3,1.4,1.5,1.6],bodies=[.65,.70,.75],poss=[.78,.82,.86],rmins=[.12,.16,.20],rmaxs=[.35,.40,.45];
let rows=[],id=0;for(const eb of extraBlocks)for(const sep of seps)for(const imp of imps)for(const body of bodies)for(const pos of poss)for(const rmin of rmins)for(const rmax of rmaxs){if(rmin>=rmax)continue;id++;let q={block:[...new Set([16,17,20,...eb])],sep,imp,body,pos,rmin,rmax},T=trades(q),D=T.filter(x=>x.t<split),H=T.filter(x=>x.t>=split),sd=S(D),sh=S(H);if(sd.n<80||sd.n<bsd.n*.52)continue;let score=(sd.wr-bsd.wr)*1.2+(sd.pf-bsd.pf)*8+(bsd.dd-sd.dd)*1.5-Math.max(0,100-sd.n)*.04;rows.push({id,q,sd,sh,all:S(T),score})}
rows.sort((a,b)=>b.score-a.score);const L=x=>`#${x.id} +BLOCK[${x.q.block.filter(h=>![16,17,20].includes(h)).join(',')||'-'}] SEP${x.q.sep} IMP${x.q.imp} BODY${x.q.body} POS${x.q.pos} RET${x.q.rmin}-${x.q.rmax} | DEV ${F(x.sd)} | HOLD ${F(x.sh)} | ALL ${F(x.all)}`;
console.log('🏆 TOP 20 — DEV ONLY RANKING');rows.slice(0,20).forEach(x=>console.log(L(x)));
const robust=rows.filter(x=>x.sd.wr>=bsd.wr+3&&x.sd.pf>=bsd.pf&&x.sd.dd<=bsd.dd&&x.sh.n>=25&&x.sh.wr>=bsh.wr&&x.sh.pf>=bsh.pf*.95&&x.sh.dd<=bsh.dd*1.10&&x.all.wr>=62&&x.all.pf>=1.45&&x.all.n>=120);
console.log('\n🛡️ ROBUST WR SHORTLIST (HOLD validation only)');if(!robust.length)console.log('NONE — Q1164 should stay unchanged.');else robust.slice(0,15).forEach(x=>console.log(L(x)));
