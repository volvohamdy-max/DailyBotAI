#!/usr/bin/env node
'use strict';
/**
 * Research-only Monte Carlo for the validated 7-strategy portfolio.
 * Input: paste/export chronological accepted trade R results to JSON/CSV.
 * Risk: 1% of current equity per trade. Starting equity: $1000.
 * This file does NOT import or modify live trading services.
 */
const fs=require('fs');
const START=Number(process.env.START_EQUITY||1000);
const RISK=Number(process.env.RISK_PCT||1)/100;
const RUNS=Math.max(1000,Number(process.env.MC_RUNS||50000));
const SEED=Number(process.env.MC_SEED||260831);
const INPUT=process.argv[2]||'tmp/seven-portfolio-trades.json';
function rng(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
const random=rng(SEED);
function readTrades(){if(!fs.existsSync(INPUT))throw new Error(`Missing ${INPUT}. Export the accepted 7-set portfolio trades first.`);const raw=fs.readFileSync(INPUT,'utf8').trim();let rows;if(raw.startsWith('[')){rows=JSON.parse(raw)}else{rows=raw.split(/\r?\n/).filter(Boolean).map((line,i)=>{if(i===0&&/\br\b/i.test(line))return null;const p=line.split(',');return{r:Number(p[p.length-1])}}).filter(Boolean)}const rs=rows.map(x=>Number(typeof x==='number'?x:x.r)).filter(Number.isFinite);if(rs.length<100)throw new Error(`Only ${rs.length} valid R outcomes found`);return rs}
function shuffle(a){const x=a.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
function bootstrap(a){return Array.from({length:a.length},()=>a[Math.floor(random()*a.length)])}
function sim(seq){let eq=START,peak=START,maxDD=0,minEq=START;for(const r of seq){eq+=eq*RISK*r;if(eq>peak)peak=eq;minEq=Math.min(minEq,eq);maxDD=Math.max(maxDD,(peak-eq)/peak)}return{eq,maxDD,minEq}}
function q(a,p){const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor((s.length-1)*p)))]}
function pct(n){return (100*n/RUNS).toFixed(3)+'%'}
function run(label,make,rs){const finals=[],dds=[];let loss=0,d10=0,d20=0,d30=0,d50=0,half=0;for(let k=0;k<RUNS;k++){const z=sim(make(rs));finals.push(z.eq);dds.push(z.maxDD);if(z.eq<START)loss++;if(z.maxDD>=.10)d10++;if(z.maxDD>=.20)d20++;if(z.maxDD>=.30)d30++;if(z.maxDD>=.50)d50++;if(z.minEq<=START*.5)half++}console.log(`\n━━━━━━━━ ${label} ━━━━━━━━`);console.log(`Runs ${RUNS.toLocaleString()} | Trades/run ${rs.length} | Start $${START.toFixed(2)} | Risk ${(RISK*100).toFixed(2)}%`);console.log(`Finish loss probability : ${pct(loss)}`);console.log(`DD >=10%               : ${pct(d10)}`);console.log(`DD >=20%               : ${pct(d20)}`);console.log(`DD >=30%               : ${pct(d30)}`);console.log(`DD >=50%               : ${pct(d50)}`);console.log(`Equity ever <= $${(START*.5).toFixed(0)}    : ${pct(half)}`);console.log(`Final equity P01/P05/P50/P95/P99: $${q(finals,.01).toFixed(2)} / $${q(finals,.05).toFixed(2)} / $${q(finals,.5).toFixed(2)} / $${q(finals,.95).toFixed(2)} / $${q(finals,.99).toFixed(2)}`);console.log(`Max DD P50/P95/P99/worst: ${(q(dds,.5)*100).toFixed(2)}% / ${(q(dds,.95)*100).toFixed(2)}% / ${(q(dds,.99)*100).toFixed(2)}% / ${(Math.max(...dds)*100).toFixed(2)}%`)}
const rs=readTrades();const hist=sim(rs);console.log('🧪 7-STRATEGY PORTFOLIO — 1% RISK MONTE CARLO');console.log('RESEARCH ONLY — live bot untouched');console.log(`Input ${INPUT} | outcomes ${rs.length}`);console.log(`Historical-order compounding: $${hist.eq.toFixed(2)} | maxDD ${(hist.maxDD*100).toFixed(2)}%`);run('SHUFFLE — same exact trades, random order',shuffle,rs);run('BOOTSTRAP — harsher resampling with replacement',bootstrap,rs);
