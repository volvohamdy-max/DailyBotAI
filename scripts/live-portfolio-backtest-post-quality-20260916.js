'use strict';
/* POST-QUALITY 7-STRATEGY PORTFOLIO BACKTEST — 2026-09-16
   Reads the proven fresh 2026-09-15 portfolio backtest source and applies ONLY the three validated live quality updates:
   Exhaustion #408: block UTC 01/05, ADX<=35, exhaustion body<=.55.
   Rapid #1297: block UTC 02/06/12/18 (plus existing 20/22), H1 sep .10.
   Micro #1164: block UTC 16/17 (plus existing 20), sep .15, body .65, close position .78.
   Other four strategies remain exactly as in the fresh baseline script.
*/
const fs=require('fs'),vm=require('vm');
const SRC='scripts/live-portfolio-backtest-20260915.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let s=fs.readFileSync(SRC,'utf8');
function must(oldv,newv,label){if(!s.includes(oldv)){console.error('❌ Patch anchor missing: '+label);process.exit(2)}s=s.replace(oldv,newv)}
// Exhaustion #408.
must("function signalEx(i){if(i<45||!Number.isFinite(A[i-1]))return;const ex=i-1,confirm=i,start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;", "function signalEx(i){if(i<45||!Number.isFinite(A[i-1])||!Number.isFinite(X[i-1]))return;const ex=i-1,confirm=i;if([1,5].includes(hour(M[ex].t))||X[ex]>35)return;const exRange=M[ex].h-M[ex].l;if(!(exRange>0)||Math.abs(M[ex].c-M[ex].o)/exRange>.55)return;const start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;",'Exhaustion #408');
// Rapid #1297.
must("if([20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.08)return;", "if([2,6,12,18,20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.10)return;",'Rapid #1297');
// Micro #1164. In the baseline, the UTC20 guard is part of the function's first condition.
must("function signalMicro(i){if(i<60||hour(M[i].t)===20||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.55||Math.abs(E9[i]-E21[i])/A[i]<.08)return;", "function signalMicro(i){if(i<60||[16,17,20].includes(hour(M[i].t))||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.65||Math.abs(E9[i]-E21[i])/A[i]<.15)return;",'Micro #1164 filters');
must("const pos=(b.c-b.l)/rg;if(pos<.66||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)", "const pos=(b.c-b.l)/rg;if(pos<.78||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)",'Micro #1164 close position');
s=s.replace('FRESH LIVE PORTFOLIO BACKTEST — 2026-09-15','POST-QUALITY LIVE PORTFOLIO BACKTEST — 2026-09-16');
console.log('PATCH CHECK OK: Exhaustion #408 + Rapid #1297 + Micro #1164; Grok/Pro/Range/Sweep unchanged.');
vm.runInNewContext(s,{require,console,process,__dirname:__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout},{filename:SRC});
