'use strict';
/** CORE SIX CURRENT — 6M. Research only. Live untouched.
 * Reuses the audited 6M runner, captures its resolved trades, and reports
 * the original six-family portfolio excluding only Micro Pullback + Volatility Transition.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const runner=path.resolve('scripts/backtest-current-live-audited-6m.js');
let src=fs.readFileSync(runner,'utf8');
const needle="console.log('\\n📊 CURRENT 8 LIVE — AUDITED 6 MONTH BACKTEST');";
const cut=src.indexOf(needle);if(cut<0)throw Error('audited 6M report marker not found');
src=src.slice(0,cut)+"\n;globalThis.__CORE6={done,reportStart,end};";
const box={require,console:{log(){}},process,__dirname:path.dirname(runner),__filename:runner};vm.createContext(box);vm.runInContext(src,box,{timeout:120000});
const {done,reportStart,end}=box.__CORE6;
const EXCLUDE=new Set(['GOLD_MICRO_PULLBACK','GOLD_VOLATILITY_TRANSITION']);
const core=done.filter(x=>!EXCLUDE.has(x.id));
function stats(a){let w=0,l=0,be=0,net=0,gw=0,gl=0,pk=0,dd=0,ls=0,maxls=0;for(const x of [...a].sort((a,b)=>a.t-b.t)){if(x.r>0){w++;gw+=x.r;ls=0}else if(x.r<0){l++;gl-=x.r;ls++;maxls=Math.max(maxls,ls)}else if(x.kind==='BE')be++;net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:a.length,w,l,be,wr:w+l?100*w/(w+l):0,pf:gl?gw/gl:(gw?99:0),net,dd,maxls}}
function line(label,a){const s=stats(a);return `${label.padEnd(30)} T${s.n} W${s.w}/L${s.l}/BE${s.be} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.maxls}`}
console.log('\n🧪 CORE SIX CURRENT — AUDITED 6 MONTH');console.log(`${new Date(reportStart).toISOString().slice(0,10)} → ${new Date(end).toISOString().slice(0,10)}`);console.log('Excluded ONLY: Gold Micro Pullback + Gold Volatility Transition');console.log('No live files changed. Same resolved trades/outcome model as audited current-8 test.');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');for(const id of [...new Set(core.map(x=>x.id))]){const a=core.filter(x=>x.id===id);console.log(line(a[0].label,a))}console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log(line('CORE SIX TOTAL',core));
console.log('\n📅 CORE SIX — MONTH BY MONTH');for(const m of [...new Set(core.map(x=>new Date(x.t).toISOString().slice(0,7)))])console.log(line(m,core.filter(x=>new Date(x.t).toISOString().startsWith(m))));
// Also show exact arithmetic what each new addition did to the same sample.
const micro=done.filter(x=>x.id==='GOLD_MICRO_PULLBACK'),vol=done.filter(x=>x.id==='GOLD_VOLATILITY_TRANSITION');
console.log('\n🔬 SAME SAMPLE COMPARISON');console.log(line('CORE SIX',core));console.log(line('CORE SIX + MICRO',core.concat(micro)));console.log(line('CORE SIX + VOL',core.concat(vol)));console.log(line('CURRENT ALL 8',done));