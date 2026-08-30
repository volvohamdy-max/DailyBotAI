#!/usr/bin/env node
'use strict';
/**
 * CURRENT LIVE V2 parity runner.
 * Starts from the previously validated six-strategy backtest and applies ONLY
 * the two subsequently promoted live changes:
 *  1) Gold Rapid Scalp V5 fixed WR candidate.
 *  2) Gold Range MR validated BUY-only candidate.
 * No optimizer. MAX OPEN GOLD remains 2.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.join(__dirname,'backtest-current-live.js');
let s=fs.readFileSync(base,'utf8');
function rep(a,b,label){if(!s.includes(a))throw new Error('PARITY PATCH FAILED: '+label);s=s.replace(a,b)}
// Header/config: reflect the exact promoted variants.
rep("E2 + R3 + G1 + P1 + N4 + S0, MAX OPEN 2.","E2 + Rapid-V5 + G1 + P1 + Range-BUY + S0, MAX OPEN 2.",'header');
rep("R3:{rr:1.5,sep:.08}","R3:{rr:1,sep:.08,body:.65,pos:.72,breakAtr:0,emaDist:1.5,rangeMax:2,riskCap:1.35,slAtr:.65,hours:[11,12,13,14,15,17]}",'rapid config');
rep("N4:{adx:18,rsi:44,minRR:.55}","N4:{adx:14,rsi:46,atrLo:.55,atrHi:1.6,slope:.2,wLo:1.8,wHi:8,wick:.25,body:.75,edgeAtr:.3,edgeW:.1,touch:1,minRR:.7,maxBars:12}",'range config');
// Rapid V5: exact promoted filters versus the old R3 reconstruction.
rep("if(![11,12,13,14,15,17].includes(hr))continue;","if(!p.hours.includes(hr))continue;",'rapid hours');
rep("if(!rg||bd/A[i]<.5||rg/A[i]>2.4)continue;","if(!rg||bd/A[i]<p.body||rg/A[i]>p.rangeMax)continue;",'rapid body/range');
rep("if(Math.abs(c[i].close-E[i])/A[i]>1.5)continue;","if(Math.abs(c[i].close-E[i])/A[i]>p.emaDist)continue;",'rapid ema distance');
rep("c[i].close>hi+.05*A[i]","c[i].close>hi+p.breakAtr*A[i]",'rapid buy breakout');
rep("pos>=.72","pos>=p.pos",'rapid buy position');
rep("c[i].close<lo-.05*A[i]","c[i].close<lo-p.breakAtr*A[i]",'rapid sell breakout');
rep("pos<=.28","pos<=1-p.pos",'rapid sell position');
rep("Math.max(A[i]*.65,Math.abs(en-sw))","Math.max(A[i]*p.slAtr,Math.abs(en-sw))",'rapid stop floor');
rep("if(risk>A[i]*1.35)continue;","if(risk>A[i]*p.riskCap)continue;",'rapid risk cap');
// Replace Range N4 mixed-direction reconstruction with the promoted BUY-only candidate.
const a=s.indexOf('function rangeS('),b=s.indexOf('function sweep(',a);if(a<0||b<0)throw new Error('PARITY PATCH FAILED: range function');
const range=`function rangeS(m5,E,R,A,D,p){const out=[];let busy=-1;for(let i=100;i<m5.length-2;i++){if(i<=busy||![E[i],E[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0)||D[i]>p.adx)continue;const sm=A.slice(i-50,i).filter(Number.isFinite);if(sm.length<45)continue;const av=sm.reduce((a,b)=>a+b,0)/sm.length,ratio=A[i]/av;if(ratio<p.atrLo||ratio>p.atrHi||Math.abs(E[i]-E[i-6])/A[i]>p.slope)continue;const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;if(width<A[i]*p.wLo||width>A[i]*p.wHi)continue;const edge=Math.max(A[i]*p.edgeAtr,width*p.edgeW);let lt=0,ht=0;for(const x of look){if(x.low<=lo+edge)lt++;if(x.high>=hi-edge)ht++}if(lt<p.touch||ht<p.touch)continue;const c=m5[i],rg=Math.max(1e-9,c.high-c.low),body=Math.abs(c.close-c.open)/rg,lw=(Math.min(c.open,c.close)-c.low)/rg,mid=(hi+lo)/2;if(!(c.low<=lo+edge&&c.close>=lo+edge*.75&&lw>=p.wick&&body<=p.body&&R[i]<=p.rsi))continue;const en=m5[i+1].open,sd=Math.min(Math.max(A[i]*.55,en-(lo-A[i]*.12)),A[i]*1.4),md=mid-en,td=Math.min(md,sd*1.5),rr=td/sd;if(!(sd>0&&rr>=p.minRR))continue;const sl=en-sd,tp=en+td;for(let j=i+1;j<m5.length;j++){const x=m5[j],loss=x.low<=sl,win=x.high>=tp;if(loss||win||j-i>=p.maxBars){const z=loss?-1:win?rr:Math.max(-1,Math.min(rr,(x.close-en)/sd));if(inT(m5[i+1].timestamp))out.push({strategy:'RANGE_BUY',time:m5[i+1].timestamp,exitTime:x.timestamp,r:z,side:'BUY'});busy=j;break}}}return out}\n`;
s=s.slice(0,a)+range+s.slice(b);
rep("console.log('🧬 E2 + R3 + G1 + P1 + N4 + S0');","console.log('🧬 E2 + Rapid-V5 + G1 + P1 + Range-BUY + S0');",'console combo');
rep("['EXHAUST_E2','RAPID_R3','GROK_G1','PRO_P1','RANGE_N4','SWEEP_S0']","['EXHAUST_E2','RAPID_R3','GROK_G1','PRO_P1','RANGE_BUY','SWEEP_S0']",'accepted names');
// Make script identity explicit in output.
s=s.replace("console.log('🔥 CURRENT LIVE EXACT BACKTEST');","console.log('🔥 CURRENT LIVE V2 EXACT BACKTEST — POST RAPID/RANGE PROMOTIONS');");
vm.runInThisContext(s,{filename:'backtest-current-live-v2.generated.js'});
