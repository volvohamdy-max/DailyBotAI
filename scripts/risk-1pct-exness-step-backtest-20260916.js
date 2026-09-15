'use strict';
/* Practical Exness-style 1% risk test.
 Start $1000. Risk cap = 1% current realized equity per trade.
 XAU contract assumption = 100 oz/lot. Lot min/step = 0.01.
 Raw lot is FLOORED to 0.01 step. If even 0.01 risks >1% at SL, trade is skipped.
 Cost assumption supplied by user = $0.20 per completed 0.01 lot, linear with lot.
*/
const fs=require('fs'),vm=require('vm');
const SRC='scripts/fixed-lot-001-backtest-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let s=fs.readFileSync(SRC,'utf8');
const anchor="console.log('\\nNOTE: historical candle execution only. Spread/commission/swap and live GoldAPI entry-gap/slippage are NOT included.');";
if(!s.includes(anchor)){console.error('❌ Capture anchor missing');process.exit(2)}
s=s.replace(anchor,"globalThis.__STEP_CAPTURE={all};\n"+anchor);
const quiet={log(){},error:console.error,warn:console.warn};
const ctx={require,console:quiet,process,__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout};
vm.runInNewContext(s,ctx,{filename:SRC});
const cap=ctx.__STEP_CAPTURE;if(!cap?.all){console.error('❌ Capture failed');process.exit(3)}
const trades=cap.all.map(t=>({...t})).sort((a,b)=>a.time-b.time);
const START=1000,RISK=.01,CONTRACT=100,STEP=.01,MIN=.01,COST001=.20;
const names={EXHAUSTION:'Exhaustion #408',RAPID:'Rapid #1297',GROK:'Grok #101',PRO:'Pro',RANGE:'Range',SWEEP:'Sweep',MICRO:'Micro #1164'};
const money=n=>(n<0?'-$':'$')+Math.abs(n).toFixed(2),f=n=>Number(n).toFixed(2),month=t=>new Date(t).toISOString().slice(0,7);
let eq=START,peak=START,peakTime=null,maxDD=0,maxDDPct=0,ddFrom=null,ddTo=null,totalCost=0,skipped=0;const skipBy={},out=[];
for(const t of trades){if(!(eq>0))break;const slDist=Math.abs(t.entry-t.sl);if(!(slDist>0))continue;const target=eq*RISK;const raw=target/(slDist*CONTRACT);let lot=Math.floor((raw+1e-12)/STEP)*STEP;lot=Number(lot.toFixed(2));if(lot<MIN){skipped++;skipBy[t.k]=(skipBy[t.k]||0)+1;continue}const stopRisk=slDist*CONTRACT*lot;if(stopRisk>target+1e-8){console.error('❌ Risk cap violated');process.exit(4)}const gross=t.priceMove*CONTRACT*lot,cost=(lot/.01)*COST001,net=gross-cost,before=eq;eq+=net;totalCost+=cost;if(eq>peak){peak=eq;peakTime=t.time}const dd=peak-eq,ddp=peak?100*dd/peak:0;if(dd>maxDD){maxDD=dd;ddFrom=peakTime;ddTo=t.time}maxDDPct=Math.max(maxDDPct,ddp);out.push({...t,before,after:eq,slDist,target,raw,lot,stopRisk,gross,cost,net})}
function stats(a){let gp=0,gl=0,w=0,ls=0,maxLs=0;for(const x of a){if(x.net>0){gp+=x.net;w++;ls=0}else if(x.net<0){gl+=-x.net;ls++;maxLs=Math.max(maxLs,ls)}}return{n:a.length,net:a.reduce((z,x)=>z+x.net,0),wr:a.length?100*w/a.length:0,pf:gl?gp/gl:Infinity,maxLs}}
const S=stats(out);
console.log('PRACTICAL 1% RISK — EXNESS 0.01 LOT STEP');
console.log('Start='+money(START)+' | Risk cap=1.00% current equity | Min/step=0.01 lot | Cost=$0.20 per 0.01 lot');
console.log('Rule: floor lot to 0.01; if calculated lot <0.01, SKIP trade.');
console.log('Signals='+trades.length+' | Executed='+out.length+' | Skipped='+skipped+' | WR='+f(S.wr)+'% | PF='+f(S.pf));
console.log('FINAL EQUITY='+money(eq)+' | NET='+money(eq-START)+' | RETURN='+f(100*(eq/START-1))+'%');
console.log('MAX DD='+money(maxDD)+' | MAX DD%='+f(maxDDPct)+'% | LS='+S.maxLs+' | TOTAL COST='+money(totalCost));if(ddFrom)console.log('MAX DD WINDOW: '+new Date(ddFrom).toISOString()+' → '+new Date(ddTo).toISOString());
const lots=out.map(x=>x.lot).sort((a,b)=>a-b),q=(p)=>lots.length?lots[Math.min(lots.length-1,Math.floor((lots.length-1)*p))]:0;console.log('\nLOT REALITY');console.log('Min='+q(0).toFixed(2)+' | Median='+q(.5).toFixed(2)+' | P95='+q(.95).toFixed(2)+' | Max='+q(1).toFixed(2));
console.log('\nSKIPPED BY STRATEGY');for(const k of Object.keys(names))console.log(names[k]+': '+(skipBy[k]||0));
console.log('\nBY STRATEGY');for(const k of Object.keys(names)){const a=out.filter(x=>x.k===k),x=stats(a);if(a.length)console.log(names[k]+' | T'+x.n+' WR'+f(x.wr)+'% PF'+f(x.pf)+' | NET '+money(x.net)+' | avgLot '+(a.reduce((z,t)=>z+t.lot,0)/a.length).toFixed(3))}
console.log('\nMONTHLY EQUITY');const mm={};for(const x of out)(mm[month(x.time)]??=[]).push(x);for(const m of Object.keys(mm).sort()){const a=mm[m],x=stats(a),start=a[0].before,end=a.at(-1).after;let pk=start,dd=0;for(const t of a){pk=Math.max(pk,t.after);dd=Math.max(dd,pk-t.after)}console.log(m+' | START '+money(start)+' → END '+money(end)+' | NET '+money(end-start)+' | '+f(100*(end/start-1))+'% | T'+a.length+' PF'+f(x.pf)+' | DD '+money(dd)+' | avgLot '+(a.reduce((z,t)=>z+t.lot,0)/a.length).toFixed(3))}
const risks=out.map(x=>100*x.stopRisk/x.before).sort((a,b)=>a-b),rq=p=>risks.length?risks[Math.min(risks.length-1,Math.floor((risks.length-1)*p))]:0;console.log('\nACTUAL RISK AFTER LOT ROUNDING');console.log('Median='+f(rq(.5))+'% | P95='+f(rq(.95))+'% | Max='+f(rq(1))+'%');
console.log('\nNOTE: This is the practical lot-step version of the historical model. It intentionally skips trades that cannot fit the 1% cap at minimum 0.01 lot. Variable spread/slippage, swap, latency and GoldAPI-vs-broker entry gaps remain unmodeled.');
