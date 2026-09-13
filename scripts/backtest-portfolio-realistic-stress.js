'use strict';
// RESEARCH ONLY. Runs the validated portfolio backtest, captures timestamped trades,
// then applies conservative round-trip execution-cost stress in PRICE DOLLARS.
// No live strategy files are imported or modified.
const fs=require('fs'),path=require('path'),Module=require('module');
const base=path.join(__dirname,'backtest-all-live-gold-strategies-updated.js');
if(!fs.existsSync(base)) throw Error('Missing updated portfolio wrapper');
// The updated wrapper compiles the base internally. Patch the base source in-memory by
// intercepting fs.readFileSync only for that one file, adding risk/timestamp metadata.
const origRead=fs.readFileSync.bind(fs);
const baseFile=path.join(__dirname,'backtest-all-live-gold-strategies.js');
let captured=null;
fs.readFileSync=function(p,...args){
  const out=origRead(p,...args);
  if(path.resolve(String(p))!==path.resolve(baseFile)||!String(args[0]||'').includes('utf')) return out;
  let s=String(out);
  s=s.replace("function push(a,i,side,r){if(i>=first&&M[i].t<=to&&Number.isFinite(r))a.push({i,side,r})}",
`function push(a,i,side,r){if(i>=first&&M[i].t<=to&&Number.isFinite(r)){let risk=globalThis.__BT_RISK__;a.push({i,t:M[i].t,side,r,risk:Number.isFinite(risk)&&risk>0?risk:null});globalThis.__BT_RISK__=null}}`);
  // Set monetary price-risk immediately before each push. These replacements mirror base call sites.
  s=s.replace(/push\(EX,i,side,exitFixed\(i\+1,side,sl,tp,3\)\)/g,"globalThis.__BT_RISK__=risk;push(EX,i,side,exitFixed(i+1,side,sl,tp,3))");
  s=s.replace(/push\(RA,i,side,exitFixed\(i,side,sl,tp,8\)\)/g,"globalThis.__BT_RISK__=risk;push(RA,i,side,exitFixed(i,side,sl,tp,8))");
  s=s.replace(/push\(GR,i,side,exitFixed\(i,side,sl,tp,24\)\)/g,"globalThis.__BT_RISK__=risk;push(GR,i,side,exitFixed(i,side,sl,tp,24))");
  s=s.replace(/push\(PR,i,side,r\)/g,"globalThis.__BT_RISK__=12;push(PR,i,side,r)");
  s=s.replace(/push\(RM,i,'BUY',exitFixed\(i,'BUY',e-sd,e\+td,12\)\)/g,"globalThis.__BT_RISK__=sd;push(RM,i,'BUY',exitFixed(i,'BUY',e-sd,e+td,12))");
  s=s.replace(/push\(SW,i,'SELL',exitFixed\(i,'SELL',e\+5,e-5,4\)\)/g,"globalThis.__BT_RISK__=5;push(SW,i,'SELL',exitFixed(i,'SELL',e+5,e-5,4))");
  s=s.replace(/push\(MI,i,side,exitFixed\(i,side,sl,tp,10\)\)/g,"globalThis.__BT_RISK__=risk;push(MI,i,side,exitFixed(i,side,sl,tp,10))");
  s=s.replace("line('TOTAL',all);console.log('DONE 7/7 | LIVE UNCHANGED');", "line('TOTAL',all);globalThis.__PORTFOLIO_CAPTURE__={EX,RA,GR,PR,RM,SW,MI,all};console.log('DONE 7/7 | LIVE UNCHANGED');");
  return s;
};
require(base);
fs.readFileSync=origRead;
captured=globalThis.__PORTFOLIO_CAPTURE__;
if(!captured) throw Error('Portfolio capture failed');
const names=[['EXHAUSTION',captured.EX],['RAPID',captured.RA],['GROK92',captured.GR],['PRO',captured.PR],['RANGE',captured.RM],['SWEEP5',captured.SW],['MICRO',captured.MI]];
const tagged=[];for(const [strategy,a] of names)for(const x of a)tagged.push({...x,strategy});tagged.sort((a,b)=>a.t-b.t||a.i-b.i);
function dayKey(t){return new Date(t).toISOString().slice(0,10)}
function weekKey(t){let d=new Date(t),z=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));z.setUTCDate(z.getUTCDate()-((z.getUTCDay()+6)%7));return z.toISOString().slice(0,10)}
function monthKey(t){return new Date(t).toISOString().slice(0,7)}
function scenario(cost){
 let eq=0,peak=0,dd=0,gp=0,gl=0,w=0,ls=0,maxls=0;const periods={day:new Map(),week:new Map(),month:new Map()};
 const rows=tagged.map(x=>{let c=x.risk?cost/x.risk:0,r=x.r-c;return {...x,net:r,costR:c}});
 for(const x of rows){let r=x.net;if(r>0){w++;gp+=r;ls=0}else if(r<0){gl-=r;ls++;maxls=Math.max(maxls,ls)}eq+=r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);for(const [k,f] of [['day',dayKey],['week',weekKey],['month',monthKey]]){let q=f(x.t);periods[k].set(q,(periods[k].get(q)||0)+r)}}
 const worst=m=>{let z=[...m.entries()].sort((a,b)=>a[1]-b[1])[0];return z||['-',0]};
 return {cost,t:rows.length,wr:rows.length?100*w/rows.length:0,pf:gl?gp/gl:99,net:eq,dd,maxls,wd:worst(periods.day),ww:worst(periods.week),wm:worst(periods.month)};
}
function pct(dd,riskPct){return dd*riskPct}
console.log('\n============================================================');
console.log('🧪 REALISTIC 2Y — EXECUTION COST STRESS (RESEARCH ONLY)');
console.log('Cost = total adverse round-trip price movement per trade.');
console.log('M5 ambiguity remains conservative: SL wins if SL and TP touch same candle.');
console.log('============================================================');
for(const [label,cost] of [['ZERO',0],['NORMAL',0.40],['HEAVY',0.80],['EXTREME',1.20]]){
 const s=scenario(cost);console.log(`\n${label.padEnd(7)} cost=$${cost.toFixed(2)} | T${s.t} WR${s.wr.toFixed(1)} PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(1)}R DD${s.dd.toFixed(1)}R | MaxLossStreak ${s.maxls}`);
 console.log(`Worst day ${s.wd[0]} ${s.wd[1].toFixed(1)}R | week ${s.ww[0]} ${s.ww[1].toFixed(1)}R | month ${s.wm[0]} ${s.wm[1].toFixed(1)}R`);
 console.log(`DD @0.25%=${pct(s.dd,.25).toFixed(1)}% | @0.50%=${pct(s.dd,.50).toFixed(1)}% | @1.00%=${pct(s.dd,1).toFixed(1)}%`);
}
console.log('\nNOTE: $0.40/$0.80/$1.20 are stress assumptions, not measured broker costs.');
console.log('LIVE FILES UNCHANGED.');
