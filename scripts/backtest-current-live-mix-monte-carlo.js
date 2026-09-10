'use strict';
// READ-ONLY Monte Carlo stress test for CURRENT LIVE 7-strategy mix.
// Resamples/shuffles historical R outcomes only. NEVER imports/modifies live runtime.
const fs=require('fs'),path=require('path'),vm=require('vm');
const START=Date.parse('2025-09-10T00:00:00.000Z'),END=Date.parse('2026-09-10T23:59:59.999Z');
const START_BAL=Number(process.env.START_BALANCE||1000),RUNS=Math.max(1000,Number(process.env.MC_RUNS||10000));
const RISKS=[0.5,0.75,1,1.25,1.5];
function runLab(file,exportCode){const p=path.join(__dirname,file);let src=fs.readFileSync(p,'utf8')+`\n${exportCode}\n`;const s={require,console:{log:()=>{},error:()=>{}},process,__dirname,path,Buffer,setTimeout,clearTimeout,globalThis:null};s.globalThis=s;vm.createContext(s);vm.runInContext(src,s,{filename:p});return s.__EVENT_EXPORT;}
const h=runLab('backtest-live-hours-24h-lab.js',';globalThis.__EVENT_EXPORT={M,all,cur};');
const g=runLab('backtest-all-live-gold-strategies.js',';globalThis.__EVENT_EXPORT={M,GR,RM};');
function ev(M,x){return{t:M[x.i]?.t,r:x.r};}
let e=[];for(const n of ['EXHAUSTION','RAPID','PRO','MICRO'])e.push(...h.all[n].map(x=>ev(h.M,x)));e.push(...h.cur.SWEEP5.map(x=>ev(h.M,x)),...g.GR.map(x=>ev(g.M,x)),...g.RM.map(x=>ev(g.M,x)));
const R=e.filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.r)&&x.t>=START&&x.t<=END).map(x=>x.r);
// deterministic PRNG so repeated runs are reproducible unless MC_SEED changes.
let seed=(Number(process.env.MC_SEED||260910)>>>0)||1;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
function q(a,p){const s=[...a].sort((x,y)=>x-y),i=Math.min(s.length-1,Math.max(0,Math.floor((s.length-1)*p)));return s[i];}
function one(risk){const a=R.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}let bal=START_BAL,peak=bal,maxDD=0;for(const r of a){bal*=1+(risk/100)*r;if(bal<=0){bal=0;maxDD=100;break}if(bal>peak)peak=bal;else maxDD=Math.max(maxDD,100*(peak-bal)/peak);}return{bal,dd:maxDD};}
console.log('\n🎲 CURRENT LIVE MIX — MONTE CARLO STRESS TEST (READ ONLY)');console.log(`Historical events : ${R.length}`);console.log(`Runs per risk     : ${RUNS}`);console.log(`Start balance     : $${START_BAL.toFixed(2)}`);console.log(`Seed              : ${process.env.MC_SEED||260910}`);console.log('Method            : random permutation of the same historical R outcomes');console.log('Important         : tests sequence risk only; it does not create unseen market regimes, slippage, spread or exact concurrent margin exposure.\n');
console.log('RISK   MEDIAN DD   95% DD   99% DD   P(DD>20%) P(DD>30%) P(DD>50%)   MEDIAN FINAL');console.log('────────────────────────────────────────────────────────────────────────────────────');
for(const risk of RISKS){const d=[],b=[];let p20=0,p30=0,p50=0;for(let k=0;k<RUNS;k++){const x=one(risk);d.push(x.dd);b.push(x.bal);if(x.dd>20)p20++;if(x.dd>30)p30++;if(x.dd>50)p50++;}console.log(`${String(risk.toFixed(2)+'%').padEnd(7)}${String(q(d,.5).toFixed(1)+'%').padStart(9)}   ${String(q(d,.95).toFixed(1)+'%').padStart(7)}   ${String(q(d,.99).toFixed(1)+'%').padStart(7)}   ${String((100*p20/RUNS).toFixed(1)+'%').padStart(9)} ${String((100*p30/RUNS).toFixed(1)+'%').padStart(9)} ${String((100*p50/RUNS).toFixed(1)+'%').padStart(9)}   $${q(b,.5).toFixed(2).padStart(12)}`);}
console.log('\n🧪 OPTIONAL');console.log('MC_RUNS=50000 node scripts/backtest-current-live-mix-monte-carlo.js');console.log('START_BALANCE=500 MC_RUNS=50000 node scripts/backtest-current-live-mix-monte-carlo.js');console.log('\n🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');