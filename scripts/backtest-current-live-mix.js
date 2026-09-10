'use strict';
// READ-ONLY portfolio summary matching the CURRENT LIVE session mix:
// Exhaustion/Rapid/Pro/Micro = 24H; Grok92/Range MR = naturally unrestricted;
// Sweep5 = its restricted live hours [9,10,11,12,17] UTC.
// Does not import or modify live runtime strategy files.
const cp=require('child_process'),path=require('path');
const env={...process.env,BACKTEST_FROM:process.env.BACKTEST_FROM||'2025-09-10T00:00:00Z',BACKTEST_TO:process.env.BACKTEST_TO||'2026-09-10T23:59:59Z'};
function run(file){return cp.execFileSync(process.execPath,[path.join(__dirname,file)],{encoding:'utf8',env,maxBuffer:30*1024*1024});}
function parseHours(out,name,mode){const re=new RegExp('\\n'+name+'\\s*\\n[\\s\\S]*?'+mode+'\\s+\\| T(\\d+) WR([\\d.]+)% PF([\\d.]+) Net([+-][\\d.]+)R DD([\\d.]+)R');const m=out.match(re);if(!m)throw Error('Could not parse '+mode+' '+name);return{n:name,t:+m[1],wr:+m[2],pf:+m[3],net:+m[4],dd:+m[5]};}
function parseLive(out,aliases,label){for(const name of aliases){const re=new RegExp('^'+name.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'\\s*\\|\\s*T(\\d+)\\s+WR([\\d.]+)%?\\s+PF([\\d.]+)\\s+N(?:et)?([+-][\\d.]+)R\\s+DD([\\d.]+)','mi');const m=out.match(re);if(m)return{n:label,t:+m[1],wr:+m[2],pf:+m[3],net:+m[4],dd:+m[5]};}throw Error('Could not parse '+label);}
const hours=run('backtest-live-hours-24h-lab.js');
const live=run('backtest-all-live-gold-strategies.js');
const rows=[
 parseHours(hours,'EXHAUSTION','24H'),
 parseHours(hours,'RAPID','24H'),
 parseLive(live,['GROK92','GROK_92','GROK GOLD 92','GROK'],'GROK92'),
 parseHours(hours,'PRO','24H'),
 parseLive(live,['RANGE MR','RANGE_MR','RANGE-MR','RANGE MR N4','RANGE_MR_N4','RANGE'],'RANGE_MR'),
 parseHours(hours,'SWEEP5','CURRENT'),
 parseHours(hours,'MICRO','24H')
];
let T=0,W=0,net=0;for(const r of rows){T+=r.t;W+=r.t*r.wr/100;net+=r.net;}
console.log('\n📊 CURRENT LIVE MIX — 7 GOLD STRATEGIES (READ ONLY)');
console.log(env.BACKTEST_FROM.slice(0,10)+' -> '+env.BACKTEST_TO.slice(0,10));
for(const r of rows)console.log(`${r.n.padEnd(11)} T${String(r.t).padStart(4)} WR${r.wr.toFixed(1)}% PF${r.pf.toFixed(2)} Net${r.net>=0?'+':''}${r.net.toFixed(1)}R DD${r.dd.toFixed(1)}R`);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`TOTAL TRADES : ${T}`);
console.log(`WIN RATE     : ${(100*W/T).toFixed(1)}%`);
console.log(`NET R (sum)  : ${net>=0?'+':''}${net.toFixed(1)}R`);
console.log('SESSION MIX  : Exhaustion/Rapid/Pro/Micro 24H + Grok92/Range MR unrestricted + Sweep5 restricted [9,10,11,12,17] UTC');
console.log('NOTE         : Portfolio WR is trade-count weighted from displayed strategy WRs; per-strategy PF/DD shown above.');
console.log('🛡️ READ ONLY — LIVE STRATEGIES UNCHANGED\n');