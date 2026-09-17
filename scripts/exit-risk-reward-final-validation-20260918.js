'use strict';
/*
 FRESH LIVE PORTFOLIO BACKTEST — 2026-09-15
 Written from scratch from CURRENT live strategy files. No old backtest imported.
 Historical execution model: signal on closed M5 bar -> entry next M5 open.
 Fixed-target strategies: conservative same-bar SL before TP; maxBars exits at close.
 Pro: fixed $12 SL, RSI exit on M5 close, Friday 21:45 UTC close, 180m cooldown after loss, max 2 losses/day.
 H1 is causally aggregated from M5 and only COMPLETED H1 bars are used. D1 Pro bias uses only completed UTC days.
 One open trade PER STRATEGY, matching live open-trade guard.
*/
const fs=require('fs');
const PATH='data/xauusd-m5-dukascopy.json';
if(!fs.existsSync(PATH)){console.error('❌ Missing '+PATH);process.exit(1)}
const raw=JSON.parse(fs.readFileSync(PATH,'utf8'));
const M=raw.map(x=>({t:+(x.timestamp??x.time),o:+(x.open??x.o),h:+(x.high??x.h),l:+(x.low??x.l),c:+(x.close??x.c),v:+(x.volume??x.v??0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
if(M.length<1000){console.error('❌ Not enough M5 data');process.exit(1)}
const day=t=>new Date(t).toISOString().slice(0,10), month=t=>day(t).slice(0,7), hour=t=>new Date(t).getUTCHours();
function ema(v,p){const a=Array(v.length).fill(NaN),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)a[i]=e}return a}
function rsi(v,p=14){const a=Array(v.length).fill(NaN);let ag=0,al=0;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i<=p){ag+=g;al+=l;if(i===p){ag/=p;al/=p;a[i]=al===0?100:100-100/(1+ag/al)}}else{ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;a[i]=al===0?100:100-100/(1+ag/al)}}return a}
function atr(c,p=14){const a=Array(c.length).fill(NaN),q=[];let s=0;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));q.push(tr);s+=tr;if(q.length>p)s-=q.shift();if(q.length===p)a[i]=s/p}return a}
function adx(c,p=14){const o=Array(c.length).fill(NaN),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const up=c[i].h-c[i-1].h,dn=c[i-1].l-c[i].l;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c))}let tn=0,pn=0,mn=0;for(let i=1;i<=p&&i<c.length;i++){tn+=tr[i];pn+=pd[i];mn+=md[i]}const dx=Array(c.length).fill(NaN);for(let i=p;i<c.length;i++){if(i>p){tn=tn-tn/p+tr[i];pn=pn-pn/p+pd[i];mn=mn-mn/p+md[i]}if(tn>0){const a=100*pn/tn,b=100*mn/tn;if(a+b>0)dx[i]=100*Math.abs(a-b)/(a+b)}}let seed=0,n=0,last=NaN;for(let i=p;i<c.length;i++){if(!Number.isFinite(dx[i]))continue;if(n<p){seed+=dx[i];n++;if(n===p)last=o[i]=seed/p}else last=o[i]=(last*(p-1)+dx[i])/p}return o}
function aggregate(src,ms){const out=[];let z=null,k0=null;for(const x of src){const k=Math.floor(x.t/ms)*ms;if(k!==k0){if(z)out.push(z);z={t:k,o:x.o,h:x.h,l:x.l,c:x.c,v:x.v};k0=k}else{z.h=Math.max(z.h,x.h);z.l=Math.min(z.l,x.l);z.c=x.c;z.v+=x.v}}if(z)out.push(z);return out}
const H=aggregate(M,3600000), D=aggregate(M,86400000);
const C=M.map(x=>x.c), R=rsi(C), A=atr(M), X=adx(M), E9=ema(C,9),E20=ema(C,20),E21=ema(C,21),E50=ema(C,50);
const HC=H.map(x=>x.c),HE20=ema(HC,20),HE50=ema(HC,50),HE200=ema(HC,200),HA=atr(H),HX=adx(H);
const DC=D.map(x=>x.c),DE50=ema(DC,50);
let hp=0,dp=0;
const hIdx=Array(M.length).fill(-1),dIdx=Array(M.length).fill(-1);
for(let i=0;i<M.length;i++){while(hp+1<H.length&&H[hp+1].t<=M[i].t)hp++;hIdx[i]=Math.max(0,hp-1);while(dp+1<D.length&&D[dp+1].t+86400000<=M[i].t)dp++;dIdx[i]=(D[dp]&&D[dp].t+86400000<=M[i].t)?dp:-1}
const defs={Q15:{name:'Failed Move Q15'},
 EXHAUSTION:{name:'Gold Exhaustion V3'},RAPID:{name:'Gold Rapid Scalp V5'},GROK:{name:'Grok Gold 92'},PRO:{name:'Pro Strategy'},RANGE:{name:'Gold Range MR'},SWEEP:{name:'Gold Sweep 5'},MICRO:{name:'Gold Micro Pullback'}
};
const trades=Object.fromEntries(Object.keys(defs).map(k=>[k,[]])), active=Object.fromEntries(Object.keys(defs).map(k=>[k,null]));
const pro={lossDay:null,losses:0,cool:0};
function open(k,i,side,risk,reward,maxBars,meta={}){if(active[k]||i+1>=M.length||!(risk>0))return;const entry=M[i+1].o,sl=side==='BUY'?entry-risk:entry+risk,tp=reward==null?null:(side==='BUY'?entry+reward:entry-reward);active[k]={k,side,entry,sl,tp,risk,entryI:i+1,signalI:i,maxBars,meta}}
function close(k,i,px,reason){const t=active[k];if(!t)return;const pnl=t.side==='BUY'?px-t.entry:t.entry-px,r=pnl/t.risk;trades[k].push({...t,exitI:i,exit:M[i].t,px,reason,r});active[k]=null;if(k==='PRO'&&r<0){const d=day(M[i].t);if(pro.lossDay!==d){pro.lossDay=d;pro.losses=0}pro.losses++;pro.cool=M[i].t+180*60000}}
function manage(k,i){const t=active[k];if(!t||i<t.entryI)return false;const b=M[i],sl=t.side==='BUY'?b.l<=t.sl:b.h>=t.sl,tp=t.tp!=null&&(t.side==='BUY'?b.h>=t.tp:b.l<=t.tp);if(sl){close(k,i,t.sl,'STOP');return true}if(tp){close(k,i,t.tp,'TP');return true}if(t.maxBars&&i-t.entryI+1>=t.maxBars){close(k,i,b.c,'MAXBARS');return true}return false}
function volAvg(i,p=20){if(i<p)return NaN;let s=0;for(let j=i-p;j<i;j++)s+=M[j].v;return s/p}
function atrAvg(i,n=50){if(i<n)return NaN;let s=0,c=0;for(let j=i-n;j<i;j++)if(Number.isFinite(A[j])){s+=A[j];c++}return c===n?s/n:NaN}
function signalQ15(i){if(i<60||!Number.isFinite(A[i]))return;const aa=atrAvg(i);if(!Number.isFinite(aa))return;const x=M[i-1],b=M[i],rg=x.h-x.l,br=b.h-b.l;if(!(rg>0&&br>0)||x.c>=x.o)return;if(rg/A[i]<1.5||Math.abs(x.c-x.o)/rg<.60)return;if(!(b.c>x.o&&b.h>x.h-.30*A[i]&&b.c>b.o&&(b.c-b.l)/br>=.65))return;const ar=A[i]/aa;if(ar<.75||ar>2||[6,7,8].includes(hour(b.t)))return;open('Q15',i,'BUY',A[i],1.5*A[i],12)}
function signalEx(i){if(i<45||!Number.isFinite(A[i-1])||!Number.isFinite(X[i-1]))return;const ex=i-1,confirm=i;if([1,5,23].includes(hour(M[ex].t))||X[ex]>32)return;const exRange=M[ex].h-M[ex].l;if(!(exRange>0))return;const start=M[ex-3].c,end=M[ex-1].c,disp=end-start;if(!disp)return;const side=disp<0?'BUY':'SELL',q=side==='BUY'?{burst:2.2}:{burst:2.6};const exBody=Math.abs(M[ex].c-M[ex].o)/exRange;if(exBody>(side==='SELL'?.55:.50))return;if(side==='SELL'&&X[ex]>28)return;if(Math.abs(disp)<A[ex]*q.burst)return;let agree=0;for(let k=ex-3;k<ex;k++){if(disp>0&&M[k].c>M[k].o)agree++;if(disp<0&&M[k].c<M[k].o)agree++}if(agree<2)return;const b=M[ex],rg=b.h-b.l;if(!(rg>0))return;const uw=(b.h-Math.max(b.o,b.c))/rg,lw=(Math.min(b.o,b.c)-b.l)/rg;if(side==='BUY'&&lw<.30)return;if(side==='SELL'&&uw<.30)return;if(side==='BUY'){if(M[confirm].c<=b.l+rg*.15||M[confirm].l<b.l-A[ex]*.25)return}else if(M[confirm].c>=b.h-rg*.15||M[confirm].h>b.h+A[ex]*.25)return;const risk=Math.max(A[ex]*1.75,2),reward=Math.max(A[ex]*1.5,2);open('EXHAUSTION',i,side,risk,reward,3)}
function signalRapid(i){const h=hIdx[i];if(i<60||h<52||![E20[i],A[i],HE20[h],HE50[h],HA[h],HE20[h-2]].every(Number.isFinite))return;const hr=hour(M[i].t);if([2,6,12,18,19,20,22].includes(hr))return;const sep=Math.abs(HE20[h]-HE50[h])/HA[h];if(sep<.10)return;const bull=HC[h]>HE20[h]&&HE20[h]>HE50[h]&&HE20[h]>HE20[h-2],bear=HC[h]<HE20[h]&&HE20[h]<HE50[h]&&HE20[h]<HE20[h-2];if(!bull&&!bear)return;let hi=-Infinity,lo=Infinity;for(let j=i-3;j<i;j++){hi=Math.max(hi,M[j].h);lo=Math.min(lo,M[j].l)}const b=M[i],rg=b.h-b.l,body=Math.abs(b.c-b.o);if(!(rg>0)||body/A[i]<.65||rg/A[i]>2||Math.abs(b.c-E20[i])/A[i]>1.1)return;const pos=(b.c-b.l)/rg,buy=bull&&b.c>hi&&pos>=.76&&b.c>E20[i],sell=bear&&b.c<lo&&pos<=.24&&b.c<E20[i];if(!buy&&!sell)return;const side=buy?'BUY':'SELL';if(side==='BUY'&&[3,16,17].includes(hr))return;const entry=M[i+1]?.o;if(!Number.isFinite(entry))return;const swing=side==='BUY'?Math.min(b.l,M[i-1].l):Math.max(b.h,M[i-1].h),risk=Math.max(A[i]*.65,Math.abs(entry-swing));if(risk>A[i]*1.35)return;open('RAPID',i,side,risk,risk*(side==='BUY'?.85:.8),10)}
function signalGrok(i){const h=hIdx[i];if(i<60||h<205||![E9[i],E21[i],E9[i-1],E21[i-1],R[i],A[i],HE200[h],HA[h],HX[h]].every(Number.isFinite))return;const up=E9[i-1]<=E21[i-1]&&E9[i]>E21[i],dn=E9[i-1]>=E21[i-1]&&E9[i]<E21[i];let side=null;if(up&&R[i]>52)side='BUY';if(dn&&R[i]<44)side='SELL';if(!side||Math.abs(E9[i]-E21[i])/A[i]<.04)return;const va=volAvg(i,20);if(!(va>0&&M[i].v>=va*1.25)||HX[h]<22)return;const bias=HC[h]>HE200[h]?'BUY':HC[h]<HE200[h]?'SELL':null;if(side!==bias||Math.abs(HC[h]-HE200[h])/HA[h]<.30)return;const risk=A[i]*1.5;open('GROK',i,side,risk,risk*.8,null)}
function signalPro(i){const d=dIdx[i];if(i<80||d<49||![R[i-1],R[i],X[i],A[i],DE50[d]].every(Number.isFinite))return;const now=M[i].t,dy=day(now);if(pro.lossDay!==dy){pro.lossDay=dy;pro.losses=0}if(pro.losses>=2||now<pro.cool)return;const dt=new Date(now),min=dt.getUTCHours()*60+dt.getUTCMinutes();if(dt.getUTCDay()===3&&min>=1020&&min<=1230)return;const bias=DC[d]>DE50[d]?'BUY':'SELL',aa=atrAvg(i),ratio=A[i]/aa;if(!Number.isFinite(ratio))return;let side=null;if(R[i-1]>=41&&R[i]<41&&bias==='BUY'&&X[i]>=27&&ratio<=1.30)side='BUY';if(R[i-1]<=63&&R[i]>63&&bias==='SELL'&&X[i]>=19&&ratio<=1.15)side='SELL';if(!side)return;if(side==='BUY'&&hour(now)===8)return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.5)return;if(side==='BUY'&&(i<36||b.c-M[i-36].c< -20))return;open('PRO',i,side,12,null,null)}
function signalRange(i){if(i<100||![E20[i],E20[i-6],R[i],A[i],X[i]].every(Number.isFinite))return;let s=0,n=0;for(let j=i-50;j<i;j++)if(Number.isFinite(A[j])){s+=A[j];n++}if(n<45)return;const ratio=A[i]/(s/n),slope=Math.abs(E20[i]-E20[i-6])/A[i],look=M.slice(i-30,i),hi=Math.max(...look.map(x=>x.h)),lo=Math.min(...look.map(x=>x.l)),width=hi-lo,b=M[i],rg=b.h-b.l;if(!(rg>0))return;const body=Math.abs(b.c-b.o)/rg,lw=(Math.min(b.o,b.c)-b.l)/rg;if(X[i]>14||ratio<.55||ratio>1.6||slope>.2||width<A[i]*1.8||width>A[i]*8||body>.75)return;const edge=Math.max(A[i]*.3,width*.1);let lt=0,ht=0;for(const x of look){if(x.l<=lo+edge)lt++;if(x.h>=hi-edge)ht++}if(lt<1||ht<1||!(b.l<=lo+edge&&b.c>=lo+edge*.75&&lw>=.25&&R[i]<=46))return;const entry=M[i+1]?.o;if(!Number.isFinite(entry))return;const structural=entry-(lo-A[i]*.12),risk=Math.min(Math.max(A[i]*.55,structural),A[i]*1.4),md=(hi+lo)/2-entry,reward=Math.min(md,risk*1.5);if(!(risk>0&&reward/risk>=.7))return;open('RANGE',i,'BUY',risk,reward,12)}
function signalSweep(i){if(i<30||![9,10,11,12,17].includes(hour(M[i].t))||!Number.isFinite(A[i]))return;let ph=-Infinity;for(let k=i-6;k<i;k++)ph=Math.max(ph,M[k].h);const b=M[i],rg=b.h-b.l;if(!(rg>0))return;const uw=(b.h-Math.max(b.o,b.c))/rg,pm=Math.abs(M[i-1].c-M[i-3].c);if(b.h<ph+A[i]*.04||!(b.c<ph)||!(b.c<b.o)||uw<.60||pm<A[i]*.50)return;open('SWEEP',i,'SELL',5,5,4)}
function signalMicro(i){if(i<60||[16,17,20,21].includes(hour(M[i].t))||![A[i],E9[i],E21[i],E50[i],E21[i-3]].every(Number.isFinite))return;const b=M[i],rg=b.h-b.l;if(!(rg>0)||Math.abs(b.c-b.o)/rg<.75||Math.abs(E9[i]-E21[i])/A[i]<.15)return;if(!(E9[i]>E21[i]&&E21[i]>E50[i]&&E21[i]>E21[i-3]))return;const is=i-4,ie=i-2,imp=M[ie].c-M[is].o;if(imp<1.4*A[i])return;let pl=Infinity;for(let j=ie+1;j<i;j++)pl=Math.min(pl,M[j].l);const retr=(M[ie].c-pl)/imp;if(retr<.12||retr>.35)return;const pos=(b.c-b.l)/rg;if(pos<.78||b.c<=M[i-1].h)return;open('MICRO',i,'BUY',2*A[i],2*A[i],10)}
for(let i=250;i<M.length-1;i++){
 // exits first: an open trade blocks same strategy until actually closed
 for(const k of Object.keys(defs)){
  if(!active[k])continue;
  if(k==='PRO'){
   const t=active.PRO,b=M[i],sl=t.side==='BUY'?b.l<=t.sl:b.h>=t.sl;if(sl){close('PRO',i,t.sl,'STOP');continue}
   if(t.side==='BUY'&&Number.isFinite(R[i])&&R[i]>=58){close('PRO',i,b.c,'RSI58');continue}
   if(t.side==='SELL'&&Number.isFinite(R[i])&&R[i]<=45){close('PRO',i,b.c,'RSI45');continue}
   const z=new Date(b.t);if(z.getUTCDay()===5&&(z.getUTCHours()*60+z.getUTCMinutes())>=1305){close('PRO',i,b.c,'FRIDAY');continue}
  }else manage(k,i)
 }
 if(!active.Q15)signalQ15(i);if(!active.EXHAUSTION)signalEx(i);if(!active.RAPID)signalRapid(i);if(!active.GROK)signalGrok(i);if(!active.PRO)signalPro(i);if(!active.RANGE)signalRange(i);if(!active.SWEEP)signalSweep(i);if(!active.MICRO)signalMicro(i);
}
for(const k of Object.keys(defs))if(active[k])close(k,M.length-1,M.at(-1).c,'OPEN_END');
function stats(a){const n=a.length,w=a.filter(x=>x.r>0).length,g=a.filter(x=>x.r>0).reduce((s,x)=>s+x.r,0),l=-a.filter(x=>x.r<0).reduce((s,x)=>s+x.r,0),net=a.reduce((s,x)=>s+x.r,0);let eq=0,pk=0,dd=0,ls=0,mx=0;for(const x of a){eq+=x.r;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq);if(x.r<0){ls++;mx=Math.max(mx,ls)}else ls=0}return{n,w,wr:n?100*w/n:0,pf:l?g/l:(g?Infinity:0),net,dd,ls:mx}}
function f(s){return`T${s.n} WR${s.wr.toFixed(1)}% PF${Number.isFinite(s.pf)?s.pf.toFixed(2):'∞'} NET${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)}R LS${s.ls}`}

