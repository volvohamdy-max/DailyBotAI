#!/usr/bin/env node
'use strict';
/**
 * Expanded six-strategy 70% WR research optimizer.
 * Generates a temporary copy of the existing six-strategy portfolio engine,
 * expands the candidate neighbourhood for ALL SIX strategies, keeps MAX OPEN 2,
 * and ranks only active/positive portfolios with WR first.
 * Live files are never changed.
 */
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const FROM=process.argv[2]||'2026-03-01';
const TO=process.argv[3]||'2026-08-29';
const base=path.join(__dirname,'backtest-six-final-month-combo.js');
const tmp=path.join(__dirname,'.tmp-six-70wr-expanded.js');
let src=fs.readFileSync(base,'utf8');
const cfg=`const cfg={
 EXHAUST:[
  {id:'E-ACT',buyBurst:2.2,sellBurst:2.5,buyWick:.25,sellWick:.35,tp:.70},
  {id:'E-X1',buyBurst:2.3,sellBurst:2.6,buyWick:.25,sellWick:.35,tp:.70},
  {id:'E-X2',buyBurst:2.4,sellBurst:2.7,buyWick:.25,sellWick:.35,tp:.70},
  {id:'E-X3',buyBurst:2.2,sellBurst:2.5,buyWick:.30,sellWick:.40,tp:.70},
  {id:'E-X4',buyBurst:2.3,sellBurst:2.6,buyWick:.30,sellWick:.40,tp:.80},
  {id:'E-LIVE',buyBurst:2.2,sellBurst:2.6,buyWick:.30,sellWick:.40,tp:1}
 ],
 RAPID:[
  {id:'R-X1',rr:1.25,sep:.04},{id:'R-X2',rr:1.50,sep:.04},
  {id:'R-X3',rr:1.50,sep:.06},{id:'R-RR175',rr:1.75,sep:.06},
  {id:'R-X4',rr:1.75,sep:.08},{id:'R-LIVE',rr:2,sep:.08}
 ],
 GROK92:[
  {id:'G-X1',rb:50,vol:1.00,rr:.55},{id:'G-X2',rb:50,vol:1.10,rr:.55},
  {id:'G-WR',rb:50,vol:1.10,rr:.60},{id:'G-X3',rb:51,vol:1.10,rr:.60},
  {id:'G-X4',rb:52,vol:1.15,rr:.60},{id:'G-MID',rb:52,vol:1.20,rr:.60}
 ],
 PRO:[
  {id:'P-X1',sl:12,entry:36,exit:55,adx:18},{id:'P-WR1',sl:12,entry:37,exit:55,adx:18},
  {id:'P-X2',sl:12,entry:38,exit:55,adx:18},{id:'P-X3',sl:12,entry:37,exit:56,adx:18},
  {id:'P-X4',sl:12,entry:37,exit:55,adx:19},{id:'P-ACT16',sl:12,entry:37,exit:55,adx:16}
 ],
 RANGE:[
  {id:'N-X1',adx:18,rsi:44,minRR:.45},{id:'N-X2',adx:18,rsi:46,minRR:.45},
  {id:'N-RR55',adx:18,rsi:46,minRR:.55},{id:'N-X3',adx:20,rsi:46,minRR:.45},
  {id:'N-X4',adx:20,rsi:44,minRR:.55},{id:'N-LIVE',adx:18,rsi:46,minRR:.65}
 ],
 SWEEP5:[
  {id:'S-X1',hs:9,he:15,wick:.40,mom:.40,tp:3.0},
  {id:'S-X2',hs:9,he:15,wick:.45,mom:.40,tp:3.0},
  {id:'S-ACT',hs:9,he:15,wick:.45,mom:.40,tp:3.5},
  {id:'S-X3',hs:8,he:15,wick:.45,mom:.40,tp:3.5},
  {id:'S-X4',hs:9,he:14,wick:.50,mom:.40,tp:3.5},
  {id:'S-WR',hs:9,he:12,wick:.45,mom:.40,tp:3.5}
 ]
};`;
const cfgRx=/const cfg=\{[\s\S]*?\n\};\nconst led=/;
if(!cfgRx.test(src))throw new Error('Could not locate candidate config block in base engine');
src=src.replace(cfgRx,cfg+'\nconst led=');
const old=`tested++;if(s.net>0&&s.pf>1)rows.push({ids,s,d,b:z.blocked.length})}rows.sort((a,b)=>b.d.winPct-a.d.winPct||b.s.wr-a.s.wr||b.s.w-a.s.w||b.d.avg-a.d.avg||b.d.d5-a.d.d5||a.s.ls-b.s.ls||a.s.dd-b.s.dd||b.s.net-a.s.net);console.log(\`\\n🧠 Tested \${tested} six-strategy combinations | qualified \${rows.length}\`);console.log('\\n🏆 TOP 20 — WINNING DAYS FIRST');`;
const neu=`tested++;if(s.net>0&&s.pf>1&&d.avg>=4.3)rows.push({ids,s,d,b:z.blocked.length})}rows.sort((a,b)=>b.s.wr-a.s.wr||b.d.winPct-a.d.winPct||b.s.w-a.s.w||Math.abs(a.d.avg-4.8)-Math.abs(b.d.avg-4.8)||a.s.ls-b.s.ls||a.s.dd-b.s.dd||b.s.net-a.s.net);console.log(\`\\n🧠 Tested \${tested} six-strategy combinations | activity-qualified \${rows.length}\`);console.log('\\n🏆 TOP 20 — WR FIRST | Avg >= 4.3/day');`;
if(!src.includes(old))throw new Error('Could not locate ranking block in base engine');
src=src.replace(old,neu);
src=src.replace("🚀 FINAL SIX TELEGRAM COMBO — ALL STRATEGIES INCLUDED","🧠 EXPANDED SIX — 70% WR HUNT | ALL SIX INCLUDED");
src=src.replace("⚠️ One-month discovery only. No live strategy changed.","🔒 EXPANDED RESEARCH ONLY. No live strategy changed. Validate winners OOS before any live change.");
fs.writeFileSync(tmp,src);
console.log('🧠 EXPANDED SIX-STRATEGY 70% WR OPTIMIZER');
console.log(`📅 ${FROM} → ${TO}`);
console.log('🎯 6 candidates × 6 strategies = 46,656 all-six portfolio combinations');
console.log('🔒 MAX OPEN 2 | Avg >= 4.3/day | PF>1 | Net>0 | WR ranked FIRST');
console.log('ℹ️ Every tested portfolio contains EXHAUST + RAPID + GROK92 + PRO + RANGE + SWEEP5.');
const r=spawnSync(process.execPath,[tmp,FROM,TO],{stdio:'inherit',env:process.env});
try{fs.unlinkSync(tmp)}catch{}
process.exit(r.status===null?1:r.status);
