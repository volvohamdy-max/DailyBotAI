'use strict';
/* FINAL 7-STRATEGY PORTFOLIO BACKTEST after validated quality updates.
   Exhaustion #408 + Rapid #1297 + Micro #1164 + Grok #101.
   Pro / Range / Sweep unchanged.
*/
const fs=require('fs'),vm=require('vm');
const SRC='scripts/live-portfolio-backtest-post-quality-20260916.js';
if(!fs.existsSync(SRC)){console.error('❌ Missing '+SRC);process.exit(1)}
let wrapper=fs.readFileSync(SRC,'utf8');
const realFs=fs;
const fakeFs={...fs,readFileSync(path,enc){
 let txt=realFs.readFileSync(path,enc);
 if(String(path).endsWith('live-portfolio-backtest-20260915.js')){
  const patches=[
   ["if(up&&R[i]>52)side='BUY';if(dn&&R[i]<48)side='SELL';", "if(up&&R[i]>52)side='BUY';if(dn&&R[i]<44)side='SELL';", 'Grok RSI SELL<44'],
   ["if(!(va>0&&M[i].v>=va*1.25)||HX[h]<20)return;", "if(!(va>0&&M[i].v>=va*1.25)||HX[h]<22)return;", 'Grok H1 ADX>=22'],
   ["if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.10)return;", "if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.30)return;", 'Grok H1 distance>=.30']
  ];
  for(const [a,b,label] of patches){
   if(!txt.includes(a)){console.error('❌ Grok Q101 patch anchor missing: '+label);process.exit(3)}
   txt=txt.replace(a,b);
  }
 }
 return txt;
}};
function localRequire(id){if(id==='fs')return fakeFs;return require(id)}
console.log('FINAL PATCH: Exhaustion #408 + Rapid #1297 + Micro #1164 + Grok #101; Pro/Range/Sweep unchanged.');
vm.runInNewContext(wrapper,{require:localRequire,console,process,__dirname:__dirname,__filename:SRC,Buffer,setTimeout,clearTimeout},{filename:SRC});
