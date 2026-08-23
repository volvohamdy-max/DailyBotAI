const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'backtestNewYorkDukascopyQuick.js');
let s=fs.readFileSync(base,'utf8');
s=s.replace("🗽 NEW YORK — DUKASCOPY QUICK OPTIMIZER","⚡ NEW YORK — QUICK LIGHT (6 VARIANTS)");
// Narrow custom New York session windows, keep core logic unchanged.
s=s.replace("function nySession(ts){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ts));const h=Number(p.find(x=>x.type==='hour')?.value||0),m=Number(p.find(x=>x.type==='minute')?.value||0),x=h*60+m;return x>=510&&x<720;}","function nyMinutes(ts){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ts));const h=Number(p.find(x=>x.type==='hour')?.value||0),m=Number(p.find(x=>x.type==='minute')?.value||0);return h*60+m;} function nySession(ts,cfg){const x=nyMinutes(ts);return x>=cfg.startMin&&x<cfg.endMin;}");
s=s.replace("if(!nySession(m5[entryIdx].timestamp))continue;","if(!nySession(m5[entryIdx].timestamp,cfg))continue;");
const old="const configs=[];for(const adxMin of [22,25])for(const chaseMax of [0.35,0.50])for(const rr of [1.0,1.25])configs.push({adxMin,chaseMax,rr,bodyMax:0.35});";
const neu=`const configs=[
 {name:'A',adxMin:25,chaseMax:0.35,rr:1.0,bodyMax:0.35,startMin:510,endMin:660},
 {name:'B',adxMin:25,chaseMax:0.35,rr:1.25,bodyMax:0.35,startMin:510,endMin:660},
 {name:'C',adxMin:25,chaseMax:0.35,rr:1.0,bodyMax:0.35,startMin:540,endMin:690},
 {name:'D',adxMin:25,chaseMax:0.35,rr:1.25,bodyMax:0.35,startMin:540,endMin:690},
 {name:'E',adxMin:25,chaseMax:0.45,rr:1.0,bodyMax:0.35,startMin:570,endMin:720},
 {name:'F',adxMin:25,chaseMax:0.45,rr:1.25,bodyMax:0.35,startMin:570,endMin:720}
];`;
if(!s.includes(old))throw new Error('Quick config block not found');
s=s.replace(old,neu).replace('🔬 QUICK Variants=${configs.length}','🔬 QUICK LIGHT Variants=${configs.length}');
eval(s);
