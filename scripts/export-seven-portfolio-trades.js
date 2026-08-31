#!/usr/bin/env node
'use strict';
/** Research-only exporter. Reuses the validated seven-set portfolio backtest and captures its accepted trade list. */
const fs=require('fs'),path=require('path'),Module=require('module');
const src=path.join(__dirname,'backtest-micro-pullback-portfolio.js');
if(!fs.existsSync(src))throw new Error('Missing scripts/backtest-micro-pullback-portfolio.js on this branch');
let s=fs.readFileSync(src,'utf8');
const needle="const generated=path.join(__dirname,'micro-pullback-portfolio.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);";
if(!s.includes(needle))throw new Error('Exporter patch point not found');
const repl=`const exportNeedle="const sets=[exhaust(m5,A,LIVE.E2),rapid(m5,h1,A,E,H20,H50,HA,LIVE.R3),grok(m5,h1,A,e9,e21,R,e200,HA,HD,LIVE.G1),pro(m5,h1,R,D,A,LIVE.P1),rangeS(m5,RE,RR,RA,RD,LIVE.N4),sweep(m5,A,LIVE.S0)];const MP=microPullback(m5,A,e9,e21,ema(C,50));const six=portfolio(sets),seven=portfolio([...sets,MP]);";\nconst exportReplace=exportNeedle+"const fs2=require('fs'),path2=require('path');fs2.mkdirSync(path2.join(process.cwd(),'tmp'),{recursive:true});fs2.writeFileSync(path2.join(process.cwd(),'tmp','seven-portfolio-trades.json'),JSON.stringify(seven.ok.slice().sort((a,b)=>a.time-b.time).map(x=>({strategy:x.strategy,time:x.time,exitTime:x.exitTime,side:x.side,r:x.r})),null,2));console.log('\\n💾 EXPORTED '+seven.ok.length+' accepted trades → tmp/seven-portfolio-trades.json');";\nif(!s.includes(exportNeedle))throw new Error('Seven-set injection point not found');s=s.replace(exportNeedle,exportReplace);\nconst generated=path.join(__dirname,'micro-pullback-export.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);`;
s=s.replace(needle,repl);
const generated=path.join(__dirname,'seven-portfolio-export-wrapper.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);
