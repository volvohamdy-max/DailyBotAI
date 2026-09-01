'use strict';
/** CURRENT 7 LIVE — AUDITED 6M. Reuses audited current replay and excludes deleted VTRANS. */
const fs=require('fs'),path=require('path'),vm=require('vm');
let src=fs.readFileSync(path.resolve('scripts/backtest-current-live-audited-6m.js'),'utf8');
// Capture the audited resolved trades before its reporting section.
const cut=src.indexOf("function st(a)");
if(cut<0)throw new Error('Audited source format changed');
const prefix=src.slice(0,cut);
const box={require,console:{log(){}},process,__dirname:path.resolve('scripts'),__filename:path.resolve('scripts/backtest-current-live-audited-6m.js')};
vm.createContext(box);vm.runInContext(prefix+'\n;globalThis.__S={done,reportStart,end};',box,{timeout:120000});
let {done,reportStart,end}=box.__S;
done=done.filter(x=>x.id!=='GOLD_VOLATILITY_TRANSITION');
function st(a){let w=0,l=0,be=0,open=0,net=0,gw=0,gl=0,pk=0,dd=0,ls=0,maxls=0;for(const x of [...a].sort((a,b)=>a.t-b.t)){if(x.r>0){w++;gw+=x.r;ls=0}else if(x.r<0){l++;gl-=x.r;ls++;maxls=Math.max(maxls,ls)}else if(x.kind==='BE')be++;else open++;net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:a.length,w,l,be,open,wr:w+l?100*w/(w+l):0,pf:gl?gw/gl:(gw?99:0),net,dd,maxls}}
function line(label,a){const s=st(a);return`${label.padEnd(31)} T${s.n} W${s.w}/L${s.l}/BE${s.be}/OPEN${s.open} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.maxls}`}
console.log('\n📊 CURRENT 7 LIVE — AUDITED 6 MONTH BACKTEST');console.log(`${new Date(reportStart).toISOString().slice(0,10)} → ${new Date(end).toISOString().slice(0,10)}`);console.log('VTRANS REMOVED | current remaining conditions | no maxBars timeout | 80% protection modeled | Grok excluded | Pro state modeled');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for(const id of [...new Set(done.map(x=>x.id))]){const a=done.filter(x=>x.id===id);console.log(line(a[0].label,a))}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log(line('ALL CURRENT 7',done));
console.log('\n📅 MONTH BY MONTH');for(const m of [...new Set(done.map(x=>new Date(x.t).toISOString().slice(0,7)))])console.log(line(m,done.filter(x=>new Date(x.t).toISOString().startsWith(m))));
console.log('\nNOTE: historical entry uses signal candle close; live current-price rebase cannot be reproduced exactly from OHLC.');
