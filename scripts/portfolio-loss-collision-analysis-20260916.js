'use strict';
/* Portfolio collision / drawdown diagnostic — diagnostic only, no live changes. */
const fs=require('fs'),vm=require('vm');
const BASE='scripts/live-portfolio-backtest-20260915.js';
if(!fs.existsSync(BASE)){console.error('❌ Missing '+BASE);process.exit(1)}
let s=fs.readFileSync(BASE,'utf8');
function must(a,b,label){if(!s.includes(a)){console.error('❌ Patch anchor missing: '+label);process.exit(2)}s=s.replace(a,b)}
// Final live-quality patches.
must("function signalEx(i){if(i<45||!Number.isFinite(A[i-1]))return;const ex=i-1,confirm=i,start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;","function signalEx(i){if(i<45||!Number.isFinite(A[i-1])||!Number.isFinite(X[i-1]))return;const ex=i-1,confirm=i;if([1,5].includes(hour(M[ex].t))||X[ex]>35)return;const exRange=M[ex].h-M[ex].l;if(!(exRange>0)||Math.abs(M[ex].c-M[ex].o)/exRange>.55)return;const start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;",'Exhaustion #408');
must("if([20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.08)return;","if([2,6,12,18,20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.10)return;",'Rapid #1297');
must("function signalMicro(i){if(i<60||hour(M[i].t)===20||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.55||Math.abs(E9[i]-E21[i])/A[i]<.08)return;","function signalMicro(i){if(i<60||[16,17,20].includes(hour(M[i].t))||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.65||Math.abs(E9[i]-E21[i])/A[i]<.15)return;",'Micro #1164 filters');
must("const pos=(b.c-b.l)/rg;if(pos<.66||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)","const pos=(b.c-b.l)/rg;if(pos<.78||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)",'Micro #1164 pos');
must("if(up&&R[i]>52)side='BUY';if(dn&&R[i]<48)side='SELL';","if(up&&R[i]>52)side='BUY';if(dn&&R[i]<44)side='SELL';",'Grok #101 RSI');
must("if(!(va>0&&M[i].v>=va*1.25)||HX[h]<20)return;","if(!(va>0&&M[i].v>=va*1.25)||HX[h]<22)return;",'Grok #101 ADX');
must("if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.10)return;","if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.30)return;",'Grok #101 distance');
// Append capture inside SAME lexical script where trades and M exist.
s += "\n;globalThis.__PORTFOLIO_CAPTURE={trades,M};\n";
const quiet={log(){},error:console.error,warn:console.warn};
const ctx={require,console:quiet,process,__dirname,__filename:BASE,Buffer,setTimeout,clearTimeout};
vm.runInNewContext(s,ctx,{filename:BASE});
const cap=ctx.__PORTFOLIO_CAPTURE;if(!cap||!cap.trades){console.error('❌ Capture failed');process.exit(3)}
const names={EXHAUSTION:'Exhaustion',RAPID:'Rapid',GROK:'Grok',PRO:'Pro',RANGE:'Range',SWEEP:'Sweep',MICRO:'Micro'};
const all=[];for(const [k,arr] of Object.entries(cap.trades))for(const t of arr)all.push({...t,k,start:cap.M[t.entryI]?.t,end:cap.M[t.exitI]?.t});all.sort((a,b)=>a.end-b.end);
const f=n=>Number(n).toFixed(2),iso=t=>new Date(t).toISOString().replace('.000Z','Z');
function dd(list){let eq=0,peak=0,max=0,from=null,to=null,peakAt=null;for(const t of list){eq+=t.r;if(eq>peak){peak=eq;peakAt=t.end}const d=peak-eq;if(d>max){max=d;from=peakAt;to=t.end}}return{max,from,to}}
const D=dd(all);console.log('PORTFOLIO LOSS COLLISION ANALYSIS — FINAL LIVE RULES');console.log('Trades='+all.length+' | Net='+f(all.reduce((z,t)=>z+t.r,0))+'R | DD='+f(D.max)+'R');console.log('MAX DD WINDOW: '+(D.from?iso(D.from):'START')+' → '+iso(D.to)+' | '+f(D.max)+'R');
const pair={};for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];if(a.k===b.k)continue;if(b.start>a.end)break;if(a.start<=b.end&&b.start<=a.end){const key=[a.k,b.k].sort().join('|'),x=pair[key]??={n:0,same:0,bothLoss:0,r:0};x.n++;if(a.side===b.side)x.same++;if(a.r<0&&b.r<0)x.bothLoss++;x.r+=a.r+b.r;pair[key]=x}}
console.log('\nTOP OVERLAP PAIRS');Object.entries(pair).sort((a,b)=>b[1].bothLoss-a[1].bothLoss||b[1].n-a[1].n).slice(0,15).forEach(([k,x])=>console.log(k.replace('|',' + ')+' | overlap '+x.n+' | sameSide '+x.same+' | BOTH LOSS '+x.bothLoss+' | pairR '+f(x.r)));
const clusters=[];for(let i=0;i<all.length;i++){if(all[i].r>=0)continue;const g=[all[i]];for(let j=i+1;j<all.length&&all[j].end-all[i].end<=30*60000;j++)if(all[j].r<0&&all[j].k!==all[i].k)g.push(all[j]);if(g.length>=2)clusters.push(g)}const uniq=new Map();for(const g of clusters){const ks=[...new Set(g.map(x=>x.k))].sort(),key=Math.floor(g[0].end/(30*60000))+'|'+ks.join(',');if(!uniq.has(key))uniq.set(key,g)}
console.log('\nWORST 30-MIN LOSS CLUSTERS');[...uniq.values()].sort((a,b)=>a.reduce((z,x)=>z+x.r,0)-b.reduce((z,x)=>z+x.r,0)).slice(0,15).forEach(g=>console.log(iso(g[0].end)+' | '+[...new Set(g.map(x=>names[x.k]))].join('+')+' | '+f(g.reduce((z,x)=>z+x.r,0))+'R'));
const inDD=all.filter(t=>(!D.from||t.end>D.from)&&t.end<=D.to),by={};for(const t of inDD){const x=by[t.k]??={n:0,r:0,l:0};x.n++;x.r+=t.r;if(t.r<0)x.l++;by[t.k]=x}console.log('\nMAX-DD CONTRIBUTORS');Object.entries(by).sort((a,b)=>a[1].r-b[1].r).forEach(([k,x])=>console.log(names[k]+' | T'+x.n+' losses '+x.l+' | '+(x.r>=0?'+':'')+f(x.r)+'R'));
const hrs=Array.from({length:24},(_,h)=>({h,n:0,r:0,l:0,ks:{}}));for(const t of all){const h=new Date(t.start).getUTCHours(),x=hrs[h];x.n++;x.r+=t.r;if(t.r<0)x.l++;x.ks[t.k]=(x.ks[t.k]||0)+t.r}console.log('\nWORST ENTRY HOURS UTC');hrs.sort((a,b)=>a.r-b.r).slice(0,8).forEach(x=>console.log(String(x.h).padStart(2,'0')+' UTC | T'+x.n+' losses '+x.l+' | '+(x.r>=0?'+':'')+f(x.r)+'R | '+Object.entries(x.ks).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([k,r])=>names[k]+':' +(r>=0?'+':'')+f(r)).join(' ')));
console.log('\nDONE — diagnostic only; no live rules changed.');
