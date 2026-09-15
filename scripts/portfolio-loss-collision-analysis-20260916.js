'use strict';
/* Portfolio collision / drawdown diagnostic.
   Runs the final Q101 portfolio backtest in a VM, suppresses its normal report,
   captures strategy trades, then diagnoses overlapping exposure and losses.
*/
const fs=require('fs'),vm=require('vm');
const SRC='scripts/live-portfolio-backtest-post-grok-q101-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let code=fs.readFileSync(SRC,'utf8');
// Export internal baseline trade arrays after the nested backtest finishes.
const realVm=vm;
const outerRequire=id=>{
 if(id==='vm') return {...realVm,runInNewContext(inner,ctx,opt){
   const inject="\n;globalThis.__PORTFOLIO_CAPTURE={trades,M};\n";
   return realVm.runInNewContext(inner+inject,ctx,opt);
 }};
 return require(id);
};
const quiet={log(){},error:console.error,warn:console.warn};
const outer={require:outerRequire,console:quiet,process,__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout};
realVm.runInNewContext(code,outer,{filename:SRC});
const cap=outer.__PORTFOLIO_CAPTURE;
if(!cap||!cap.trades){console.error('❌ Could not capture portfolio trades');process.exit(2)}
const names={EXHAUSTION:'Exhaustion',RAPID:'Rapid',GROK:'Grok',PRO:'Pro',RANGE:'Range',SWEEP:'Sweep',MICRO:'Micro'};
const all=[];
for(const [k,arr] of Object.entries(cap.trades))for(const t of arr)all.push({...t,k,start:cap.M[t.entryI]?.t,end:cap.M[t.exitI]?.t});
all.sort((a,b)=>a.end-b.end);
const f=n=>Number(n).toFixed(2), iso=t=>new Date(t).toISOString().replace('.000Z','Z');
function dd(list){let eq=0,peak=0,max=0,from=null,to=null,peakAt=null;for(const t of list){eq+=t.r;if(eq>peak){peak=eq;peakAt=t.end}const d=peak-eq;if(d>max){max=d;from=peakAt;to=t.end}}return{max,from,to}}
console.log('PORTFOLIO LOSS COLLISION ANALYSIS');
console.log('Trades='+all.length+' | Final net='+f(all.reduce((s,t)=>s+t.r,0))+'R | DD='+f(dd(all).max)+'R');
const D=dd(all);console.log('MAX DD WINDOW: '+(D.from?iso(D.from):'START')+' → '+iso(D.to)+' | '+f(D.max)+'R');
// Exact simultaneous exposure pairs: intervals overlap.
const pair={};for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];if(a.k===b.k)continue;if(b.start>a.end)break;if(a.start<=b.end&&b.start<=a.end){const key=[a.k,b.k].sort().join('|');const x=pair[key]??={n:0,same:0,bothLoss:0,r:0};x.n++;if(a.side===b.side)x.same++;if(a.r<0&&b.r<0)x.bothLoss++;x.r+=a.r+b.r;pair[key]=x}}
console.log('\nTOP OVERLAP PAIRS');Object.entries(pair).sort((a,b)=>b[1].bothLoss-a[1].bothLoss||b[1].n-a[1].n).slice(0,15).forEach(([k,x])=>console.log(k.replace('|',' + ')+' | overlap '+x.n+' | sameSide '+x.same+' | BOTH LOSS '+x.bothLoss+' | pairR '+f(x.r)));
// Losses closed close together (30 minutes) identify clustered pain even if entries differ.
const clusters=[];for(let i=0;i<all.length;i++){if(all[i].r>=0)continue;const g=[all[i]];for(let j=i+1;j<all.length&&all[j].end-all[i].end<=30*60000;j++)if(all[j].r<0&&all[j].k!==all[i].k)g.push(all[j]);if(g.length>=2)clusters.push(g)}
const uniq=new Map();for(const g of clusters){const ks=[...new Set(g.map(x=>x.k))].sort();const key=Math.floor(g[0].end/(30*60000))+'|'+ks.join(',');if(!uniq.has(key))uniq.set(key,g)}
console.log('\nWORST 30-MIN LOSS CLUSTERS');[...uniq.values()].sort((a,b)=>a.reduce((s,x)=>s+x.r,0)-b.reduce((s,x)=>s+x.r,0)).slice(0,15).forEach(g=>console.log(iso(g[0].end)+' | '+[...new Set(g.map(x=>names[x.k]))].join('+')+' | '+f(g.reduce((s,x)=>s+x.r,0))+'R'));
// During max DD window, contribution by strategy.
const inDD=all.filter(t=>(!D.from||t.end>D.from)&&t.end<=D.to), by={};for(const t of inDD){const x=by[t.k]??={n:0,r:0,l:0};x.n++;x.r+=t.r;if(t.r<0)x.l++;by[t.k]=x}
console.log('\nMAX-DD CONTRIBUTORS');Object.entries(by).sort((a,b)=>a[1].r-b[1].r).forEach(([k,x])=>console.log(names[k]+' | T'+x.n+' losses '+x.l+' | '+(x.r>=0?'+':'')+f(x.r)+'R'));
// Same UTC hour portfolio stats by strategy losses, useful for portfolio guard candidates.
const hrs=Array.from({length:24},(_,h)=>({h,n:0,r:0,l:0,ks:{}}));for(const t of all){const h=new Date(t.start).getUTCHours(),x=hrs[h];x.n++;x.r+=t.r;if(t.r<0)x.l++;x.ks[t.k]=(x.ks[t.k]||0)+t.r}
console.log('\nWORST ENTRY HOURS UTC');hrs.sort((a,b)=>a.r-b.r).slice(0,8).forEach(x=>console.log(String(x.h).padStart(2,'0')+' UTC | T'+x.n+' losses '+x.l+' | '+(x.r>=0?'+':'')+f(x.r)+'R | '+Object.entries(x.ks).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([k,r])=>names[k]+':' +(r>=0?'+':'')+f(r)).join(' ')));
console.log('\nDONE — diagnostic only; no live rules changed.');
