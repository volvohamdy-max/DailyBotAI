'use strict';
// READ-ONLY edge degradation + execution cost stress test for current 7-strategy portfolio.
const fs=require('fs'),path=require('path'),vm=require('vm');
const START=Date.parse('2025-09-10T00:00:00.000Z'),END=Date.parse('2026-09-10T23:59:59.999Z');
const START_BAL=Number(process.env.START_BALANCE||1000),RUNS=Math.max(1000,Number(process.env.STRESS_RUNS||10000));
const RISKS=[0.5,0.75,1.0];
// Degrade only positive R by 0/10/20/30%, then subtract cost in R from every trade.
// 0.02R and 0.05R represent modest/heavy all-in execution drag relative to planned risk.
const SCENARIOS=[
 {name:'BASE',cut:0,cost:0},
 {name:'EDGE-10%',cut:.10,cost:0},
 {name:'EDGE-20%',cut:.20,cost:0},
 {name:'EDGE-30%',cut:.30,cost:0},
 {name:'EDGE-10% + COST0.02R',cut:.10,cost:.02},
 {name:'EDGE-20% + COST0.02R',cut:.20,cost:.02},
 {name:'EDGE-30% + COST0.02R',cut:.30,cost:.02},
 {name:'EDGE-20% + COST0.05R',cut:.20,cost:.05},
 {name:'EDGE-30% + COST0.05R',cut:.30,cost:.05}
];
function runLab(file,exportCode){const p=path.join(__dirname,file);const src=fs.readFileSync(p,'utf8')+'\n'+exportCode+'\n';const s={require,console:{log:()=>{},error:()=>{}},process,__dirname,path,Buffer,setTimeout,clearTimeout,globalThis:null};s.globalThis=s;vm.createContext(s);vm.runInContext(src,s,{filename:p});return s.__EVENT_EXPORT;}
const h=runLab('backtest-live-hours-24h-lab.js',';globalThis.__EVENT_EXPORT={M,all,cur};');
const g=runLab('backtest-all-live-gold-strategies.js',';globalThis.__EVENT_EXPORT={M,GR,RM};');
function ev(M,x){return{t:M[x.i]?.t,r:x.r};}let E=[];for(const n of ['EXHAUSTION','RAPID','PRO','MICRO'])E.push(...h.all[n].map(x=>ev(h.M,x)));E.push(...h.cur.SWEEP5.map(x=>ev(h.M,x)),...g.GR.map(x=>ev(g.M,x)),...g.RM.map(x=>ev(g.M,x)));
const BASE=E.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.r)&&x.t>=START&&x.t<=END).map(x=>x.r);
let seed=(Number(process.env.STRESS_SEED||260911)>>>0)||1;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}function quant(a,p){a.sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)];}
function transformed(s){return BASE.map(r=>(r>0?r*(1-s.cut):r)-s.cost);}
function summaryR(a){let gp=0,gl=0,net=0,w=0;for(const r of a){net+=r;if(r>0){gp+=r;w++}else gl-=r;}return{net,pf:gl?gp/gl:Infinity,wr:100*w/a.length};}
function sim(arr,risk){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}let bal=START_BAL,peak=bal,dd=0;for(const r of a){bal*=1+r*risk/100;if(bal<=0)return{bal:0,dd:100};if(bal>peak)peak=bal;else dd=Math.max(dd,100*(peak-bal)/peak);}return{bal,dd};}
console.log('\n🧨 CURRENT LIVE MIX — EDGE DEGRADATION STRESS (READ ONLY)');console.log(`Events: ${BASE.length} | Runs/scenario/risk: ${RUNS} | Start: $${START_BAL.toFixed(2)}`);console.log('Edge degradation = haircut to winning R only. Execution cost = R deducted from every trade.');console.log('Monte Carlo = shuffled sequence of each stressed outcome set.\n');
for(const s of SCENARIOS){const a=transformed(s),z=summaryR(a);console.log(`\n[${s.name}]  Net ${z.net>=0?'+':''}${z.net.toFixed(1)}R | PF ${z.pf.toFixed(2)} | Positive outcomes ${z.wr.toFixed(1)}%`);console.log('RISK   MED DD   95% DD   99% DD   P>20%   P>30%   MED FINAL');for(const risk of RISKS){let ds=[],bs=[],p20=0,p30=0;for(let k=0;k<RUNS;k++){const x=sim(a,risk);ds.push(x.dd);bs.push(x.bal);if(x.dd>20)p20++;if(x.dd>30)p30++;}console.log(`${String(risk.toFixed(2)+'%').padEnd(7)}${String(quant(ds,.5).toFixed(1)+'%').padStart(7)}   ${String(quant(ds,.95).toFixed(1)+'%').padStart(7)}   ${String(quant(ds,.99).toFixed(1)+'%').padStart(7)}   ${String((100*p20/RUNS).toFixed(1)+'%').padStart(6)}   ${String((100*p30/RUNS).toFixed(1)+'%').padStart(6)}   $${quant(bs,.5).toFixed(2).padStart(10)}`);}}
console.log('\nDECISION GUIDE');console.log('- Focus on 0.75% surviving EDGE-20%/30% plus execution-cost scenarios without unacceptable DD.');console.log('- This is deliberately harsher than simple sequence shuffling, but still cannot model a completely new market regime or broker-specific fills.');console.log('\n🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');