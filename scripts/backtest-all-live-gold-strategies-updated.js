'use strict';
// RESEARCH ONLY — latest validated live portfolio patches over the baseline backtest.
// No live strategy file is imported or modified.
const fs=require('fs'),path=require('path'),Module=require('module');
const base=path.join(__dirname,'backtest-all-live-gold-strategies.js');if(!fs.existsSync(base))throw new Error('Missing base portfolio backtest');let s=fs.readFileSync(base,'utf8');
function rep(a,b,label){if(!s.includes(a))throw new Error('Base script changed; replacement not found: '+label);s=s.replace(a,b)}
// Exhaustion E3 latest: 24h, SL1.75 ATR, TP1.50 ATR, maxBars3, SELL wick 0.30.
rep("if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].includes(hr)&&A[i]>0&&i>=4)","if(A[i]>0&&i>=4)",'Exhaustion hours');
rep("q=side==='BUY'?{burst:2.2,wick:.30}:{burst:2.6,wick:.25}","q=side==='BUY'?{burst:2.2,wick:.30}:{burst:2.6,wick:.30}",'Exhaustion SELL wick30');
rep("let risk=Math.max(A[i]*1.25,2),rew=Math.max(A[i]*.6,2)","let risk=Math.max(A[i]*1.75,2),rew=Math.max(A[i]*1.5,2)",'Exhaustion exits');
// Rapid R1: all UTC hours except 20, with historical approximation of live entry-gap guard.
rep("if([0,4,11,12,13,14,15,17].includes(hr)&&A[i]>0)","if(hr!==20&&A[i]>0)",'Rapid hours');
rep("let e=M[i+1].o,swing=side==='BUY'?Math.min(b.l,M[i-1].l):Math.max(b.h,M[i-1].h),risk=Math.max(A[i]*.65,Math.abs(e-swing));if(risk<=A[i]*1.35)","let e=M[i+1].o,swing=side==='BUY'?Math.min(b.l,M[i-1].l):Math.max(b.h,M[i-1].h),risk=Math.max(A[i]*.65,Math.abs(e-swing));if(Math.abs(e-b.c)<=A[i]*.3&&risk<=A[i]*1.35)",'Rapid gap');
// Pro Mega P1: ADX19 and no BUY signals at 08 UTC.
rep("D[i]>=18","D[i]>=19",'Pro ADX19');
rep("if(side&&rg>0&&Math.abs(b.c-b.o)/rg>=.5)","if(side&&!(hr===8&&side==='BUY')&&rg>0&&Math.abs(b.c-b.o)/rg>=.5)",'Pro no08buy');
// Micro V2 latest: BUY-only, all hours except 20 UTC, impulse 1.30 ATR, close position .66, SL/TP 2ATR.
rep("if(hr>=10&&hr<=19&&A[i]>0)","if(hr!==20&&A[i]>0)",'Micro hours');
rep("let rg=b.h-b.l,body=Math.abs(b.c-b.o),side=E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]?'BUY':E9[i]<E21[i]&&E21[i]<E50[i]&&E21[i]<E21[i-3]?'SELL':null;","let rg=b.h-b.l,body=Math.abs(b.c-b.o),side=E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]?'BUY':null;",'Micro buy only');
rep("pos>=.62&&b.c>M[i-1].h","pos>=.66&&b.c>M[i-1].h",'Micro close66');
rep("if(imp>=1.2*A[i]&&retr>=.12", "if(imp>=1.3*A[i]&&retr>=.12",'Micro impulse130');
rep("risk=1.1*A[i],sl=side==='BUY'?e-risk:e+risk,tp=side==='BUY'?e+risk*.7:e-risk*.7","risk=2*A[i],sl=side==='BUY'?e-risk:e+risk,tp=side==='BUY'?e+risk:e-risk",'Micro exits');
s=s.replace('📊 CURRENT LIVE','📊 LATEST VALIDATED LIVE PORTFOLIO');
console.log('🔬 LATEST: Pro P1 | Micro V2 I130/C66/no20 | Exhaustion E3 SELL wick30 | Rapid R1 no20');
console.log('🔒 READ-ONLY BACKTEST — live files untouched');
const generated=path.join(__dirname,'backtest-all-live-gold-strategies-updated.generated.js');const m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);
