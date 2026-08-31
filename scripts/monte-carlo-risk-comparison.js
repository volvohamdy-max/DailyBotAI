#!/usr/bin/env node
'use strict';
/** Research-only risk comparison for the validated 7-strategy accepted portfolio. */
const fs=require('fs');
const START=Number(process.env.START_EQUITY||1000);
const RUNS=Math.max(1000,Number(process.env.MC_RUNS||50000));
const SEED=Number(process.env.MC_SEED||260831);
const INPUT=process.argv[2]||'tmp/seven-portfolio-trades.json';
const RISKS=[0.5,1,1.5,2];
function readTrades(){if(!fs.existsSync(INPUT))throw new Error('Missing '+INPUT);const rows=JSON.parse(fs.readFileSync(INPUT,'utf8'));const rs=rows.map(x=>Number(typeof x==='number'?x:x.r)).filter(Number.isFinite);if(rs.length<100)throw new Error('Only '+rs.length+' valid R outcomes');return rs}
function rng(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
function bootstrapIndices(n,random){const a=new Uint16Array(n);for(let i=0;i<n;i++)a[i]=Math.floor(random()*n);return a}
function simIndexed(rs,idx,risk){let eq=START,peak=START,maxDD=0,minEq=START;for(let i=0;i<idx.length;i++){eq+=eq*risk*rs[idx[i]];if(eq>peak)peak=eq;if(eq<minEq)minEq=eq;const dd=(peak-eq)/peak;if(dd>maxDD)maxDD=dd}return{eq,maxDD,minEq}}
function simHist(rs,risk){let eq=START,peak=START,maxDD=0;for(const r of rs){eq+=eq*risk*r;if(eq>peak)peak=eq;const dd=(peak-eq)/peak;if(dd>maxDD)maxDD=dd}return{eq,maxDD}}
function q(a,p){a.sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)]}
const rs=readTrades();const random=rng(SEED);const stats=RISKS.map(r=>({risk:r/100,finals:[],dds:[],loss:0,d20:0,d30:0,d50:0,half:0}));
for(let k=0;k<RUNS;k++){const idx=bootstrapIndices(rs.length,random);for(const s of stats){const z=simIndexed(rs,idx,s.risk);s.finals.push(z.eq);s.dds.push(z.maxDD);if(z.eq<START)s.loss++;if(z.maxDD>=.2)s.d20++;if(z.maxDD>=.3)s.d30++;if(z.maxDD>=.5)s.d50++;if(z.minEq<=START*.5)s.half++;}}
console.log('7-STRATEGY PORTFOLIO — BOOTSTRAP RISK COMPARISON');
console.log('RESEARCH ONLY — live bot untouched');
console.log('Input '+INPUT+' | outcomes '+rs.length+' | runs '+RUNS.toLocaleString()+' each | start $'+START.toFixed(2));
console.log('Risk | HistFinal | HistDD | P05 Final | Median Final | P95 Final | DD P50 | DD P95 | DD P99 | P(DD20) | P(DD30) | P(DD50) | P(<=50%)');
for(const s of stats){const h=simHist(rs,s.risk),p05=q(s.finals,.05),p50=q(s.finals,.5),p95=q(s.finals,.95),d50=q(s.dds,.5),d95=q(s.dds,.95),d99=q(s.dds,.99),pct=n=>(100*n/RUNS).toFixed(3)+'%';console.log((s.risk*100).toFixed(1)+'% | $'+h.eq.toFixed(0)+' | '+(h.maxDD*100).toFixed(1)+'% | $'+p05.toFixed(0)+' | $'+p50.toFixed(0)+' | $'+p95.toFixed(0)+' | '+(d50*100).toFixed(1)+'% | '+(d95*100).toFixed(1)+'% | '+(d99*100).toFixed(1)+'% | '+pct(s.d20)+' | '+pct(s.d30)+' | '+pct(s.d50)+' | '+pct(s.half));}
console.log('\nNote: bootstrap assumes the empirical 1327-trade R distribution remains representative; it is stress research, not a profit guarantee.');
