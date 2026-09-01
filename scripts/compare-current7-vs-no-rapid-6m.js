'use strict';
/** A/B: CURRENT 7 vs CURRENT 7 WITHOUT RAPID — audited 6M */
const fs=require('fs'),path=require('path'),vm=require('vm');
let src=fs.readFileSync(path.resolve('scripts/backtest-current-live-audited-6m.js'),'utf8');
const cut=src.indexOf('function st(a)');
if(cut<0)throw new Error('Audited source format changed');
const box={require,console:{log(){}},process,__dirname:path.resolve('scripts'),__filename:path.resolve('scripts/backtest-current-live-audited-6m.js')};
vm.createContext(box);vm.runInContext(src.slice(0,cut)+'\n;globalThis.__S={done,reportStart,end};',box,{timeout:120000});
const {reportStart,end}=box.__S;
const seven=box.__S.done.filter(x=>x.id!=='GOLD_VOLATILITY_TRANSITION');
const noRapid=seven.filter(x=>x.id!=='GOLD_RAPID_SCALP_V5');
function st(a){let w=0,l=0,be=0,open=0,net=0,gw=0,gl=0,pk=0,dd=0,ls=0,maxls=0;for(const x of [...a].sort((a,b)=>a.t-b.t)){if(x.r>0){w++;gw+=x.r;ls=0}else if(x.r<0){l++;gl-=x.r;ls++;maxls=Math.max(maxls,ls)}else if(x.kind==='BE')be++;else open++;net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:a.length,w,l,be,open,wr:w+l?100*w/(w+l):0,pf:gl?gw/gl:(gw?99:0),net,dd,maxls}}
function fmt(s){return`T${s.n} W${s.w}/L${s.l}/BE${s.be} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.maxls}`}
function delta(a,b){return`Trades ${b.n-a.n>=0?'+':''}${b.n-a.n} | WR ${b.wr-a.wr>=0?'+':''}${(b.wr-a.wr).toFixed(1)} pts | PF ${b.pf-a.pf>=0?'+':''}${(b.pf-a.pf).toFixed(2)} | Net ${b.net-a.net>=0?'+':''}${(b.net-a.net).toFixed(2)}R | DD ${b.dd-a.dd>=0?'+':''}${(b.dd-a.dd).toFixed(2)}R | LS ${b.maxls-a.maxls>=0?'+':''}${b.maxls-a.maxls}`}
console.log('\n🧪 A/B — CURRENT 7 vs WITHOUT RAPID — AUDITED 6M');
console.log(`${new Date(reportStart).toISOString().slice(0,10)} → ${new Date(end).toISOString().slice(0,10)}`);
const a=st(seven),b=st(noRapid);console.log('\nCURRENT 7     '+fmt(a));console.log('WITHOUT RAPID '+fmt(b));console.log('Δ NO RAPID    '+delta(a,b));
console.log('\n📅 MONTH BY MONTH');
for(const m of [...new Set(seven.map(x=>new Date(x.t).toISOString().slice(0,7)))]){const aa=st(seven.filter(x=>new Date(x.t).toISOString().startsWith(m))),bb=st(noRapid.filter(x=>new Date(x.t).toISOString().startsWith(m)));console.log(`\n${m}`);console.log('  7   '+fmt(aa));console.log('  -R  '+fmt(bb));console.log('  Δ   '+delta(aa,bb))}
console.log('\n🚀 RAPID ALONE '+fmt(st(seven.filter(x=>x.id==='GOLD_RAPID_SCALP_V5'))));
console.log('\nNOTE: research only. No live strategy file modified.');
