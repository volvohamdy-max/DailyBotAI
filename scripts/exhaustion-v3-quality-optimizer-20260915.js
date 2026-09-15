'use strict';
/* EXHAUSTION V3 QUALITY OPTIMIZER — 2026-09-15
   Fresh optimizer around CURRENT live Exhaustion entry logic.
   Goal: fewer/higher-quality trades, not maximum in-sample profit.
   DEV = first 75% chronological data; HOLD = final 25% untouched for ranking.
   Candidates vary quality gates (ADX, ATR ratio, body, hour exclusions) while preserving
   the core burst/wick/retrace logic and current SL/TP/maxBars.
*/
const fs=require('fs');
const PATH='data/xauusd-m5-dukascopy.json';
if(!fs.existsSync(PATH)){console.error('❌ Missing '+PATH);process.exit(1)}
const raw=JSON.parse(fs.readFileSync(PATH,'utf8'));
const M=raw.map(x=>({t:+(x.timestamp??x.time),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
const hour=t=>new Date(t).getUTCHours();
function atr(c,p=14){const a=Array(c.length).fill(NaN),q=[];let s=0;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(tr);s+=tr;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}
function adx(c,p=14){const o=Array(c.length).fill(NaN),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const up=c[i].h-c[i-1].h,dn=c[i-1].l-c[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c))}let tn=0,pn=0,mn=0;for(let i=1;i<=p&&i<c.length;i++){tn+=tr[i];pn+=pd[i];mn+=md[i]}const dx=Array(c.length).fill(NaN);for(let i=p;i<c.length;i++){if(i>p){tn=tn-tn/p+tr[i];pn=pn-pn/p+pd[i];mn=mn-mn/p+md[i]}if(tn>0){const a=100*pn/tn,b=100*mn/tn;if(a+b>0)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0,last=NaN;for(let i=p;i<c.length;i++){if(!Number.isFinite(dx[i]))continue;if(n<p){seed+=dx[i];n++;if(n===p)last=o[i]=seed/p}else last=o[i]=(last*(p-1)+dx[i])/p}return o}
const A=atr(M),X=adx(M);
function atrAvg(i,n=50){if(i<n)return NaN;let s=0,c=0;for(let j=i-n;j<i;j++)if(Number.isFinite(A[j])){s+=A[j];c++}return c===n?s/n:NaN}
function stats(a){let gp=0,gl=0,net=0,peak=0,dd=0,w=0;for(const x of a){net+=x.r;if(x.r>0){gp+=x.r;w++}else if(x.r<0)gl+=-x.r;peak=Math.max(peak,net);dd=Math.max(dd,peak-net)}return{n:a.length,wr:a.length?100*w/a.length:0,pf:gl?gp/gl:(gp?Infinity:0),net,dd}}
function fmt(s){return`T${s.n} WR${s.wr.toFixed(1)} PF${s.pf===Infinity?'∞':s.pf.toFixed(2)} N${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)}`}
function run(cfg){const out=[];let pos=null;for(let i=60;i<M.length-1;i++){
 if(pos){const b=M[i],sl=pos.side==='BUY'?b.l<=pos.sl:b.h>=pos.sl,tp=pos.side==='BUY'?b.h>=pos.tp:b.l<=pos.tp;if(sl||tp||i-pos.ei+1>=3){const px=sl?pos.sl:tp?pos.tp:b.c,r=(pos.side==='BUY'?px-pos.entry:pos.entry-px)/pos.risk;out.push({r,t:M[pos.si].t,side:pos.side});pos=null}if(pos)continue}
 const ex=i-1,confirm=i;if(!Number.isFinite(A[ex]))continue;const start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)continue;const side=disp<0?'BUY':'SELL',burst=side==='BUY'?2.2:2.6;if(Math.abs(disp)<A[ex]*burst)continue;let agree=0;for(let k=ex-3;k<ex;k++){if(disp>0&&M[k].c>M[k].o)agree++;if(disp<0&&M[k].c<M[k].o)agree++}if(agree<2)continue;const b=M[ex],rg=b.h-b.l;if(!(rg>0))continue;const uw=(b.h-Math.max(b.o,b.c))/rg,lw=(Math.min(b.o,b.c)-b.l)/rg;if(side==='BUY'&&lw<.30)continue;if(side==='SELL'&&uw<.30)continue;if(side==='BUY'){if(M[confirm].c<=b.l+rg*.15||M[confirm].l<b.l-A[ex]*.25)continue}else if(M[confirm].c>=b.h-rg*.15||M[confirm].h>b.h+A[ex]*.25)continue;
 const hr=hour(M[i].t);if(cfg.block.includes(hr))continue;const aa=atrAvg(ex),ar=aa?A[ex]/aa:NaN;if(cfg.atrMax&&(!Number.isFinite(ar)||ar>cfg.atrMax))continue;if(cfg.atrMin&&(!Number.isFinite(ar)||ar<cfg.atrMin))continue;if(cfg.adxMax&&(!Number.isFinite(X[ex])||X[ex]>cfg.adxMax))continue;if(cfg.adxMin&&(!Number.isFinite(X[ex])||X[ex]<cfg.adxMin))continue;const body=Math.abs(b.c-b.o)/rg;if(cfg.bodyMax&&body>cfg.bodyMax)continue;
 const entry=M[i+1].o,risk=Math.max(A[ex]*1.75,2),reward=Math.max(A[ex]*1.5,2);pos={side,entry,risk,sl:side==='BUY'?entry-risk:entry+risk,tp:side==='BUY'?entry+reward:entry-reward,ei:i+1,si:i};
 }return out}
const split=M[Math.floor(M.length*.75)].t;
const configs=[];let id=0;
const blocks=[[],[5],[5,8],[5,8,9],[5,1],[5,16]];
for(const block of blocks)for(const atrMax of [0,1.6,1.4,1.25,1.1])for(const adxMax of [0,35,30,25,20])for(const bodyMax of [0,.85,.70,.55])configs.push({id:++id,block,atrMax,atrMin:0,adxMax,adxMin:0,bodyMax});
console.log('EXHAUSTION V3 — QUALITY OPTIMIZER');console.log('75% DEV / 25% HOLDOUT | core entry + SL/TP unchanged');console.log('Candidates:',configs.length,' Split:',new Date(split).toISOString());
const base=run({block:[],atrMax:0,atrMin:0,adxMax:0,adxMin:0,bodyMax:0});const bd=stats(base.filter(x=>x.t<split)),bh=stats(base.filter(x=>x.t>=split));console.log('\nBASE DEV ',fmt(bd));console.log('BASE HOLD',fmt(bh));
const rows=[];for(const c of configs){const a=run(c),d=stats(a.filter(x=>x.t<split)),h=stats(a.filter(x=>x.t>=split));if(d.n<120||h.n<30)continue;const retention=d.n/Math.max(1,bd.n);if(retention<.60)continue;const score=(d.pf-bd.pf)*2+(d.wr-bd.wr)/20+(bd.dd-d.dd)/5;rows.push({c,d,h,score})}
rows.sort((a,b)=>b.score-a.score);
console.log('\n🏆 TOP 20 — RANKED ON DEV ONLY (HOLD shown, never ranked)');for(const x of rows.slice(0,20)){const c=x.c;console.log(`#${c.id} block[${c.block.join(',')||'-'}] ATR<=${c.atrMax||'-'} ADX<=${c.adxMax||'-'} BODY<=${c.bodyMax||'-'} | DEV ${fmt(x.d)} | HOLD ${fmt(x.h)}`)}
console.log('\n🛡️ ROBUST SHORTLIST');const robust=rows.filter(x=>x.h.n>=30&&x.h.pf>=bh.pf&&x.h.wr>=bh.wr&&x.h.dd<=bh.dd*1.10&&x.d.pf>bd.pf&&x.d.wr>=bd.wr).slice(0,15);if(!robust.length)console.log('No candidate passed strict DEV + HOLD robustness. Keep live unchanged.');else for(const x of robust){const c=x.c;console.log(`#${c.id} block[${c.block.join(',')||'-'}] ATR<=${c.atrMax||'-'} ADX<=${c.adxMax||'-'} BODY<=${c.bodyMax||'-'} | DEV ${fmt(x.d)} | HOLD ${fmt(x.h)}`)}
