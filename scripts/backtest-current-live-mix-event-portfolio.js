'use strict';
// READ-ONLY event-level portfolio for CURRENT LIVE session mix.
// Reuses the research lab by instrumenting its in-memory trades; NEVER imports/modifies live runtime.
const fs=require('fs'),path=require('path'),vm=require('vm');
const lab=path.join(__dirname,'backtest-live-hours-24h-lab.js');
let src=fs.readFileSync(lab,'utf8');
// Export generated event arrays from the already-validated research lab.
src += `\n;globalThis.__EVENT_EXPORT={M,all,cur};\n`;
const sandbox={require,console:{log:()=>{},error:()=>{}},process,__dirname,path,Buffer,setTimeout,clearTimeout,globalThis:null};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(src,sandbox,{filename:lab});
const {M,all,cur}=sandbox.__EVENT_EXPORT;
function ev(strategy,x){return{strategy,t:M[x.i]?.t,i:x.i,side:x.side,r:x.r};}
let events=[];
for(const n of ['EXHAUSTION','RAPID','PRO','MICRO'])events.push(...all[n].map(x=>ev(n,x)));
events.push(...cur.SWEEP5.map(x=>ev('SWEEP5',x)));
// Grok92 and Range MR event streams are not exposed by the legacy summary script.
// Therefore this script reports an exact chronological portfolio for the five hour-lab strategies,
// and explicitly keeps Grok92/Range MR outside rather than fabricating their timing/DD.
events=events.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.r)).sort((a,b)=>a.t-b.t||a.i-b.i);
let eq=0,peak=0,maxDD=0,ddStart=null,maxDDStart=null,maxDDEnd=null,w=0,l=0,be=0,gp=0,gl=0;
const monthly=new Map(),daily=new Map(),atTime=new Map();
for(const e of events){if(e.r>0){w++;gp+=e.r}else if(e.r<0){l++;gl-=e.r}else be++;const before=eq;eq+=e.r;if(eq>peak){peak=eq;ddStart=e.t}else{const dd=peak-eq;if(dd>maxDD){maxDD=dd;maxDDStart=ddStart;maxDDEnd=e.t}}const d=new Date(e.t),mk=d.toISOString().slice(0,7),dk=d.toISOString().slice(0,10);monthly.set(mk,(monthly.get(mk)||0)+e.r);daily.set(dk,(daily.get(dk)||0)+e.r);atTime.set(e.t,(atTime.get(e.t)||0)+1);}
const ms=[...monthly].sort((a,b)=>a[0].localeCompare(b[0]));const ds=[...daily];const bestM=ms.reduce((a,b)=>!a||b[1]>a[1]?b:a,null),worstM=ms.reduce((a,b)=>!a||b[1]<a[1]?b:a,null),bestD=ds.reduce((a,b)=>!a||b[1]>a[1]?b:a,null),worstD=ds.reduce((a,b)=>!a||b[1]<a[1]?b:a,null);let maxSame=0;for(const n of atTime.values())maxSame=Math.max(maxSame,n);
const by={};for(const e of events){const a=by[e.strategy]||(by[e.strategy]={t:0,r:0,w:0});a.t++;a.r+=e.r;if(e.r>0)a.w++;}
console.log('\n📈 CURRENT LIVE MIX — EVENT PORTFOLIO (READ ONLY)');
console.log('Exact chronological events available from hour-lab strategies');
console.log('Sweep5 restricted to [9,10,11,12,17] UTC\n');
for(const [n,a] of Object.entries(by))console.log(`${n.padEnd(11)} T${String(a.t).padStart(4)} WR${(100*a.w/a.t).toFixed(1)}% Net${a.r>=0?'+':''}${a.r.toFixed(1)}R`);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`EVENT TRADES       : ${events.length}`);
console.log(`W / L / BE         : ${w} / ${l} / ${be}`);
console.log(`WIN RATE           : ${(100*w/events.length).toFixed(1)}%`);
console.log(`PROFIT FACTOR      : ${gl? (gp/gl).toFixed(2):'∞'}`);
console.log(`NET R              : ${eq>=0?'+':''}${eq.toFixed(1)}R`);
console.log(`MAX DRAWDOWN       : ${maxDD.toFixed(1)}R`);
if(maxDDEnd)console.log(`MAX DD WINDOW      : ${maxDDStart?new Date(maxDDStart).toISOString():'n/a'} -> ${new Date(maxDDEnd).toISOString()}`);
if(bestM)console.log(`BEST MONTH         : ${bestM[0]} ${bestM[1]>=0?'+':''}${bestM[1].toFixed(1)}R`);
if(worstM)console.log(`WORST MONTH        : ${worstM[0]} ${worstM[1]>=0?'+':''}${worstM[1].toFixed(1)}R`);
if(bestD)console.log(`BEST DAY           : ${bestD[0]} ${bestD[1]>=0?'+':''}${bestD[1].toFixed(1)}R`);
if(worstD)console.log(`WORST DAY          : ${worstD[0]} ${worstD[1]>=0?'+':''}${worstD[1].toFixed(1)}R`);
console.log(`MAX SAME TIMESTAMP : ${maxSame}`);
console.log('\n⚠️ GROK92 + RANGE_MR are excluded from chronological DD because the existing legacy backtest exposes only their summaries, not individual event timestamps.');
console.log('Their previously measured summary remains: GROK92 T194 Net+34.6R; RANGE_MR T33 Net+15.1R.');
console.log('🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');