// RESEARCH ONLY — exits are replayed from the current live entry signals.
// This file never imports or edits live strategy modules.
const BASE_TRADES=Object.fromEntries(Object.entries(trades).map(([k,v])=>[k,v.map(x=>({...x}))]));
const MULT=[.70,.80,.90,1,1.10,1.20,1.30];
const PRO_SL=[8,9,10,11,12,13,14,15,16];
const PRO_BUY_EXIT=[54,56,58,60,62];
const PRO_SELL_EXIT=[41,43,45,47,49];
function replayFixed(base,slMult,tpMult){
 const out=[];
 for(const t of base){
  const entry=t.entry, risk0=Math.abs(entry-t.sl), reward0=t.tp==null?null:Math.abs(t.tp-entry);
  const risk=risk0*slMult, reward=reward0==null?null:reward0*tpMult;
  const sl=t.side==='BUY'?entry-risk:entry+risk, tp=reward==null?null:(t.side==='BUY'?entry+reward:entry-reward);
  let done=null;
  for(let i=t.entryI;i<=Math.min(M.length-1,t.entryI+(t.maxBars||999999)-1);i++){
   const b=M[i],hitSL=t.side==='BUY'?b.l<=sl:b.h>=sl,hitTP=tp!=null&&(t.side==='BUY'?b.h>=tp:b.l<=tp);
   if(hitSL){done={...t,exitI:i,exit:b.t,px:sl,reason:'STOP',r:-1};break}
   if(hitTP){done={...t,exitI:i,exit:b.t,px:tp,reason:'TP',r:reward/risk};break}
   if(t.maxBars&&i-t.entryI+1>=t.maxBars){const pnl=t.side==='BUY'?b.c-entry:entry-b.c;done={...t,exitI:i,exit:b.t,px:b.c,reason:'MAXBARS',r:pnl/risk};break}
  }
  if(!done){const b=M.at(-1),pnl=t.side==='BUY'?b.c-entry:entry-b.c;done={...t,exitI:M.length-1,exit:b.t,px:b.c,reason:'OPEN_END',r:pnl/risk}}
  out.push(done);
 }
 return out;
}
function replayPro(base,slUsd,buyExit,sellExit){
 const out=[];
 for(const t of base){
  const entry=t.entry,sl=t.side==='BUY'?entry-slUsd:entry+slUsd;let done=null;
  for(let i=t.entryI;i<M.length;i++){
   const b=M[i],hit=t.side==='BUY'?b.l<=sl:b.h>=sl;
   if(hit){done={...t,exitI:i,exit:b.t,px:sl,reason:'STOP',r:-1};break}
   if(t.side==='BUY'&&Number.isFinite(R[i])&&R[i]>=buyExit){const pnl=b.c-entry;done={...t,exitI:i,exit:b.t,px:b.c,reason:'RSI_BUY',r:pnl/slUsd};break}
   if(t.side==='SELL'&&Number.isFinite(R[i])&&R[i]<=sellExit){const pnl=entry-b.c;done={...t,exitI:i,exit:b.t,px:b.c,reason:'RSI_SELL',r:pnl/slUsd};break}
   const z=new Date(b.t);if(z.getUTCDay()===5&&(z.getUTCHours()*60+z.getUTCMinutes())>=1305){const pnl=t.side==='BUY'?b.c-entry:entry-b.c;done={...t,exitI:i,exit:b.t,px:b.c,reason:'FRIDAY',r:pnl/slUsd};break}
  }
  if(!done){const b=M.at(-1),pnl=t.side==='BUY'?b.c-entry:entry-b.c;done={...t,exitI:M.length-1,exit:b.t,px:b.c,reason:'OPEN_END',r:pnl/slUsd}}
  out.push(done);
 }
 return out;
}
function rank(rows){return rows.sort((a,b)=>(b.st.wr-a.st.wr)||(b.st.pf-a.st.pf)||(b.st.net-a.st.net))}
console.log('\n━━━━━━━━ EXIT RISK/REWARD LAB — RESEARCH ONLY ━━━━━━━━');
console.log('LIVE FILES UNCHANGED | same historical entries | conservative SL-before-TP');
const desc={
 Q15:'SL 1.00 ATR | TP 1.50 ATR | maxBars 12',
 EXHAUSTION:'SL max(1.75 ATR,$2) | TP max(1.50 ATR,$2) | maxBars 3',
 RAPID:'SL max(0.65 ATR,swing), cap 1.35 ATR | TP BUY 0.85R / SELL 0.80R | maxBars 10',
 GROK:'SL 1.50 ATR | TP 0.80R | no maxBars',
 PRO:'SL $12 | no fixed TP | BUY exit RSI>=58 / SELL exit RSI<=45',
 RANGE:'structural SL bounded 0.55..1.40 ATR | TP=min(mid,1.50R), minRR .70 | maxBars 12',
 SWEEP:'SL $5 | TP $5 | maxBars 4',
 MICRO:'SL 2.00 ATR | TP 1.00R (=2 ATR) | maxBars 10'
};
for(const k of Object.keys(defs))console.log(defs[k].name.padEnd(24)+' | '+desc[k]);
console.log('\nNOTE: grid below changes exits only AFTER the current baseline entries are generated; it does not change live entry filters or live files.');
for(const k of Object.keys(defs)){
 const base=BASE_TRADES[k],bst=stats(base),rows=[];
 if(k==='PRO'){
  for(const sl of PRO_SL)for(const bx of PRO_BUY_EXIT)for(const sx of PRO_SELL_EXIT){const z=replayPro(base,sl,bx,sx);rows.push({label:`SL$${sl} BX${bx} SX${sx}`,st:stats(z)})}
 }else{
  for(const sm of MULT)for(const tm of MULT){const z=replayFixed(base,sm,tm);rows.push({label:`SLx${sm.toFixed(2)} TPx${tm.toFixed(2)}`,st:stats(z)})}
 }
 rank(rows);
 console.log('\n'+defs[k].name+' | BASE '+f(bst));
 console.log('TOP 12 BY WR (PF/NET tie-break):');
 rows.slice(0,12).forEach((x,i)=>console.log(`${String(i+1).padStart(2,' ')} | ${x.label.padEnd(24)} | ${f(x.st)}`));
 const robust=rows.filter(x=>x.st.pf>=Math.max(1.2,bst.pf*.90)&&x.st.net>=bst.net*.80);
 console.log('TOP BALANCED (WR first, PF>=90% base and NET>=80% base):');
 robust.slice(0,8).forEach((x,i)=>console.log(`${String(i+1).padStart(2,' ')} | ${x.label.padEnd(24)} | ${f(x.st)}`));
}

