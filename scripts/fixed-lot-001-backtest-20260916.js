'use strict';
/* Fixed-lot XAUUSD backtest using FINAL live-rule reconstruction.
   0.01 lot assumption: 100 oz per 1.00 lot => 0.01 lot = 1 oz.
   Therefore a $1.00 XAU price move = $1.00 P/L at 0.01 lot.
   No spread, commission, swap or historical live-price slippage included.
*/
const fs=require('fs'),vm=require('vm');
const BASE='scripts/live-portfolio-backtest-20260915.js';
if(!fs.existsSync(BASE)){console.error('❌ Missing '+BASE);process.exit(1)}
let s=fs.readFileSync(BASE,'utf8');
function must(a,b,label){if(!s.includes(a)){console.error('❌ Patch anchor missing: '+label);process.exit(2)}s=s.replace(a,b)}
must("function signalEx(i){if(i<45||!Number.isFinite(A[i-1]))return;const ex=i-1,confirm=i,start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;","function signalEx(i){if(i<45||!Number.isFinite(A[i-1])||!Number.isFinite(X[i-1]))return;const ex=i-1,confirm=i;if([1,5].includes(hour(M[ex].t))||X[ex]>35)return;const exRange=M[ex].h-M[ex].l;if(!(exRange>0)||Math.abs(M[ex].c-M[ex].o)/exRange>.55)return;const start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;",'Exhaustion #408');
must("if([20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.08)return;","if([2,6,12,18,20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.10)return;",'Rapid #1297');
must("function signalMicro(i){if(i<60||hour(M[i].t)===20||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.55||Math.abs(E9[i]-E21[i])/A[i]<.08)return;","function signalMicro(i){if(i<60||[16,17,20].includes(hour(M[i].t))||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.65||Math.abs(E9[i]-E21[i])/A[i]<.15)return;",'Micro #1164 filters');
must("const pos=(b.c-b.l)/rg;if(pos<.66||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)","const pos=(b.c-b.l)/rg;if(pos<.78||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)",'Micro #1164 pos');
must("if(up&&R[i]>52)side='BUY';if(dn&&R[i]<48)side='SELL';","if(up&&R[i]>52)side='BUY';if(dn&&R[i]<44)side='SELL';",'Grok #101 RSI');
must("if(!(va>0&&M[i].v>=va*1.25)||HX[h]<20)return;","if(!(va>0&&M[i].v>=va*1.25)||HX[h]<22)return;",'Grok #101 ADX');
must("if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.10)return;","if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.30)return;",'Grok #101 distance');
s += "\n;globalThis.__FIXED_CAPTURE={trades,M,defs};\n";
const quiet={log(){},error:console.error,warn:console.warn};const ctx={require,console:quiet,process,__dirname,__filename:BASE,Buffer,setTimeout,clearTimeout};vm.runInNewContext(s,ctx,{filename:BASE});
const cap=ctx.__FIXED_CAPTURE;if(!cap){console.error('❌ Capture failed');process.exit(3)}
const LOT=0.01, CONTRACT=100, OZ=LOT*CONTRACT; // 1 oz at 0.01 lot
const names={EXHAUSTION:'Exhaustion #408',RAPID:'Rapid #1297',GROK:'Grok #101',PRO:'Pro',RANGE:'Range',SWEEP:'Sweep',MICRO:'Micro #1164'};
const all=[];for(const [k,arr] of Object.entries(cap.trades))for(const t of arr){const entry=t.entry,exit=t.px;const priceMove=t.side==='BUY'?exit-entry:entry-exit;all.push({...t,k,time:cap.M[t.exitI].t,priceMove,usd:priceMove*OZ})}all.sort((a,b)=>a.time-b.time);
const f=n=>Number(n).toFixed(2), money=n=>(n<0?'-$':'$')+Math.abs(n).toFixed(2), month=t=>new Date(t).toISOString().slice(0,7);
function stats(a){let net=0,gp=0,gl=0,w=0,l=0,eq=0,peak=0,dd=0,peakTime=null,ddFrom=null,ddTo=null,ls=0,maxLs=0;for(const t of a){net+=t.usd;if(t.usd>0){gp+=t.usd;w++;ls=0}else if(t.usd<0){gl+=-t.usd;l++;ls++;maxLs=Math.max(maxLs,ls)}eq+=t.usd;if(eq>peak){peak=eq;peakTime=t.time}if(peak-eq>dd){dd=peak-eq;ddFrom=peakTime;ddTo=t.time}}return{n:a.length,net,gp,gl,pf:gl?gp/gl:Infinity,w,l,wr:a.length?100*w/a.length:0,dd,ddFrom,ddTo,maxLs}}
const S=stats(all);
console.log('FIXED LOT XAUUSD BACKTEST — FINAL LIVE RULES');
console.log('Lot='+LOT.toFixed(2)+' | Contract assumption='+CONTRACT+' oz/lot | Exposure='+OZ.toFixed(2)+' oz');
console.log('At 0.01 lot: $1.00 gold move = $'+OZ.toFixed(2)+' P/L');
console.log('Trades='+S.n+' | WR='+f(S.wr)+'% | PF='+f(S.pf)+' | NET='+money(S.net)+' | MAX DD='+money(S.dd)+' | LS='+S.maxLs);
if(S.ddFrom)console.log('MAX DD WINDOW: '+new Date(S.ddFrom).toISOString()+' → '+new Date(S.ddTo).toISOString());
console.log('\nBY STRATEGY');for(const k of Object.keys(cap.trades)){const x=stats(all.filter(t=>t.k===k));console.log(names[k]+' | T'+x.n+' WR'+f(x.wr)+'% PF'+f(x.pf)+' | NET '+money(x.net)+' | DD '+money(x.dd)+' | LS'+x.maxLs)}
console.log('\nMONTHLY USD');const mm={};for(const t of all)(mm[month(t.time)]??=[]).push(t);for(const m of Object.keys(mm).sort()){const x=stats(mm[m]);console.log(m+' | T'+x.n+' WR'+f(x.wr)+'% PF'+f(x.pf)+' | '+money(x.net)+' | DD '+money(x.dd))}
console.log('\nRISK REALITY @ FIXED 0.01 LOT');const losses=all.filter(t=>t.usd<0).map(t=>-t.usd).sort((a,b)=>a-b),wins=all.filter(t=>t.usd>0).map(t=>t.usd).sort((a,b)=>a-b);const q=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;console.log('Median losing trade: '+money(q(losses,.5))+' | 95th percentile loss: '+money(q(losses,.95))+' | Worst trade: '+money(losses.at(-1)||0));console.log('Median winning trade: '+money(q(wins,.5))+' | 95th percentile win: '+money(q(wins,.95))+' | Best trade: '+money(wins.at(-1)||0));
console.log('\nNOTE: historical candle execution only. Spread/commission/swap and live GoldAPI entry-gap/slippage are NOT included.');
