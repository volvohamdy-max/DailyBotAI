'use strict';
// Medium-speed PRO optimizer focused on recovering a high-activity SL $14 candidate.
// Research only; no live strategy files are modified.
const fs=require('fs'),path=require('path');
const base=fs.readFileSync(path.join(__dirname,'optimize-pro-current-v3.js'),'utf8');
let src=base
.replace("for(const stop of [10,11,12,13,14,15,16])for(const adxMin of [14,16,18,20,22])for(const entry of [35,36,37,38,39,40])for(const exit of [52,53,54,55,56,57,58])for(const atrMax of [1.05,1.10,1.15,1.20,1.25])", "for(const stop of [14])for(const adxMin of [12,14,16,18,20])for(const entry of [36,37,38,39,40,41])for(const exit of [52,53,54,55,56,57])for(const atrMax of [1.10,1.15,1.20,1.25])")
.replace('PRO CURRENT OPTIMIZER','PRO SL14 MEDIUM OPTIMIZER')
.replace(".filter(x=>x.n>=120&&x.net>0&&x.pf>1).sort((a,b)=>(b.wr-a.wr)|| (b.net-a.net))", ".filter(x=>x.n>=200&&x.net>0&&x.pf>1).sort((a,b)=>{const ap=Math.abs(a.n-275),bp=Math.abs(b.n-275);const as=a.wr-(ap>45?3:0),bs=b.wr-(bp>45?3:0);return (bs-as)||(b.pf-a.pf)||(b.net-a.net)})")
.replace('Math.min(30,out.length)','Math.min(40,out.length)');
new Function('require','__dirname','console',src)(require,__dirname,console);
