'use strict';
// READ-ONLY exact event-level portfolio for CURRENT LIVE session mix.
// Hard-locked evaluation window: 2025-09-10 00:00 UTC -> 2026-09-10 23:59:59.999 UTC.
// Instruments research scripts only; NEVER imports or modifies live runtime.
const fs=require('fs'),path=require('path'),vm=require('vm');
const START=Date.parse('2025-09-10T00:00:00.000Z');
const END=Date.parse('2026-09-10T23:59:59.999Z');
function runLab(file,exportCode){const p=path.join(__dirname,file);let src=fs.readFileSync(p,'utf8')+`\n${exportCode}\n`;const s={require,console:{log:()=>{},error:()=>{}},process,__dirname,path,Buffer,setTimeout,clearTimeout,globalThis:null};s.globalThis=s;vm.createContext(s);vm.runInContext(src,s,{filename:p});return s.__EVENT_EXPORT;}
const h=runLab('backtest-live-hours-24h-lab.js',';globalThis.__EVENT_EXPORT={M,all,cur};');
const g=runLab('backtest-all-live-gold-strategies.js',';globalThis.__EVENT_EXPORT={M,GR,RM};');
function ev(M,strategy,x){return{strategy,t:M[x.i]?.t,i:x.i,side:x.side,r:x.r};}
let raw=[];
for(const n of ['EXHAUSTION','RAPID','PRO','MICRO'])raw.push(...h.all[n].map(x=>ev(h.M,n,x)));
raw.push(...h.cur.SWEEP5.map(x=>ev(h.M,'SWEEP5',x)));
raw.push(...g.GR.map(x=>ev(g.M,'GROK92',x)),...g.RM.map(x=>ev(g.M,'RANGE_MR',x)));
const preWindow=raw.filter(x=>Number.isFinite(x.t)&&x.t<START).length,postWindow=raw.filter(x=>Number.isFinite(x.t)&&x.t>END).length;
let events=raw.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.r)&&x.t>=START&&x.t<=END).sort((a,b)=>a.t-b.t||a.i-b.i||a.strategy.localeCompare(b.strategy));
let eq=0,peak=0,maxDD=0,ddPeakT=null,maxDDStart=null,maxDDEnd=null,w=0,l=0,be=0,gp=0,gl=0;
const monthly=new Map(),daily=new Map(),atTime=new Map(),by={};
for(const e of events){if(e.r>0){w++;gp+=e.r}else if(e.r<0){l++;gl-=e.r}else be++;eq+=e.r;if(eq>peak){peak=eq;ddPeakT=e.t}else{const dd=peak-eq;if(dd>maxDD){maxDD=dd;maxDDStart=ddPeakT;maxDDEnd=e.t}}const d=new Date(e.t),mk=d.toISOString().slice(0,7),dk=d.toISOString().slice(0,10);monthly.set(mk,(monthly.get(mk)||0)+e.r);daily.set(dk,(daily.get(dk)||0)+e.r);atTime.set(e.t,(atTime.get(e.t)||0)+1);const a=by[e.strategy]||(by[e.strategy]={t:0,r:0,w:0,gp:0,gl:0});a.t++;a.r+=e.r;if(e.r>0){a.w++;a.gp+=e.r}else if(e.r<0)a.gl-=e.r;}
const ms=[...monthly].sort((a,b)=>a[0].localeCompare(b[0])),ds=[...daily];const bestM=ms.reduce((a,b)=>!a||b[1]>a[1]?b:a,null),worstM=ms.reduce((a,b)=>!a||b[1]<a[1]?b:a,null),bestD=ds.reduce((a,b)=>!a||b[1]>a[1]?b:a,null),worstD=ds.reduce((a,b)=>!a||b[1]<a[1]?b:a,null);let maxSame=0;for(const n of atTime.values())maxSame=Math.max(maxSame,n);
console.log('\n📈 CURRENT LIVE MIX — ALL 7 EVENT PORTFOLIO (READ ONLY)');
console.log('WINDOW: 2025-09-10 -> 2026-09-10 UTC (hard locked)');
console.log('24H: Exhaustion / Rapid / Grok92 / Pro / Range MR / Micro');
console.log('Sweep5 restricted to [9,10,11,12,17] UTC');
console.log(`Filtered outside window: before=${preWindow} after=${postWindow}\n`);
for(const n of ['EXHAUSTION','RAPID','GROK92','PRO','RANGE_MR','SWEEP5','MICRO']){const a=by[n];if(a)console.log(`${n.padEnd(11)} T${String(a.t).padStart(4)} WR${(100*a.w/a.t).toFixed(1)}% PF${a.gl?(a.gp/a.gl).toFixed(2):'∞'} Net${a.r>=0?'+':''}${a.r.toFixed(1)}R`);}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`TOTAL TRADES        : ${events.length}`);
console.log(`W / L / BE          : ${w} / ${l} / ${be}`);
console.log(`WIN RATE            : ${(100*w/events.length).toFixed(1)}%`);
console.log(`PROFIT FACTOR       : ${gl?(gp/gl).toFixed(2):'∞'}`);
console.log(`NET R               : ${eq>=0?'+':''}${eq.toFixed(1)}R`);
console.log(`MAX DRAWDOWN        : ${maxDD.toFixed(1)}R`);
if(maxDDEnd)console.log(`MAX DD WINDOW       : ${maxDDStart?new Date(maxDDStart).toISOString():'n/a'} -> ${new Date(maxDDEnd).toISOString()}`);
if(bestM)console.log(`BEST MONTH          : ${bestM[0]} ${bestM[1]>=0?'+':''}${bestM[1].toFixed(1)}R`);
if(worstM)console.log(`WORST MONTH         : ${worstM[0]} ${worstM[1]>=0?'+':''}${worstM[1].toFixed(1)}R`);
if(bestD)console.log(`BEST DAY            : ${bestD[0]} ${bestD[1]>=0?'+':''}${bestD[1].toFixed(1)}R`);
if(worstD)console.log(`WORST DAY           : ${worstD[0]} ${worstD[1]>=0?'+':''}${worstD[1].toFixed(1)}R`);
console.log(`MAX SAME TIMESTAMP  : ${maxSame}`);
console.log('\nMONTHLY NET R');for(const [m,r] of ms)console.log(`${m}  ${r>=0?'+':''}${r.toFixed(1)}R`);
console.log('\n🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');