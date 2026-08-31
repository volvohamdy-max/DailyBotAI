#!/usr/bin/env node
'use strict';
/** Research-only: 7 live vs 8 set with fixed Opening Drive. MAX OPEN 2. */
const fs=require('fs'),path=require('path'),Module=require('module');
const base=path.join(__dirname,'backtest-micro-pullback-portfolio.js');
let s=fs.readFileSync(base,'utf8');
function mustFind(x,label){const i=s.indexOf(x);if(i<0)throw new Error('OD PATCH FAILED: '+label);return i}
// 1) Add OD function inside the exact template that is already injected into generated source.
const fm='const micro=`function microPullback';
const fi=mustFind(fm,'micro function');
const od="function openingDrive(c,A){const p={driveBars:2,driveAtr:1.5,pullbackBars:2,retraceMin:.2,retraceMax:.6,confirmBody:.4,rr:1.2,maxBars:8,sessions:[7,8,9,12,13]};const out=[];let busy=-1;for(let i=30;i<c.length-p.maxBars;i++){const b=c[i],h=new Date(b.timestamp).getUTCHours();if(i<=busy||!A[i]||!p.sessions.includes(h))continue;const st=i-p.pullbackBars-p.driveBars+1;if(st<1)continue;const dr=c.slice(st,st+p.driveBars),pb=c.slice(st+p.driveBars,i),mv=dr[dr.length-1].close-dr[0].open,mag=Math.abs(mv);if(mag<p.driveAtr*A[i])continue;const side=mv>0?'BUY':'SELL',ext=side==='BUY'?Math.max(...dr.map(x=>x.high)):Math.min(...dr.map(x=>x.low)),ret=side==='BUY'?(ext-Math.min(...pb.map(x=>x.low)))/mag:(Math.max(...pb.map(x=>x.high))-ext)/mag;if(ret<p.retraceMin||ret>p.retraceMax)continue;const rg=b.high-b.low,bd=Math.abs(b.close-b.open);if(!rg||bd/rg<p.confirmBody)continue;if(side==='BUY'&&!(b.close>b.open&&b.close>c[i-1].high))continue;if(side==='SELL'&&!(b.close<b.open&&b.close<c[i-1].low))continue;const en=b.close,risk=A[i],sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+risk*p.rr:en-risk*p.rr;let r=0,exit=i+p.maxBars;for(let j=i+1;j<=exit;j++){const loss=side==='BUY'?c[j].low<=sl:c[j].high>=sl,win=side==='BUY'?c[j].high>=tp:c[j].low<=tp;if(loss){r=-1;exit=j;break}if(win){r=p.rr;exit=j;break}if(j===exit)r=Math.max(-1,Math.min(p.rr,(side==='BUY'?c[j].close-en:en-c[j].close)/risk))}if(inT(b.timestamp))out.push({strategy:'OPENING_DRIVE',time:b.timestamp,exitTime:c[exit].timestamp,r,side});busy=exit}return out}\\n";
s=s.slice(0,fi)+'const micro=`'+od+'function microPullback'+s.slice(fi+fm.length);
// 2) Extend the existing generated portfolio declarations using an exact stable declaration.
const decl="const MP=microPullback(m5,A,e9,e21,ema(C,50));const six=portfolio(sets),seven=portfolio([...sets,MP]);";
const di=mustFind(decl,'portfolio declaration');
s=s.slice(0,di)+"const MP=microPullback(m5,A,e9,e21,ema(C,50));const OD=openingDrive(m5,A);const six=portfolio(sets),seven=portfolio([...sets,MP]),eight=portfolio([...sets,MP,OD]);"+s.slice(di+decl.length);
// 3) Insert report immediately after MICRO ACCEPT call; no brittle newline/emoji matching.
const key="print('MICRO ACCEPT',seven.ok.filter(x=>x.strategy==='MICRO_PULLBACK'));";
const ki=mustFind(key,'micro accept call')+key.length;
const report="console.log('\\\\n🚀 OPENING DRIVE RAW');print('OPENING RAW',OD);console.log('\\\\n🥊 7 LIVE vs 8 SET — MAX OPEN 2');print('7 LIVE',seven.ok);print('8 SET',eight.ok);const d7=daily(seven.ok),d8=daily(eight.ok);console.log('7 LIVE days='+d7.active+' winDays='+d7.winPct.toFixed(1)+'% avg='+d7.avg.toFixed(2)+' blocked='+seven.blocked.length);console.log('8 SET days='+d8.active+' winDays='+d8.winPct.toFixed(1)+'% avg='+d8.avg.toFixed(2)+' blocked='+eight.blocked.length);console.log('OPENING accepted='+eight.ok.filter(x=>x.strategy==='OPENING_DRIVE').length+' blocked='+eight.blocked.filter(x=>x.strategy==='OPENING_DRIVE').length);console.log('\\\\n📈 8-SET BUY / SELL');print('BUY',eight.ok.filter(x=>x.side==='BUY'));print('SELL',eight.ok.filter(x=>x.side==='SELL'));console.log('\\\\n📦 OPENING AFTER LIMIT');print('OPENING ACCEPT',eight.ok.filter(x=>x.strategy==='OPENING_DRIVE'));";
s=s.slice(0,ki)+report+s.slice(ki);
s=s.replace('🧪 MICRO PULLBACK PORTFOLIO RESEARCH — NO LIVE CHANGES','🧪 OPENING DRIVE PORTFOLIO RESEARCH — NO LIVE CHANGES');
const generated=path.join(__dirname,'opening-drive-portfolio.generated.js');
const m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);
