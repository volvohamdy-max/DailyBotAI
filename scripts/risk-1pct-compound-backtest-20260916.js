'use strict';
/* Final portfolio: true 1% equity risk per trade, sized from each trade's actual SL distance.
   Starting equity $1000. Lot is recalculated at each entry from current realized equity.
   Exness cost assumption supplied by user: $0.20 round-trip per 0.01 lot, linear with lot.
   Fractional lot is kept exact to measure the strategy/risk model; output also reports lot distribution.
*/
const fs=require('fs'),vm=require('vm');
const SRC='scripts/fixed-lot-001-backtest-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let s=fs.readFileSync(SRC,'utf8');
const anchor="console.log('\\nNOTE: historical candle execution only. Spread/commission/swap and live GoldAPI entry-gap/slippage are NOT included.');";
if(!s.includes(anchor)){console.error('❌ Capture anchor missing');process.exit(2)}
s=s.replace(anchor,"globalThis.__RISK_CAPTURE={all};\n"+anchor);
const quiet={log(){},error:console.error,warn:console.warn};
const ctx={require,console:quiet,process,__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout};
vm.runInNewContext(s,ctx,{filename:SRC});
const cap=ctx.__RISK_CAPTURE;if(!cap||!cap.all){console.error('❌ Capture failed');process.exit(3)}
const trades=cap.all.map(t=>({...t})).sort((a,b)=>a.time-b.time);
const START=1000,RISK=.01,COST_PER_001=.20,CONTRACT=100;
const names={EXHAUSTION:'Exhaustion #408',RAPID:'Rapid #1297',GROK:'Grok #101',PRO:'Pro',RANGE:'Range',SWEEP:'Sweep',MICRO:'Micro #1164'};
const money=n=>(n<0?'-$':'$')+Math.abs(n).toFixed(2),f=n=>Number(n).toFixed(2),month=t=>new Date(t).toISOString().slice(0,7);
let equity=START,peak=START,maxDD=0,maxDDPct=0,ddFrom=null,ddTo=null,peakTime=null,totalCost=0;
const out=[];
for(const t of trades){
  if(!(equity>0))break;
  const riskUsd=equity*RISK;
  const slDist=Math.abs(t.entry-t.sl);
  if(!(slDist>0))continue;
  // XAU: loss at SL = slDist * 100 * lot. So lot = risk$/(slDist*100).
  const lot=riskUsd/(slDist*CONTRACT);
  const gross=t.priceMove*CONTRACT*lot;
  const cost=COST_PER_001*(lot/.01);
  const net=gross-cost;
  const before=equity; equity+=net; totalCost+=cost;
  if(equity>peak){peak=equity;peakTime=t.time}
  const dd=peak-equity,ddPct=peak>0?100*dd/peak:0;
  if(dd>maxDD){maxDD=dd;maxDDPct=ddPct;ddFrom=peakTime;ddTo=t.time}
  out.push({...t,before,riskUsd,slDist,lot,gross,cost,net,after:equity});
}
function stat(a){let gp=0,gl=0,w=0,l=0,ls=0,maxLs=0;for(const t of a){if(t.net>0){gp+=t.net;w++;ls=0}else if(t.net<0){gl+=-t.net;l++;ls++;maxLs=Math.max(maxLs,ls)}}return{n:a.length,net:a.reduce((z,t)=>z+t.net,0),pf:gl?gp/gl:Infinity,wr:a.length?100*w/a.length:0,maxLs}}
const S=stat(out),lots=out.map(t=>t.lot).sort((a,b)=>a-b),q=(a,p)=>a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;
console.log('TRUE 1% EQUITY-RISK BACKTEST — FINAL LIVE RULES');
console.log('Start='+money(START)+' | Risk=1.00% of current realized equity PER TRADE | Exness cost=$0.20 per 0.01 lot');
console.log('Sizing: lot = riskUSD / (SL distance × 100)');
console.log('Trades='+S.n+' | WR(after cost)='+f(S.wr)+'% | PF='+f(S.pf));
console.log('FINAL EQUITY='+money(equity)+' | NET='+money(equity-START)+' | RETURN='+f(100*(equity/START-1))+'%');
console.log('MAX DD='+money(maxDD)+' | MAX DD='+f(maxDDPct)+'% | LS='+S.maxLs+' | TOTAL COST='+money(totalCost));
if(ddFrom)console.log('MAX DD WINDOW: '+new Date(ddFrom).toISOString()+' → '+new Date(ddTo).toISOString());
console.log('\nLOT REALITY');
console.log('Min='+q(lots,0).toFixed(4)+' | Median='+q(lots,.5).toFixed(4)+' | P95='+q(lots,.95).toFixed(4)+' | Max='+q(lots,1).toFixed(4));
console.log('\nBY STRATEGY');
for(const k of Object.keys(names)){const a=out.filter(t=>t.k===k),x=stat(a);if(a.length)console.log(names[k]+' | T'+x.n+' WR'+f(x.wr)+'% PF'+f(x.pf)+' | NET '+money(x.net)+' | avgLot '+(a.reduce((z,t)=>z+t.lot,0)/a.length).toFixed(4))}
console.log('\nMONTHLY EQUITY');
const mm={};for(const t of out)(mm[month(t.time)]??=[]).push(t);
for(const m of Object.keys(mm).sort()){const a=mm[m],x=stat(a),start=a[0].before,end=a[a.length-1].after;let p=start,pk=start,dd=0;for(const t of a){p=t.after;pk=Math.max(pk,p);dd=Math.max(dd,pk-p)}console.log(m+' | START '+money(start)+' → END '+money(end)+' | NET '+money(end-start)+' | '+f(100*(end/start-1))+'% | T'+a.length+' PF'+f(x.pf)+' | DD '+money(dd))}
console.log('\nNOTE: 1% is targeted at the strategy SL before execution cost. Cost makes an SL loss slightly worse than exactly 1%. Fractional lots are theoretical; broker lot-step/minimum constraints are not rounded here. Historical live entry-gap/slippage remains unmodeled.');
