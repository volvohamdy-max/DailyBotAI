'use strict';
/* 7-DAY LIVE-vs-BACKTEST FORENSIC AUDIT — read-only.
   No downloads. Uses the existing one-year Dukascopy M5 file and the locked 8-strategy engine.
   Also audits local SQLite live trades/performance when available.
*/
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),BASE=path.join(ROOT,'scripts','portfolio-q15-exact-merge-20260916.js');
if(!fs.existsSync(BASE)){console.error('❌ Missing '+BASE);process.exit(2)}
let s=fs.readFileSync(BASE,'utf8');
// Capture exact engine trade arrays and suppress its normal report.
const anchor="console.log('EXACT TRADE-LEVEL MERGE — 7 vs 7+Q15')";
if(!s.includes(anchor)){console.error('❌ Engine report anchor changed');process.exit(3)}
s=s.replace(anchor,"globalThis.__FORENSIC={M:E.M,trades:E.trades};"+anchor);
const quiet={log(){},error:console.error};let ctx={require,console:quiet,process,__dirname:path.dirname(BASE),__filename:BASE,Buffer,setTimeout,clearTimeout};
vm.runInNewContext(s,ctx,{filename:BASE});const E=ctx.__FORENSIC;if(!E){console.error('❌ Engine capture failed');process.exit(4)}
const end=E.M.at(-1).t+300000,start=end-7*86400000;
const names={EXHAUSTION:'GOLD_EXHAUSTION_V3',RAPID:'GOLD_RAPID_SCALP_V5',GROK:'GROK_GOLD_92',PRO:'PRO_STRATEGY',RANGE:'GOLD_RANGE_MR',SWEEP:'GOLD_SWEEP_5',MICRO:'GOLD_MICRO_PULLBACK',Q15:'GOLD_FAILED_MOVE_Q15'};
function stats(a){let w=0,l=0,be=0,net=0,gp=0,gl=0,ls=0,maxls=0;for(const x of a){net+=x.r;if(x.r>1e-9){w++;gp+=x.r;ls=0}else if(x.r< -1e-9){l++;gl-=x.r;ls++;maxls=Math.max(maxls,ls)}else{be++;ls=0}}return{n:a.length,w,l,be,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?Infinity:0),net,maxls}}
function fmt(x){return `T${x.n} W${x.w} L${x.l} BE${x.be} WR${x.wr.toFixed(1)} PF${Number.isFinite(x.pf)?x.pf.toFixed(2):'∞'} N${x.net>=0?'+':''}${x.net.toFixed(2)}R LS${x.maxls}`}
console.log('🔬 LIVE-vs-BACKTEST — 7 DAY FORENSIC');console.log(`Historical window: ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);console.log('Execution model: locked current 8-strategy historical engine; existing data only; no download.\n');
let all=[];for(const [k,label] of Object.entries(names)){const a=(E.trades[k]||[]).filter(x=>x.exit>=start&&x.exit<end);all.push(...a.map(x=>({...x,k})));console.log(`${label.padEnd(25)} | ${fmt(stats(a))}`);for(const x of a)console.log(`   ${new Date(E.M[x.entryI].t).toISOString()} ${x.side} → ${x.reason} ${x.r>=0?'+':''}${x.r.toFixed(2)}R`)}
all.sort((a,b)=>a.exit-b.exit);console.log('\n8-STRATEGY HISTORICAL 7D | '+fmt(stats(all)));
console.log('\n⚠️ PARITY AUDIT FROM CURRENT LIVE CODE');
console.log('1) Live signals are rebased to current GoldAPI/live price after the strategy fires; historical engine enters next M5 open.');
console.log('2) Live DB stores only entry/SL/TP1/TP2 — it does NOT store maxBars or strategy-specific exit metadata.');
console.log('3) Current tradeMonitor has no generic maxBars timeout. Therefore Rapid/Range/Micro/Q15 historical maxBars exits are NOT reproduced live.');
console.log('4) Current Pro monitor BUY RSI exit is >=55, while signal text/current Pro research logic says >=58. This is a direct live/backtest mismatch.');
console.log('5) Live monitor samples price every 15s; candle backtest uses M5 OHLC and conservative SL-first ambiguity handling.');
console.log('6) Portfolio tracking caps managed gold trades at 2 concurrently; VIP signal can still be delivered even when tracking is skipped. Historical 8-strategy engine is one-open-per-strategy and does not impose the same 2-slot tracking cap.');
try{
 const db=require(path.join(ROOT,'src','database','db'));const rows=db.prepare(`SELECT * FROM trades WHERE pair='XAUUSD' AND id IS NOT NULL ORDER BY id DESC LIMIT 200`).all();
 const recent=rows.filter(r=>{const t=Date.parse(r.created_at||r.createdAt||r.opened_at||r.timestamp||'');return Number.isFinite(t)&&t>=start&&t<end});
 console.log(`\nLOCAL DB: ${recent.length} rows could be dated inside the same historical 7D window.`);if(!recent.length)console.log('If your DB schema has no trade timestamp column, use the /performance numbers as the live side; this script still diagnoses code-level parity mismatches.');
}catch(e){console.log('\nLOCAL DB audit unavailable: '+e.message)}
console.log('\nDECISION RULE: Do not optimize WR until these parity mismatches are separated from genuine strategy losses.');