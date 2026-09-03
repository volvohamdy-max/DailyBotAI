'use strict';
// FAST optimizer: reuse current optimizer engine, but narrow search around live settings and SL14.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'optimize-pro-current-v3.js'),'utf8');
let fast=src
.replace("for(const stop of [10,11,12,13,14,15,16])for(const adxMin of [14,16,18,20,22])for(const entry of [35,36,37,38,39,40])for(const exit of [52,53,54,55,56,57,58])for(const atrMax of [1.05,1.10,1.15,1.20,1.25])", "for(const stop of [12,14,16])for(const adxMin of [16,18,20])for(const entry of [36,37,38])for(const exit of [54,55,56])for(const atrMax of [1.10,1.15,1.20])")
.replace('PRO CURRENT OPTIMIZER','PRO FAST OPTIMIZER');
// Avoid recursive self-loading; execute generated source directly.
new Function('require','__dirname','console',fast)(require,__dirname,console);
