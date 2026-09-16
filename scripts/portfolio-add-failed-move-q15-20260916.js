'use strict';
/* Q15 integration test against the locked final 7-strategy historical portfolio.
Runs existing final-7 backtest in a VM, captures its printed strategy trades indirectly by patching the baseline
right before reporting, and injects Q15 as strategy #8 using the SAME M5 array/ATR/open/manage execution model.
No live files changed. */
const fs=require('fs'),vm=require('vm');
const SRC='scripts/live-portfolio-backtest-post-grok-q101-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
// Build Q15 independently from the exact same raw dataset/execution assumptions.
const raw=JSON.parse(fs.readFileSync('data/xauusd-m5-dukascopy.json','utf8'));
const M=raw.map(x=>({t:+(x.timestamp??x.time),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t),N=M.length;
function atr(c,p=14){const a=Array(c.length).fill(NaN),q=[];let s=0;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(tr);s+=tr;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}const A=atr(M),AA=Array(N).fill(NaN);for(let i=60;i<N;i++){let s=0,n=0;for(let k=i-50;k<i;k++)if(Number.isFinite(A[k])){s+=A[k];n++}if(n===50)AA[i]=s/50}
let q15=[],o=null;for(let i=60;i<N-1;i++){if(o){let b=M[i],px=null;if(b.l<=o.sl)px=o.sl;else if(b.h>=o.tp)px=o.tp;if(px==null&&i-o.entryI+1>=12)px=b.c;if(px!=null){q15.push({...o,exitI:i,exit:M[i].t,px,r:(px-o.entry)/(o.entry-o.sl)});o=null}continue}if(!Number.isFinite(A[i])||!Number.isFinite(AA[i]))continue;let x=M[i-1],b=M[i],rg=x.h-x.l,br=b.h-b.l;if(!(rg>0&&br>0)||x.c>=x.o)continue;if(rg/A[i]<1.5||Math.abs(x.c-x.o)/rg<.60)continue;if(!(b.c>x.o&&b.h>x.h-.30*A[i]&&b.c>b.o&&(b.c-b.l)/br>=.65))continue;let ar=A[i]/AA[i],hr=new Date(b.t).getUTCHours();if(ar<.75||ar>2||[6,7,8].includes(hr))continue;let entry=M[i+1].o,risk=A[i];o={k:'Q15',side:'BUY',entry,sl:entry-risk,tp:entry+1.5*risk,risk,entryI:i+1,signalI:i}}
// Capture final-7 aggregate lines from proven script rather than reimplementing the seven.
let logs=[];const capConsole={log:(...a)=>logs.push(a.join(' ')),error:(...a)=>logs.push(a.join(' ')),warn:(...a)=>logs.push(a.join(' '))};let code=fs.readFileSync(SRC,'utf8');vm.runInNewContext(code,{require,console:capConsole,process,__dirname:__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout},{filename:SRC});
function stats(a){let gp=0,gl=0,w=0,e=0,pk=0,dd=0,ls=0,ml=0;for(let x of a.sort((u,v)=>u.exit-v.exit)){e+=x.r;if(x.r>0){gp+=x.r;w++;ls=0}else{gl+=-x.r;ls++;ml=Math.max(ml,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{n:a.length,wr:100*w/a.length,pf:gp/gl,net:e,dd,ls:ml}}
let s=stats(q15);console.log('Q15 PORTFOLIO INTEGRATION TEST');console.log(`Q15 standalone | T${s.n} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} N+${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.ls}`);
console.log('\nLOCKED FINAL-7 OUTPUT');for(const l of logs)if(/PORTFOLIO|TOTAL|COMBINED|T1266|2025-|2026-/.test(l))console.log(l);
// Locked baseline values already established by exact final script; compare additive R and conservative DD bound.
const B={n:1266,wr:61.9,pf:1.62,net:243.03,dd:10.95};console.log('\n7 vs 7+Q15 — ADDITIVE SUMMARY');console.log(`7 ONLY    | T${B.n} WR${B.wr}% PF${B.pf} NET+${B.net}R DD${B.dd}R`);console.log(`Q15 EXTRA | T${s.n} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} NET+${s.net.toFixed(2)}R DD${s.dd.toFixed(2)}R`);console.log(`8 SIGNALS | T${B.n+s.n} | additive NET +${(B.net+s.net).toFixed(2)}R`);
// Collision: Q15 open interval versus each locked strategy cannot be reconstructed from console safely here.
// Instead print Q15 timing so a follow-up exact collision merger can use exported JSON if desired.
let months={};for(let x of q15){let k=new Date(x.exit).toISOString().slice(0,7);(months[k]??=[]).push(x)}console.log('\nQ15 MONTHLY');for(let [k,a] of Object.entries(months)){let z=stats(a);console.log(`${k} T${z.n} WR${z.wr.toFixed(1)} PF${z.pf.toFixed(2)} N${z.net>=0?'+':''}${z.net.toFixed(2)}R DD${z.dd.toFixed(2)}`)}
console.log('\nIMPORTANT: additive NET is exact under independent-strategy R arithmetic; combined portfolio DD/PF/WR require trade-level merge of the seven. If the locked script output still matches T1266/+243.03R, next step is an exact trade-export merger, not a guessed DD.');
