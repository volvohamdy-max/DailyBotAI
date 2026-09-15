'use strict';
/* Execution-cost stress test for final fixed 0.01-lot portfolio. */
const fs=require('fs'),vm=require('vm');
const SRC='scripts/fixed-lot-001-backtest-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let s=fs.readFileSync(SRC,'utf8');
const anchor="console.log('\\nNOTE: historical candle execution only. Spread/commission/swap and live GoldAPI entry-gap/slippage are NOT included.');";
if(!s.includes(anchor)){console.error('❌ Capture anchor missing');process.exit(2)}
s=s.replace(anchor,"globalThis.__COST_CAPTURE={all,LOT,CONTRACT,OZ};\n"+anchor);
const quiet={log(){},error:console.error,warn:console.warn};
const ctx={require,console:quiet,process,__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout};
vm.runInNewContext(s,ctx,{filename:SRC});
const cap=ctx.__COST_CAPTURE;if(!cap||!cap.all){console.error('❌ Capture failed');process.exit(3)}
const raw=cap.all.map(t=>({...t}));
const scenarios=[0,0.20,0.40,0.60,1.00,1.50,2.00];
const f=n=>Number(n).toFixed(2),money=n=>(n<0?'-$':'$')+Math.abs(n).toFixed(2),month=t=>new Date(t).toISOString().slice(0,7);
function stats(cost){let eq=0,peak=0,dd=0,net=0,gp=0,gl=0,w=0,l=0,be=0,ls=0,maxLs=0,from=null,to=null,peakAt=null;for(const t of raw){const p=t.usd-cost;net+=p;if(p>0){gp+=p;w++;ls=0}else if(p<0){gl+=-p;l++;ls++;maxLs=Math.max(maxLs,ls)}else{be++;ls=0}eq+=p;if(eq>peak){peak=eq;peakAt=t.time}const d=peak-eq;if(d>dd){dd=d;from=peakAt;to=t.time}}return{cost,net,pf:gl?gp/gl:Infinity,wr:100*w/raw.length,w,l,be,dd,maxLs,from,to}}
const base=stats(0);
console.log('FIXED 0.01 LOT — EXECUTION COST STRESS TEST');
console.log('Trades='+raw.length+' | 0.01 lot | $1 gold move = $1 gross P/L');
console.log('Each COST below = total round-trip drag PER TRADE (spread + slippage + commission equivalent).');
console.log('\nCOST / TRADE | TOTAL COST | NET | PF | WR(after cost) | MAX DD | LS');
for(const c of scenarios){const x=stats(c);console.log('$'+f(c)+' | '+money(c*raw.length)+' | '+money(x.net)+' | '+f(x.pf)+' | '+f(x.wr)+'% | '+money(x.dd)+' | '+x.maxLs)}
const grossAvg=base.net/raw.length;
console.log('\nBREAK-EVEN EXECUTION DRAG');
console.log('Gross expectancy per trade = '+money(grossAvg));
console.log('Approx break-even all-in cost/trade = '+money(grossAvg));
console.log('If real average round-trip execution drag approaches this number, historical net edge is consumed.');
console.log('\nMONTHLY STRESS @ $0.60 / TRADE');
const by={};for(const t of raw)(by[month(t.time)]??=[]).push(t);
for(const m of Object.keys(by).sort()){const a=by[m];let net=0,gp=0,gl=0,w=0;for(const t of a){const p=t.usd-.60;net+=p;if(p>0){gp+=p;w++}else if(p<0)gl+=-p}console.log(m+' | T'+a.length+' | NET '+money(net)+' | PF '+f(gl?gp/gl:Infinity)+' | WR '+f(100*w/a.length)+'%')}
console.log('\nIMPORTANT: sensitivity test only; real spread/slippage/commission can vary by trade.');
