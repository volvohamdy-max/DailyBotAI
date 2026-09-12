'use strict';
// RESEARCH ONLY. Builds on the existing all-live portfolio backtest and injects ONLY
// the latest validated Pro, Micro and Exhaustion changes before executing it.
const fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.join(__dirname,'backtest-all-live-gold-strategies.js');
if(!fs.existsSync(base)) throw new Error('Missing scripts/backtest-all-live-gold-strategies.js');
let s=fs.readFileSync(base,'utf8');
function rep(a,b,label){if(!s.includes(a))throw new Error('Base script changed; replacement not found: '+label);s=s.replace(a,b)}
// Exhaustion E3: all live UTC hours, SL 1.75 ATR, TP 1.50 ATR, maxBars 3.
rep("if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].includes(hr)&&A[i]>0&&i>=4)","if(A[i]>0&&i>=4)",'Exhaustion hours');
rep("let risk=Math.max(A[i]*1.25,2),rew=Math.max(A[i]*.6,2)","let risk=Math.max(A[i]*1.75,2),rew=Math.max(A[i]*1.5,2)",'Exhaustion E3 exits');
// Pro validated live update: ADX 19 and block BUY at 08 UTC. Keep the base portfolio's
// other Pro rules unchanged so the comparison remains consistent with prior portfolio runs.
rep("D[i]>=18","D[i]>=19",'Pro ADX19');
rep("if(side&&rg>0&&Math.abs(b.c-b.o)/rg>=.5)","if(side&&!(hr===8&&side==='BUY')&&rg>0&&Math.abs(b.c-b.o)/rg>=.5)",'Pro 08 UTC BUY block');
// Micro validated live update: all UTC hours, BUY only, SL 2 ATR, TP 2 ATR (RR 1:1).
rep("if(hr>=10&&hr<=19&&A[i]>0)","if(A[i]>0)",'Micro all hours');
rep("let rg=b.h-b.l,body=Math.abs(b.c-b.o),side=E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]?'BUY':E9[i]<E21[i]&&E21[i]<E50[i]&&E21[i]<E21[i-3]?'SELL':null;","let rg=b.h-b.l,body=Math.abs(b.c-b.o),side=E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]?'BUY':null;",'Micro BUY only');
rep("risk=1.1*A[i],sl=side==='BUY'?e-risk:e+risk,tp=side==='BUY'?e+risk*.7:e-risk*.7","risk=2*A[i],sl=side==='BUY'?e-risk:e+risk,tp=side==='BUY'?e+risk:e-risk",'Micro 2ATR 2ATR');
// Make the run self-identifying.
s=s.replace("📊 CURRENT LIVE",'📊 UPDATED LIVE — PRO19 + MICRO BUY 2ATR + EXHAUSTION E3');
console.log('🔬 Portfolio patch: Pro ADX19 + no 08UTC BUY | Micro BUY-only 2ATR/2ATR | Exhaustion E3 1.75/1.50 B3');
console.log('🔒 READ-ONLY BACKTEST — no live files are modified');
vm.runInThisContext(s,{filename:'backtest-all-live-gold-strategies-updated.generated.js'});
