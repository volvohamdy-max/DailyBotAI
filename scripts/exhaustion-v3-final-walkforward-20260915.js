'use strict';
/* FINAL WALK-FORWARD VALIDATION — Gold Exhaustion V3
   Compares LIVE baseline vs simple finalists from quality optimizer.
   NO optimization/ranking on future blocks. Core Exhaustion entry + exits unchanged.
   Candidates:
   BASE current
   A #405: block UTC 01,05 + ADX<=35
   B #404: block UTC 01,05 + BODY<=0.55
   C #408: block UTC 01,05 + ADX<=35 + BODY<=0.55
*/
const fs=require('fs');
const P='data/xauusd-m5-dukascopy.json';
const M=JSON.parse(fs.readFileSync(P,'utf8')).map(x=>({t:+(x.timestamp??x.time),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
function atr(c,p=14){let a=Array(c.length).fill(NaN),q=[],s=0;for(let i=1;i<c.length;i++){let z=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(z);s+=z;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}
function adx(c,p=14){const o=Array(c.length).fill(NaN),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){let u=c[i].h-c[i-1].h,d=c[i-1].l-c[i].l;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c))}let t=0,pdS=0,mdS=0;for(let i=1;i<=p&&i<c.length;i++){t+=tr[i];pdS+=pd[i];mdS+=md[i]}let dx=Array(c.length).fill(NaN);for(let i=p;i<c.length;i++){if(i>p){t=t-t/p+tr[i];pdS=pdS-pdS/p+pd[i];mdS=mdS-mdS/p+md[i]}if(t){let a=100*pdS/t,b=100*mdS/t;if(a+b)dx[i]=100*Math.abs(a-b)/(a+b)}}let sum=0,n=0,last=NaN;for(let i=p;i<c.length;i++){if(!Number.isFinite(dx[i]))continue;if(n<p){sum+=dx[i];n++;if(n===p)last=o[i]=sum/p}else last=o[i]=(last*(p-1)+dx[i])/p}return o}
const A=atr(M),D=adx(M),H=t=>new Date(t).getUTCHours();
function run(cfg){let out=[],pos=null;for(let i=60;i<M.length-1;i++){if(pos){let b=M[i],sl=pos.s==='BUY'?b.l<=pos.sl:b.h>=pos.sl,tp=pos.s==='BUY'?b.h>=pos.tp:b.l<=pos.tp;if(sl||tp||i-pos.ei+1>=3){let px=sl?pos.sl:tp?pos.tp:b.c,r=(pos.s==='BUY'?px-pos.en:pos.en-px)/pos.risk;out.push({t:M[pos.si].t,r,s:pos.s});pos=null}if(pos)continue}let e=i-1,k=i;if(!Number.isFinite(A[e]))continue;let st=M[e-3].c,en=M[e-1].c,di=en-st;if(!di)continue;let side=di<0?'BUY':'SELL',burst=side==='BUY'?2.2:2.6;if(Math.abs(di)<A[e]*burst)continue;let ag=0;for(let j=e-3;j<e;j++){if(di>0&&M[j].c>M[j].o)ag++;if(di<0&&M[j].c<M[j].o)ag++}if(ag<2)continue;let b=M[e],rg=b.h-b.l;if(!(rg>0))continue;let uw=(b.h-Math.max(b.o,b.c))/rg,lw=(Math.min(b.o,b.c)-b.l)/rg;if(side==='BUY'&&lw<.30)continue;if(side==='SELL'&&uw<.30)continue;if(side==='BUY'){if(M[k].c<=b.l+rg*.15||M[k].l<b.l-A[e]*.25)continue}else if(M[k].c>=b.h-rg*.15||M[k].h>b.h+A[e]*.25)continue;if(cfg.block&&cfg.block.includes(H(M[i].t)))continue;if(cfg.adxMax&&(!Number.isFinite(D[e])||D[e]>cfg.adxMax))continue;let body=Math.abs(b.c-b.o)/rg;if(cfg.bodyMax&&body>cfg.bodyMax)continue;let entry=M[i+1].o,risk=Math.max(A[e]*1.75,2),rew=Math.max(A[e]*1.5,2);pos={s:side,en:entry,risk,sl:side==='BUY'?entry-risk:entry+risk,tp:side==='BUY'?entry+rew:entry-rew,ei:i+1,si:i}}return out}
function S(a){let gp=0,gl=0,n=0,w=0,eq=0,pk=0,dd=0,ls=0,mx=0;for(const x of a){n++;eq+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{if(x.r<0)gl+=-x.r;ls++;mx=Math.max(mx,ls)}pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)}return{n,w,wr:n?100*w/n:0,pf:gl?gp/gl:(gp?Infinity:0),net:eq,dd,ls:mx}}
const F=s=>`T${s.n} WR${s.wr.toFixed(1)} PF${s.pf===Infinity?'∞':s.pf.toFixed(2)} N${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.ls}`;
const C=[['BASE',{}],['A #405',{block:[1,5],adxMax:35}],['B #404',{block:[1,5],bodyMax:.55}],['C #408',{block:[1,5],adxMax:35,bodyMax:.55}]];
const R=C.map(([name,c])=>[name,run(c)]);
console.log('EXHAUSTION V3 — FINAL WALK-FORWARD');console.log('Core logic unchanged | UTC blocks 01,05');console.log('Egypt currently (UTC+3): 01→04:00, 05→08:00\n');
console.log('FULL PERIOD');for(const [n,a] of R)console.log(n.padEnd(8),F(S(a)));
// six chronological equal-time blocks
let lo=M[0].t,hi=M[M.length-1].t,span=(hi-lo)/6;console.log('\n6-BLOCK WALK-FORWARD STABILITY');let wins={};for(const [n] of R)wins[n]={pos:0,pf1:0,better:0};for(let q=0;q<6;q++){let a=lo+q*span,b=q===5?hi+1:lo+(q+1)*span;console.log(`\nBLOCK ${q+1} ${new Date(a).toISOString().slice(0,10)} → ${new Date(b-1).toISOString().slice(0,10)}`);let bs=S(R[0][1].filter(x=>x.t>=a&&x.t<b));for(const [n,tr] of R){let s=S(tr.filter(x=>x.t>=a&&x.t<b));console.log(n.padEnd(8),F(s));if(s.net>0)wins[n].pos++;if(s.pf>=1)wins[n].pf1++;if(n!=='BASE'&&s.pf>=bs.pf&&s.dd<=bs.dd)wins[n].better++}}
console.log('\nSTABILITY SCORECARD');for(const [n] of R){let z=wins[n];console.log(`${n.padEnd(8)} positive blocks ${z.pos}/6 | PF>=1 blocks ${z.pf1}/6${n==='BASE'?'':` | PF>=BASE & DD<=BASE ${z.better}/6`}`)}
// rolling 4-month train -> next 2-month test, purely reporting fixed finalists
console.log('\nROLLING 4M → NEXT 2M FIXED-CANDIDATE TESTS');let months=[];for(const x of M){let d=new Date(x.t),m=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;if(!months.includes(m))months.push(m)}for(let j=4;j<months.length;j+=2){let test=months.slice(j,j+2);if(!test.length)break;console.log('\nTEST '+test.join(' + '));for(const [n,tr] of R){let a=tr.filter(x=>test.includes(new Date(x.t).toISOString().slice(0,7)));console.log(n.padEnd(8),F(S(a)))}}
console.log('\nDECISION RULE: prefer a simpler candidate only if improvement repeats across blocks; do not select on FULL result alone.');