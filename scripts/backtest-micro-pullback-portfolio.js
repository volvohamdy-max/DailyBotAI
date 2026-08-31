#!/usr/bin/env node
'use strict';
/** Research-only: load the validated seven-set portfolio harness from its immutable research commit. */
const fs=require('fs'),path=require('path'),Module=require('module'),cp=require('child_process');
const target=path.join(__dirname,'.micro-pullback-portfolio.source.js');
if(!fs.existsSync(target)){
  const txt=cp.execFileSync('git',['show','7d55a57e4eee8155595104e92f84404783e33906:scripts/backtest-micro-pullback-portfolio.js'],{encoding:'utf8'});
  fs.writeFileSync(target,txt);
}
const code=fs.readFileSync(target,'utf8'),m=new Module(target,module);m.filename=target;m.paths=Module._nodeModulePaths(__dirname);m._compile(code,target);