console.log('\n━━━━━━━━ FINAL EXIT VALIDATION — RESEARCH ONLY ━━━━━━━━');
const candidates={
 GROK:{sm:1.20,tm:.90,label:'SLx1.20 TPx0.90'},
 SWEEP:{sm:1.10,tm:.70,label:'SLx1.10 TPx0.70'},
 MICRO:{sm:1.10,tm:1.00,label:'SLx1.10 TPx1.00'},
 EXHAUSTION:{sm:1.00,tm:.70,label:'SLx1.00 TPx0.70'},
 RAPID:{sm:1.00,tm:.90,label:'SLx1.00 TPx0.90'}
};
const vt0=M[0].t,vt1=M[M.length-1].t,vspan=vt1-vt0;
function ps(z,a,b){return stats(z.filter(x=>{const t=M[x.entryI].t;return t>=a&&t<b}))}
function delta(a,b){return `ΔWR ${(b.wr-a.wr)>=0?'+':''}${(b.wr-a.wr).toFixed(1)}pp | ΔPF ${(b.pf-a.pf)>=0?'+':''}${(b.pf-a.pf).toFixed(2)} | ΔNET ${(b.net-a.net)>=0?'+':''}${(b.net-a.net).toFixed(2)}R | ΔDD ${(b.dd-a.dd)>=0?'+':''}${(b.dd-a.dd).toFixed(2)}R`}
for(const [k,c] of Object.entries(candidates)){
 const b=BASE_TRADES[k],z=replayFixed(b,c.sm,c.tm);
 console.log('\n'+defs[k].name+' | '+c.label);
 console.log(' FULL BASE '+f(stats(b))); console.log(' FULL CAND '+f(stats(z))+' | '+delta(stats(b),stats(z)));
 for(const [lab,days] of [['180D',180],['90D',90]]){
  const bs=ps(b,vt1-days*86400000,vt1+1),zs=ps(z,vt1-days*86400000,vt1+1);
  console.log(` ${lab} BASE ${f(bs)} | CAND ${f(zs)} | ${delta(bs,zs)}`);
 }
 let good=0,bad=0;
 for(let q=0;q<4;q++){
  const a=vt0+vspan*q/4,e=q===3?vt1+1:vt0+vspan*(q+1)/4,bs=ps(b,a,e),zs=ps(z,a,e);
  if(zs.pf>=bs.pf&&zs.net>=bs.net*.8)good++; if(zs.pf<bs.pf*.85||zs.net<bs.net*.65)bad++;
  console.log(` F${q+1} BASE ${f(bs)} | CAND ${f(zs)} | ${delta(bs,zs)}`);
 }
 for(const side of ['BUY','SELL']){
  const bb=b.filter(x=>x.side===side),zz=z.filter(x=>x.side===side); if(bb.length)console.log(` ${side} BASE ${f(stats(bb))} | CAND ${f(stats(zz))} | ${delta(stats(bb),stats(zz))}`);
 }
 const fullB=stats(b),fullZ=stats(z);
 const pass=fullZ.wr>fullB.wr&&fullZ.pf>=fullB.pf*.95&&fullZ.net>=fullB.net*.85&&fullZ.dd<=fullB.dd*1.10&&bad<=1;
 console.log(` VERDICT ${pass?'PASS':'HOLD'} | goodFolds ${good}/4 badFolds ${bad}/4`);
}
console.log('\n━━━━━━━━ GROK FINE EXIT SEARCH + TEMPORAL CHECK ━━━━━━━━');
const grokFine=[];
for(let sm=1.10;sm<=1.3001;sm+=.025)for(let tm=.80;tm<=1.0001;tm+=.025){
 const z=replayFixed(BASE_TRADES.GROK,sm,tm),st=stats(z),d180=ps(z,vt1-180*86400000,vt1+1),d90=ps(z,vt1-90*86400000,vt1+1);
 let pos=0,weak=0;for(let q=0;q<4;q++){const fs=ps(z,vt0+vspan*q/4,q===3?vt1+1:vt0+vspan*(q+1)/4);if(fs.net>0&&fs.pf>1)pos++;if(fs.net<=0||fs.pf<1)weak++}
 if(st.pf>=1.45&&st.net>=20&&d180.net>0&&d90.net>0&&pos>=3)grokFine.push({sm:+sm.toFixed(3),tm:+tm.toFixed(3),st,d180,d90,pos,weak});
}
grokFine.sort((a,b)=>(b.st.wr-a.st.wr)||(b.st.pf-a.st.pf)||(b.st.net-a.st.net));
grokFine.slice(0,20).forEach((x,i)=>console.log(`${String(i+1).padStart(2,' ')} | SLx${x.sm.toFixed(3)} TPx${x.tm.toFixed(3)} | FULL ${f(x.st)} | 180D ${f(x.d180)} | 90D ${f(x.d90)} | positiveFolds ${x.pos}/4 weak ${x.weak}/4`));
console.log('\nVALIDATION ONLY — LIVE STRATEGY FILES REMAIN UNCHANGED.');

console.log('\nRESEARCH ONLY — no live strategy parameter was modified.');
