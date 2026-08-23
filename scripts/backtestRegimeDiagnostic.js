const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'backtestRegimeDukascopyOptimize.js');
let s=fs.readFileSync(base,'utf8');
// Candidate 1 only: ADX 26 / TP 1.5, keep all other tested gates unchanged.
const start=s.indexOf('  const configs=[];');
const marker="    configs.push({adxMin,anchorMax,momentumMin,bodyShareMin,tpR,scoreMin,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2});";
const end=s.indexOf(marker,start);
if(start<0||end<0)throw new Error('Optimizer config block not found');
const repl="  const configs=[{adxMin:26,anchorMax:0.55,momentumMin:2,bodyShareMin:0.4,tpR:1.5,scoreMin:78,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2}];";
s=s.slice(0,start)+repl+s.slice(end+marker.length);
s=s.replace("console.log('🧭 GOLD REGIME — DUKASCOPY OPTIMIZER');","console.log('🔎 GOLD REGIME — CANDIDATE 1 DIAGNOSTIC');");
// Print diagnostics from FULL trades after the existing FULL stats are built.
s=s.replace("print(x.full);",`print(x.full);\n    const diag=x.fullTrades||null;`);
// Replace top construction to retain full trade rows.
s=s.replace("const full=stats('FULL',runRegime(m5,m15,h1,ind,x.cfg,0,n-2));return {...x,hold,full};","const fullTrades=runRegime(m5,m15,h1,ind,x.cfg,0,n-2);const full=stats('FULL',fullTrades);return {...x,hold,full,fullTrades};");
// Insert diagnostic output before completion marker.
s=s.replace("console.log('\\n✅ Done.');",`const rows=top[0]?.fullTrades||[];\n  const st=(name,a)=>print(stats(name,a));\n  console.log('\\n🔎 DIAGNOSTIC — FULL PERIOD');\n  st('BUY',rows.filter(t=>t.side==='BUY'));\n  st('SELL',rows.filter(t=>t.side==='SELL'));\n  const london=t=>{const h=new Date(t.time).getUTCHours();return h>=7&&h<13};\n  const ny=t=>{const h=new Date(t.time).getUTCHours();return h>=13&&h<20};\n  st('LONDON 07-13 UTC',rows.filter(london));\n  st('NEW YORK 13-20 UTC',rows.filter(ny));\n  const y2026=rows.filter(t=>new Date(t.time).getUTCFullYear()===2026);\n  console.log('\\n🔎 DIAGNOSTIC — 2026 ONLY');\n  st('2026 BUY',y2026.filter(t=>t.side==='BUY'));\n  st('2026 SELL',y2026.filter(t=>t.side==='SELL'));\n  st('2026 LONDON 07-13 UTC',y2026.filter(london));\n  st('2026 NEW YORK 13-20 UTC',y2026.filter(ny));\n  console.log('\\n✅ Done.');`);
eval(s);
