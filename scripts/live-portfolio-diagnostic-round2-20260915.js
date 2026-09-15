'use strict';
/* FRESH DIAGNOSTIC ROUND 2 — current live-rule backtest only.
   This does NOT alter live strategy rules and does NOT import old backtest results.
   It executes the fresh current-rule backtest in-process, captures its trades, then
   diagnoses each strategy by UTC signal hour, side, half-year, exit reason and recent period.
*/
const fs=require('fs'),vm=require('vm');
const FILE='scripts/live-portfolio-backtest-20260915.js';
if(!fs.existsSync(FILE)){console.error('❌ Missing '+FILE);process.exit(1)}
let src=fs.readFileSync(FILE,'utf8');
// Suppress the base report and export its freshly generated trade arrays.
src=src.replace(/console\.log\(/g,'__log(');
src+='\n;globalThis.__DIAG_TRADES=trades;globalThis.__DIAG_M=M;globalThis.__DIAG_DEFS=defs;\n';
const sandbox={require,module:{},exports:{},console,__log:()=>{},process,Buffer,setTimeout,clearTimeout,globalThis:null};sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(src,sandbox,{filename:FILE});
const trades=sandbox.__DIAG_TRADES,M=sandbox.__DIAG_M,defs=sandbox.__DIAG_DEFS;
if(!trades||!M){console.error('❌ Could not capture fresh backtest trades');process.exit(1)}
const day=t=>new Date(t).toISOString().slice(0,10),month=t=>day(t).slice(0,7),hour=t=>new Date(t).getUTCHours();
function stats(a){let gp=0,gl=0,net=0,peak=0,dd=0,ls=0,maxLs=0,w=0;for(const x of a){const r=Number(x.r)||0;net+=r;if(r>0){gp+=r;w++;ls=0}else if(r<0){gl+=-r;ls++;maxLs=Math.max(maxLs,ls)}peak=Math.max(peak,net);dd=Math.max(dd,peak-net)}return{n:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?Infinity:0),net,dd,ls:maxLs}}
function fmt(s){return`T${s.n} WR${s.wr.toFixed(1)}% PF${s.pf===Infinity?'∞':s.pf.toFixed(2)} NET${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)}R LS${s.ls}`}
function groups(a,key){const m=new Map;for(const x of a){const k=key(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return[...m.entries()].map(([k,v])=>[k,stats(v)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]),undefined,{numeric:true}))}
function printGroups(title,rows,min=1){console.log('\n'+title);for(const[k,s]of rows)if(s.n>=min)console.log(String(k).padStart(9)+' | '+fmt(s))}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('LIVE PORTFOLIO — DIAGNOSTIC ROUND 2');
console.log('Fresh trades generated from scripts/live-portfolio-backtest-20260915.js');
console.log('NO LIVE RULE CHANGES | NO OPTIMIZATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const focus=new Set(['EXHAUSTION','RAPID','GROK','MICRO']);
for(const k of Object.keys(defs)){
 const a=trades[k]||[];console.log('\n\n████ '+defs[k].name+' ████');console.log('ALL      | '+fmt(stats(a)));
 printGroups('SIDE',groups(a,x=>x.side));
 printGroups('SIGNAL UTC HOUR',groups(a,x=>String(hour(M[x.signalI].t)).padStart(2,'0')+':00'),focus.has(k)?5:3);
 printGroups('EXIT REASON',groups(a,x=>x.reason));
 printGroups('HALF-YEAR',groups(a,x=>{const d=new Date(M[x.signalI].t),y=d.getUTCFullYear(),h=d.getUTCMonth()<6?'H1':'H2';return y+'-'+h}));
 printGroups('MONTH',groups(a,x=>month(M[x.signalI].t)),3);
 const recent=a.filter(x=>M[x.signalI].t>=Date.parse('2026-07-01T00:00:00Z'));console.log('\nRECENT JUL→END | '+fmt(stats(recent)));
 if(focus.has(k)){
   const hrs=groups(a,x=>hour(M[x.signalI].t)).filter(([,s])=>s.n>=8).sort((a,b)=>a[1].net-b[1].net);
   console.log('\nWORST HOURS (diagnostic only; NOT recommendations)');for(const[h,s]of hrs.slice(0,6))console.log(String(h).padStart(2,'0')+':00 UTC | '+fmt(s));
   const badMonths=groups(a,x=>month(M[x.signalI].t)).filter(([,s])=>s.n>=5&&s.net<0).sort((a,b)=>a[1].net-b[1].net);
   console.log('\nNEGATIVE MONTHS');if(!badMonths.length)console.log('none');else for(const[m,s]of badMonths)console.log(m+' | '+fmt(s));
 }
}
const all=Object.entries(trades).flatMap(([k,a])=>a.map(x=>({...x,strategy:k})));
console.log('\n\n━━━━━━━━ PORTFOLIO DIAGNOSTIC ━━━━━━━━');console.log('ALL | '+fmt(stats(all)));
printGroups('PORTFOLIO BY UTC SIGNAL HOUR',groups(all,x=>String(hour(M[x.signalI].t)).padStart(2,'0')+':00'),10);
printGroups('PORTFOLIO BY MONTH',groups(all,x=>month(M[x.signalI].t)),10);
const recent=all.filter(x=>M[x.signalI].t>=Date.parse('2026-07-01T00:00:00Z'));console.log('\nPORTFOLIO JUL→END | '+fmt(stats(recent)));
console.log('\nNOTE: Hours are SIGNAL candle UTC hours. This is diagnosis, not parameter selection.');
