'use strict';
// Loader for the exact base backtest used by the validated seven-set research commit.
const fs=require('fs'),path=require('path'),Module=require('module'),cp=require('child_process');
const commit='7d55a57e4eee8155595104e92f84404783e33906';
const source=cp.execFileSync('git',['show',`${commit}:scripts/backtest-current-live.js`],{encoding:'utf8'});
const generated=path.join(__dirname,'.backtest-current-live.source.js');
const m=new Module(generated,module);m.filename=generated;m.paths=Module._nodeModulePaths(__dirname);m._compile(source,generated);
