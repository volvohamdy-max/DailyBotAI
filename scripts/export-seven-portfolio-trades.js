#!/usr/bin/env node
'use strict';
/** Research-only exporter. Uses the exact matching base + portfolio files from the validated commit. */
const fs=require('fs'),path=require('path'),Module=require('module'),cp=require('child_process');
const commit='7d55a57e4eee8155595104e92f84404783e33906';
const show=p=>cp.execFileSync('git',['show',`${commit}:${p}`],{encoding:'utf8'});
const baseTmp=path.join(__dirname,'.mc-base-source.js');
fs.writeFileSync(baseTmp,show('scripts/backtest-current-live.js'));
let s=show('scripts/backtest-micro-pullback-portfolio.js');
// Force the validated harness to read its exact matching base source, never a branch-local wrapper.
s=s.replace("path.join(__dirname,'backtest-current-live.js')","path.join(__dirname,'.mc-base-source.js')");
const compilePoint="const generated=path.join(__dirname,'micro-pullback-portfolio.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);";
if(!s.includes(compilePoint))throw new Error('Validated harness compile point not found');
const injection=`\nconst exportNeedle="const sets=[exhaust(m5,A,LIVE.E2),rapid(m5,h1,A,E,H20,H50,HA,LIVE.R3),grok(m5,h1,A,e9,e21,R,e200,HA,HD,LIVE.G1),pro(m5,h1,R,D,A,LIVE.P1),rangeS(m5,RE,RR,RA,RD,LIVE.N4),sweep(m5,A,LIVE.S0)];const MP=microPullback(m5,A,e9,e21,ema(C,50));const six=portfolio(sets),seven=portfolio([...sets,MP]);";\nif(!s.includes(exportNeedle))throw new Error('Seven-set portfolio point not found');\nconst exportCode="const fs2=require('fs'),path2=require('path');fs2.mkdirSync(path2.join(process.cwd(),'tmp'),{recursive:true});const rows=seven.ok.slice().sort((a,b)=>a.time-b.time).map(x=>({strategy:x.strategy,time:x.time,exitTime:x.exitTime,side:x.side,r:x.r}));fs2.writeFileSync(path2.join(process.cwd(),'tmp','seven-portfolio-trades.json'),JSON.stringify(rows,null,2));console.log('\\n💾 EXPORTED '+rows.length+' accepted trades → tmp/seven-portfolio-trades.json');";\ns=s.replace(exportNeedle,exportNeedle+exportCode);\n`;
s=s.replace(compilePoint,injection+"const generated=path.join(__dirname,'micro-pullback-export.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);");
const wrapper=path.join(__dirname,'seven-portfolio-export.generated.js'),m=new Module(wrapper,module);m.filename=wrapper;m.paths=Module._nodeModulePaths(__dirname);try{m._compile(s,wrapper)}finally{try{fs.unlinkSync(baseTmp)}catch{}}
