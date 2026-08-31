#!/usr/bin/env node
'use strict';
/** Research-only exporter using exact validated sources from commit 7d55a57e. */
const fs=require('fs'),path=require('path'),Module=require('module'),cp=require('child_process');
const commit='7d55a57e4eee8155595104e92f84404783e33906';
const show=p=>cp.execFileSync('git',['show',commit+':'+p],{encoding:'utf8'});
const baseTmp=path.join(__dirname,'.mc-base-source.js');
fs.writeFileSync(baseTmp,show('scripts/backtest-current-live.js'));
let harness=show('scripts/backtest-micro-pullback-portfolio.js');
harness=harness.replace("path.join(__dirname,'backtest-current-live.js')","path.join(__dirname,'.mc-base-source.js')");
const marker="const generated=path.join(__dirname,'micro-pullback-portfolio.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);";
if(!harness.includes(marker))throw new Error('Validated harness compile point not found');
const hook=[
"const sevenDecl=\"const six=portfolio(sets),seven=portfolio([...sets,MP]);\";",
"if(!s.includes(sevenDecl))throw new Error('Seven-set declaration not found');",
"const exportCode=\"const __fs=require('fs'),__path=require('path');__fs.mkdirSync(__path.join(process.cwd(),'tmp'),{recursive:true});const __rows=seven.ok.slice().sort((a,b)=>a.time-b.time).map(x=>({strategy:x.strategy,time:x.time,exitTime:x.exitTime,side:x.side,r:x.r}));__fs.writeFileSync(__path.join(process.cwd(),'tmp','seven-portfolio-trades.json'),JSON.stringify(__rows,null,2));console.log('EXPORTED '+__rows.length+' accepted trades -> tmp/seven-portfolio-trades.json');\";",
"s=s.replace(sevenDecl,sevenDecl+exportCode);",
"const generated=path.join(__dirname,'micro-pullback-export.generated.js'),m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(s,generated);"
].join('\n');
harness=harness.replace(marker,hook);
const wrapper=path.join(__dirname,'seven-portfolio-export.generated.js');
const m=new Module(wrapper,module);m.filename=wrapper;m.paths=Module._nodeModulePaths(__dirname);
try{m._compile(harness,wrapper)}finally{try{fs.unlinkSync(baseTmp)}catch{}}
