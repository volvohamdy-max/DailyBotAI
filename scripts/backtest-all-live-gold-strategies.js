'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const PERIOD={from:process.env.BACKTEST_FROM||'2025-08-24',to:process.env.BACKTEST_TO||'2026-08-24'};
const LIVE=[
 ['EXHAUSTION','src/services/scalpStrategies/goldExhaustionV3Strategy.js',['scripts/backtest-gold-exhaustion-v3-dollar-floor.js','scripts/backtest-gold-exhaustion-v3-cost-dollar.js'],['gold-exhaustion-v3']],
 ['RAPID','src/services/scalpStrategies/goldRapidScalpStrategy.js',['scripts/backtest-gold-rapid-scalp-diagnostics.js'],['gold-rapid-scalp','rapid-scalp']],
 ['GROK92','src/services/scalpStrategies/grokGold92Strategy.js',['scripts/backtest-grok-gold92-diagnostics.js'],['grok-gold92','grok-gold-92']],
 ['PRO','src/services/scalpStrategies/proStrategyMegaP1.js',['scripts/backtest-pro-strategy-live.js','scripts/backtest-pro-strategy.js'],['pro-strategy']],
 ['RANGE','src/services/scalpStrategies/goldRangeMrMegaN4.js',['scripts/backtest-gold-range-mr-diagnostics.js'],['gold-range-mr','range-mr']],
 ['SWEEP5','src/services/scalpStrategies/goldSweep5Strategy.js',['scripts/backtest-gold-sweep5-diagnostics.js'],['gold-sweep5','sweep5']],
 ['MICRO','src/services/scalpStrategies/goldMicroPullbackStrategy.js',['scripts/backtest-gold-micro-pullback.js','scripts/backtest-gold-micro-pullback-diagnostics.js'],['gold-micro-pullback','micro-pullback']]
];
function exists(f){return fs.existsSync(path.join(ROOT,f))}function files(){return fs.readdirSync(path.join(ROOT,'scripts')).filter(x=>/^backtest.*\.js$/i.test(x)&&x!==path.basename(__filename)).map(x=>'scripts/'+x)}
function runner(x){for(const f of x[2])if(exists(f))return f;const a=files();for(const h of x[3]){const z=a.find(f=>f.toLowerCase().includes(h));if(z)return z}return null}
function run(f){return spawnSync(process.execPath,[path.join(ROOT,f)],{cwd:ROOT,env:{...process.env,BACKTEST_FROM:PERIOD.from,BACKTEST_TO:PERIOD.to,READ_ONLY_BACKTEST:'1'},encoding:'utf8',maxBuffer:30*1024*1024})}
function nums(s){const pats=[/\bALL\s+T(\d+)\s+WR\+?([\d.]+)%\s+PF([\d.]+)\s+(?:Net|N)([+-]?[\d.]+)R\s+DD([\d.]+)/i,/\bALL\s+(\d+)\s+trades\s*\|\s*WR\s*([\d.]+)%\s*\|\s*Net\s*([+-]?[\d.]+)R\s*\|.*?PF\s*([\d.]+)\s*\|\s*DD\s*([\d.]+)/i,/(\d+)\s+trades\s*\|\s*WR\s*([\d.]+)%\s*\|\s*Net\s*([+-]?[\d.]+)R\s*\|\s*PF\s*([\d.]+)\s*\|\s*DD\s*([\d.]+)/i];for(let i=0;i<pats.length;i++){const m=s.match(pats[i]);if(m){if(i===0)return{t:+m[1],wr:+m[2],pf:+m[3],net:+m[4],dd:+m[5]};return{t:+m[1],wr:+m[2],net:+m[3],pf:+m[4],dd:+m[5]}}return null}
console.log('📊 LIVE STRATEGIES BACKTEST');console.log(`${PERIOD.from} → ${PERIOD.to} | READ ONLY\n`);
let totalT=0,totalWins=0,totalNet=0,weightedPF=0,maxDD=0,ok=0;
for(const x of LIVE){const f=runner(x);if(!f){console.log(`${x[0].padEnd(10)} | NO EXACT RUNNER`);continue}const r=run(f),out=(r.stdout||'')+'\n'+(r.stderr||''),n=nums(out);if(r.status!==0){console.log(`${x[0].padEnd(10)} | ERROR`);continue}if(!n){console.log(`${x[0].padEnd(10)} | RESULT PARSE FAILED`);continue}ok++;totalT+=n.t;totalWins+=n.t*n.wr/100;totalNet+=n.net;weightedPF+=n.pf*n.t;maxDD=Math.max(maxDD,n.dd);console.log(`${x[0].padEnd(10)} | T${n.t} WR${n.wr.toFixed(1)} PF${n.pf.toFixed(2)} N${n.net>=0?'+':''}${n.net.toFixed(1)}R DD${n.dd.toFixed(1)}`)}
console.log('');if(totalT)console.log(`TOTAL      | T${totalT} WR${(100*totalWins/totalT).toFixed(1)} PF${(weightedPF/totalT).toFixed(2)} N${totalNet>=0?'+':''}${totalNet.toFixed(1)}R DDmax${maxDD.toFixed(1)}`);console.log(`DONE ${ok}/${LIVE.length} | LIVE UNCHANGED`);
