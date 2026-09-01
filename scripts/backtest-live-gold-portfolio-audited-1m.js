'use strict';
/*
 AUDITED LIVE PORTFOLIO REPLAY — 1 MONTH
 Important correction versus fresh-1m v1:
 - Live tradeMonitor does NOT close trades at strategy maxBars. Therefore this replay does not count maxBars as timeout.
 - Non-Grok, non-Pro trades model the live 80%-to-target protection: once secured, reversal to entry => BE.
 - Grok92 has no protection in live monitor.
 - Pro models $12 SL + RSI 55/45 exit, blocked hours, Wednesday 17:00-20:30 UTC block,
   180m cooldown after a losing close, and max 2 losses/day.
 This file intentionally imports the signal list produced by an embedded copy of v1 with outcomes recomputed under live monitor rules.
*/
const fs=require('fs'),path=require('path'),vm=require('vm');
const v1=fs.readFileSync(path.resolve('scripts/backtest-live-gold-portfolio-fresh-1m.js'),'utf8');
// Execute only signal-generation portion of v1, stopping before its old maxBars outcome simulator.
const marker='// Simulate each signal independently;';
const prefix=v1.slice(0,v1.indexOf(marker));
const suffix=`\n;globalThis.__AUDIT={c,out,R};`;
const box={require,console:{log(){}},process,__dirname:path.resolve('scripts'),__filename:path.resolve('scripts/backtest-live-gold-portfolio-fresh-1m.js')};vm.createContext(box);vm.runInContext(prefix+suffix,box,{timeout:30000});
const {c,out,R}=box.__AUDIT;
const isGrok=q=>q.id==='GROK_GOLD_92',isPro=q=>q.id==='PRO_STRATEGY';
// Remove Pro signals that live state would block. Other strategy signals are left independent because VIP-first sends READY
// even when an existing tracked trade prevents duplicate tracking.
const proState={day:null,losses:0,coolUntil:0};
function dkey(t){return new Date(t).toISOString().slice(0,10)}
function proBlockedAt(t){const d=new Date(t),m=d.getUTCHours()*60+d.getUTCMinutes();return d.getUTCDay()===3&&m>=1020&&m<=1230}
function resolve(q){let secured=false,r=0,kind='OPEN',exit=q.i,exitPx=q.entry;const last=c.length-1;
 for(let k=q.i+1;k<=last;k++){const x=c[k];
  if(isPro(q)){
   const hs=q.side==='BUY'?x.l<=q.sl:x.h>=q.sl;if(hs){r=-1;kind='SL';exit=k;exitPx=q.sl;break}
   const hit=q.side==='BUY'?R[k]>=55:R[k]<=45;if(hit){r=q.side==='BUY'?(x.c-q.entry)/(q.entry-q.sl):(q.entry-x.c)/(q.sl-q.entry);kind=r>0?'WIN':'LOSS';exit=k;exitPx=x.c;break}
   continue;
  }
  const hs=q.side==='BUY'?x.l<=q.sl:x.h>=q.sl,ht=q.side==='BUY'?x.h>=q.tp:x.l<=q.tp;
  // tradeMonitor's missed-touch recovery is conservative when TP and SL occur in one M5 candle.
  if(hs&&ht){r=-1;kind='SL';exit=k;exitPx=q.sl;break}if(ht){r=Math.abs(q.tp-q.entry)/Math.abs(q.entry-q.sl);kind='TP';exit=k;exitPx=q.tp;break}if(hs){r=-1;kind='SL';exit=k;exitPx=q.sl;break}
  if(!isGrok(q)){
   const progress=q.side==='BUY'?(x.h-q.entry)/(q.tp-q.entry):(q.entry-x.l)/(q.entry-q.tp);
   if(!secured&&progress>=.80)secured=true;
   if(secured){const be=q.side==='BUY'?x.l<=q.entry:x.h>=q.entry;if(be){r=0;kind='BE';exit=k;exitPx=q.entry;break}}
  }
 }
 return{...q,r,kind,exit,exitPx};}
const ordered=out.slice().sort((a,b)=>a.t-b.t),done=[];
for(const q of ordered){if(isPro(q)){
 const day=dkey(q.t);if(proState.day!==day){proState.day=day;proState.losses=0}
 if(proState.losses>=2||q.t<proState.coolUntil||proBlockedAt(q.t))continue;
 const z=resolve(q);done.push(z);if(z.kind==='SL'||z.kind==='LOSS'){proState.losses++;proState.coolUntil=c[z.exit]?.t+180*60000}
 }else done.push(resolve(q));}
function st(a){let w=0,l=0,be=0,open=0,net=0,pk=0,dd=0,ls=0,maxls=0,grossW=0,grossL=0;for(const x of a){if(x.r>0){w++;grossW+=x.r;ls=0}else if(x.r<0){l++;grossL+=-x.r;ls++;maxls=Math.max(maxls,ls)}else if(x.kind==='BE')be++;else open++;net+=x.r;pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}const resolved=w+l;return{n:a.length,w,l,be,open,wr:resolved?w/resolved*100:0,allwr:a.length?w/a.length*100:0,net,dd,maxls,pf:grossL?grossW/grossL:(grossW?99:0)}}
const ids=[...new Set(done.map(x=>x.id))],start=Math.min(...done.map(x=>x.t)),end=Math.max(...done.map(x=>x.t));
console.log(`\n🔎 AUDITED LIVE PORTFOLIO — 1 MONTH\n${new Date(start).toISOString().slice(0,10)} → ${new Date(end).toISOString().slice(0,10)} | CURRENT 8 LIVE STRATEGIES\nNO maxBars timeout (live monitor has none) | 80% protection modeled | Grok protection excluded | Pro state modeled\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
for(const id of ids){const a=done.filter(x=>x.id===id),s=st(a);console.log(`${a[0].label.padEnd(30)} T${s.n} W${s.w}/L${s.l}/BE${s.be}/OPEN${s.open} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.maxls}`)}
const S=st(done);console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log(`ALL SIGNALS                     T${S.n} W${S.w}/L${S.l}/BE${S.be}/OPEN${S.open} WR${S.wr.toFixed(1)}% PF${S.pf.toFixed(2)} Net${S.net>=0?'+':''}${S.net.toFixed(2)}R DD${S.dd.toFixed(2)} LS${S.maxls}`);
console.log('\nAUDIT FIX: v1 incorrectly treated each strategy maxBars as a forced timeout. Current tradeMonitor does not implement maxBars. Therefore v1 53.4% must NOT be compared directly with the older ~65% portfolio result.');
