#!/usr/bin/env node
'use strict';

/* True one-pass 3Y yearly/strategy/side breakdown. Research only. */
const {spawnSync}=require('child_process');
const fs=require('fs');
const os=require('os');
const path=require('path');
const FROM=process.argv[2]||'2023-08-29';
const TO=process.argv[3]||'2026-08-29';
const root=path.resolve(__dirname,'..');
const engine=path.join(__dirname,'backtest-live-gold-portfolio-6-exact.js');
const ledger=path.join(os.tmpdir(),`dailybot-six-3y-${process.pid}.json`);
const tempEngine=path.join(__dirname,`.tmp-six-3y-${process.pid}.js`);
let src=fs.readFileSync(engine,'utf8');
const marker="console.log('\\n🔒 Research only. Live strategies/VIP routing untouched.');";
if(!src.includes(marker)){console.error('❌ Exact engine marker not found; refusing to alter logic.');process.exit(1)}
const exportCode=`require('fs').writeFileSync(process.env.BACKTEST_LEDGER_JSON,JSON.stringify({accepted,acceptedCount:accepted.length,rejectedCount:rejected.length},null,2));`;
src=src.replace(marker,exportCode+marker);fs.writeFileSync(tempEngine,src);
let r;try{r=spawnSync(process.execPath,[tempEngine,FROM,TO],{cwd:root,stdio:'inherit',env:{...process.env,BACKTEST_LEDGER_JSON:ledger}})}finally{try{fs.unlinkSync(tempEngine)}catch{}}
if(r?.error){console.error(r.error);process.exit(1)}if(r?.status!==0)process.exit(r?.status||1);if(!fs.existsSync(ledger)){console.error('❌ Ledger export missing.');process.exit(1)}
const data=JSON.parse(fs.readFileSync(ledger,'utf8'));try{fs.unlinkSync(ledger)}catch{}const trades=data.accepted||[];
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,ml=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ml=Math.max(ml,++ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?100*w/t.length:0,net,pf:gl?gp/gl:(gp?999:0),dd,ls:ml}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;
const names=['EXHAUST','RAPID','GROK92','PRO','RANGE','SWEEP5'];const year=x=>new Date(x.time).getUTCFullYear();const years=[...new Set(trades.map(year))].sort();
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('📅 TRUE 3Y YEARLY PORTFOLIO + STRATEGIES');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for(const y of years){const z=trades.filter(x=>year(x)===y);console.log(`\n🏆 ${y} PORTFOLIO | ${fmt(stats(z))}`);for(const n of names)console.log(`${n.padEnd(7)} ${fmt(stats(z.filter(x=>x.strategy===n)))}`)}
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('↕️ 3Y BUY / SELL BY STRATEGY');console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');for(const n of names){console.log(`\n${n}`);for(const side of ['BUY','SELL'])console.log(`  ${side.padEnd(4)} ${fmt(stats(trades.filter(x=>x.strategy===n&&x.side===side)))}`)}
console.log('\n🏆 3Y PORTFOLIO BY SIDE');for(const side of ['BUY','SELL'])console.log(`${side.padEnd(4)} ${fmt(stats(trades.filter(x=>x.side===side)))}`);
console.log(`\n✅ Ledger integrity: ${trades.length} accepted | engine=${data.acceptedCount} | MAX2 blocked=${data.rejectedCount}`);console.log('🔒 Single 3-year run. No optimization. Live/VIP untouched.');