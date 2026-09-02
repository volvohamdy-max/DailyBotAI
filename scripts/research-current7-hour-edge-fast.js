'use strict';
/** Research only: discover stable UTC hour filters on the CURRENT 7 portfolio. Does not touch live code. */
const fs=require('fs'),path=require('path'),vm=require('vm');
let src=fs.readFileSync(path.resolve('scripts/backtest-current-seven-final-1y.js'),'utf8');
const mark="console.log('\\n🏁 FINAL CURRENT 7 — 1 YEAR')";const at=src.indexOf(mark);if(at<0)throw new Error('final-seven marker not found');
src=src.slice(0,at)+";globalThis.__FINAL7={done,reportStart,end,st};";
const box={require,console:{log(){}},process,__dirname:path.resolve('scripts'),__filename:path.resolve('scripts/backtest-current-seven-final-1y.js')};vm.createContext(box);vm.runInContext(src,box,{timeout:180000});
const {done,reportStart,end,st}=box.__FINAL7,cut=reportStart+(end-reportStart)*.67;
const closed=done.filter(x=>x.kind!=='OPEN');
function basic(a){let w=a.filter(x=>x.r>0).length,l=a.filter(x=>x.r<0).length,be=a.length-w-l,net=a.reduce((s,x)=>s+(Number.isFinite(x.r)?x.r:0),0);return{n:a.length,w,l,be,wr:w+l?100*w/(w+l):0,net}}
const hour=x=>new Date(x.t).getUTCHours();
function fmt(s){return`T${s.n} WR${s.wr.toFixed(1)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R`}
console.log('\n🧪 CURRENT 7 — UTC HOUR EDGE MAP | research only');console.log(`${new Date(reportStart).toISOString().slice(0,10)} -> ${new Date(end).toISOString().slice(0,10)} | 67/33 OOS`);
console.log('\nHOUR | TRAIN | OOS | FULL');
let rows=[];for(let h=0;h<24;h++){let a=closed.filter(x=>hour(x)===h),tr=a.filter(x=>x.t<cut),o=a.filter(x=>x.t>=cut),S=[basic(tr),basic(o),basic(a)];rows.push({h,S});console.log(`${String(h).padStart(2,'0')} | ${fmt(S[0])} | ${fmt(S[1])} | ${fmt(S[2])}`)}
console.log('\n🏆 STABLE ALLOWED-HOUR SEARCH');let cand=[];for(let minN of [18,24,30]){let allowed=rows.filter(r=>r.S[0].n>=minN&&r.S[1].n>=Math.max(6,Math.floor(minN*.3))&&r.S[0].wr>=64&&r.S[1].wr>=64&&r.S[0].net>0&&r.S[1].net>0).map(r=>r.h);let a=closed.filter(x=>allowed.includes(hour(x))),tr=basic(a.filter(x=>x.t<cut)),o=basic(a.filter(x=>x.t>=cut)),f=basic(a);if(a.length)cand.push({minN,allowed,tr,o,f})}
cand.forEach((x,i)=>console.log(`${i+1} | minHourN ${x.minN} | UTC [${x.allowed.join(',')}] | TRAIN ${fmt(x.tr)} | OOS ${fmt(x.o)} | FULL ${fmt(x.f)}`));
console.log('\n📊 PER-STRATEGY × HOUR STRONG CELLS');for(const id of [...new Set(closed.map(x=>x.id))]){let a=closed.filter(x=>x.id===id),good=[];for(let h=0;h<24;h++){let z=a.filter(x=>hour(x)===h),tr=basic(z.filter(x=>x.t<cut)),o=basic(z.filter(x=>x.t>=cut));if(z.length>=10&&tr.n>=6&&o.n>=3&&tr.wr>=65&&o.wr>=65&&tr.net>0&&o.net>0)good.push(`${h}:T${z.length}/WR${basic(z).wr.toFixed(0)}`)}console.log(`${id}: ${good.length?good.join('  '):'none'}`)}
console.log('\nNOTE: discovery only. Any promising filter must be locked and validated separately before any recommendation; live untouched.');