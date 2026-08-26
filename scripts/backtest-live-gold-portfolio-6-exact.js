#!/usr/bin/env node
'use strict';
const {getHistoricalRates}=require('dukascopy-node');
const {CONFIG:RC,emaSeries,rsiSeries,atrSeries,adxSeries}=require('../src/services/scalpStrategies/goldRangeMrStrategy');
const FROM=process.argv[2]||'2025-08-25',TO=process.argv[3]||'2026-08-25',CACHE='./data/dukascopy-cache',MAX=2;
function tf(a,min){const ms=min*60000,m=new Map();for(const x of a){const t=Math.floor(x.timestamp/ms)*ms;if(!m.has(t))m.set(t,{timestamp:t,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume||0});else{const b=m.get(t);b.high=Math.max(b.high,x.high);b.low=Math.min(b.low,x.low);b.close=x.close;b.volume+=x.volume||0}}return[...m.values()].sort((a,b)=>a.timestamp-b.timestamp)}
function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}function rsi(v,p=14){const o=Array(v.length).fill(null);let ag,al;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let G=0,L=0;for(let j=1;j<=p;j++){const q=v[j]-v[j-1];G+=Math.max(q,0);L+=Math.max(-q,0)}ag=G/p;al=L/p}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al)}return o}function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc))}o[i]=s/p}return o}function prev(a,t){let l=0,h=a.length;while(l<h){const m=(l+h)>>1;if(a[m].timestamp<t)l=m+1;else h=m}return l-1}function day(ts){return new Date(ts).toISOString().slice(0,10)}
function stats(t){let net=0,pk=0,dd=0,gp=0,gl=0,w=0,ls=0,ml=0;for(const x of [...t].sort((a,b)=>a.exitTime-b.exitTime)){net+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ml=Math.max(ml,++ls)}pk=Math.max(pk,net);dd=Math.max(dd,pk-net)}return{n:t.length,wr:t.length?100*w/t.length:0,net,pf:gl?gp/gl:(gp?999:0),dd,ls:ml}}const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function exhaustion(c){
  const CFG={
    hoursUTC:[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
    buy:{burstBars:3,burstATR:2.2,wick:.30,retrace:.20,tpATR:1,slATR:1,maxBars:3},
    sell:{burstBars:3,burstATR:2.6,wick:.40,retrace:.15,tpATR:1,slATR:.75,maxBars:3}
  };

  const A=atr(c,14),out=[];
  let busy=-1;

  for(let i=40;i<c.length-5;i++){
    if(i<=busy || !Number.isFinite(A[i]) || !(A[i]>0)) continue;

    const hour=new Date(c[i].timestamp).getUTCHours();
    if(CFG.hoursUTC.indexOf(hour)===-1) continue;

    const start=c[i-3].close;
    const end=c[i-1].close;
    const disp=end-start;

    if(!Number.isFinite(disp) || disp===0) continue;

    const burstSide=disp>0?'UP':'DOWN';
    const side=burstSide==='DOWN'?'BUY':'SELL';
    const q=side==='BUY'?CFG.buy:CFG.sell;

    if(Math.abs(disp)<A[i]*q.burstATR) continue;

    let agreeing=0;
    for(let k=i-3;k<i;k++){
      if(burstSide==='UP' && c[k].close>c[k].open) agreeing++;
      if(burstSide==='DOWN' && c[k].close<c[k].open) agreeing++;
    }
    if(agreeing<2) continue;

    const ex=c[i];
    const range=ex.high-ex.low;
    if(!(range>0)) continue;

    const upper=(ex.high-Math.max(ex.open,ex.close))/range;
    const lower=(Math.min(ex.open,ex.close)-ex.low)/range;

    if(side==='BUY' && lower<q.wick) continue;
    if(side==='SELL' && upper<q.wick) continue;

    const confirm=c[i+1];

    if(side==='BUY'){
      const trigger=ex.low+range*q.retrace;
      if(confirm.close<=trigger) continue;
      if(confirm.low<ex.low+A[i]*-.25) continue;
    }else{
      const trigger=ex.high-range*q.retrace;
      if(confirm.close>=trigger) continue;
      if(confirm.high>ex.high+A[i]*.25) continue;
    }

    // Exact backtest entry corresponding to live next-open execution.
    const en=c[i+2].open;

    // Same anti-chase rule used by live strategy.
    if(Math.abs(en-confirm.close)>A[i]*.30) continue;

    const risk=A[i]*q.slATR;
    const reward=A[i]*q.tpATR;

    const sl=side==='BUY'?en-risk:en+risk;
    const tp=side==='BUY'?en+reward:en-reward;

    let done=false;

    for(let j=i+2;j<=Math.min(c.length-1,i+1+q.maxBars);j++){
      const loss=side==='BUY'?c[j].low<=sl:c[j].high>=sl;
      const win=side==='BUY'?c[j].high>=tp:c[j].low<=tp;

      // Conservative same-bar handling: SL wins.
      if(loss||win){
        out.push({
          strategy:'EXHAUST',
          time:c[i+2].timestamp,
          exitTime:c[j].timestamp,
          r:loss?-1:reward/risk,
          side
        });
        busy=j;
        done=true;
        break;
      }
    }

    if(!done){
      const j=Math.min(c.length-1,i+1+q.maxBars);
      const mark=side==='BUY'
        ?(c[j].close-en)/risk
        :(en-c[j].close)/risk;

      out.push({
        strategy:'EXHAUST',
        time:c[i+2].timestamp,
        exitTime:c[j].timestamp,
        r:Math.max(-1,Math.min(reward/risk,mark)),
        side
      });

      busy=j;
    }
  }

  return out;
}

function rapid(c,h1){const P={rr:2,breakAtr:.05,bodyMin:.5,closePos:.72,h1Sep:.08,rangeMax:2.2,emaDistMax:1.5,slAtr:.65,riskCap:1.35,maxBars:8},C=c.map(x=>x.close),E=ema(C,20),A=atr(c),HC=h1.map(x=>x.close),H20=ema(HC,20),H50=ema(HC,50),HA=atr(h1),out=[];let busy=-1;for(let i=60;i<c.length-2;i++){if(i<=busy||!A[i])continue;const hr=new Date(c[i].timestamp).getUTCHours();if([11,12,13,14,15,17].indexOf(hr)===-1)continue;const h=prev(h1,c[i].timestamp);if(h<55||!HA[h]||Math.abs(H20[h]-H50[h])/HA[h]<P.h1Sep)continue;const hb=HC[h]>H20[h]&&H20[h]>H50[h]&&H20[h]>H20[h-2]?'BUY':HC[h]<H20[h]&&H20[h]<H50[h]&&H20[h]<H20[h-2]?'SELL':null;if(!hb)continue;let hi=-Infinity,lo=Infinity;for(let j=i-3;j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low)}const rg=c[i].high-c[i].low,bd=Math.abs(c[i].close-c[i].open);if(!rg||bd/A[i]<P.bodyMin||rg/A[i]>P.rangeMax)continue;const pos=(c[i].close-c[i].low)/rg;if(Math.abs(c[i].close-E[i])/A[i]>P.emaDistMax)continue;const buy=hb==='BUY'&&c[i].close>hi+P.breakAtr*A[i]&&pos>=P.closePos&&c[i].close>E[i],sell=hb==='SELL'&&c[i].close<lo-P.breakAtr*A[i]&&pos<=1-P.closePos&&c[i].close<E[i];if(!buy&&!sell)continue;const side=buy?'BUY':'SELL',en=c[i+1].open;if(Math.abs(en-c[i].close)>A[i]*.3)continue;const sw=side==='BUY'?Math.min(c[i].low,c[i-1].low):Math.max(c[i].high,c[i-1].high),risk=Math.max(A[i]*P.slAtr,Math.abs(en-sw));if(risk>A[i]*P.riskCap)continue;const sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+risk*2:en-risk*2;let done=false;for(let j=i+1;j<=Math.min(c.length-1,i+8);j++){const loss=side==='BUY'?c[j].low<=sl:c[j].high>=sl,win=side==='BUY'?c[j].high>=tp:c[j].low<=tp;if(loss||win){out.push({strategy:'RAPID',time:c[i+1].timestamp,exitTime:c[j].timestamp,r:loss?-1:2,side});busy=j;done=true;break}}if(!done){const j=Math.min(c.length-1,i+8),z=(side==='BUY'?c[j].close-en:en-c[j].close)/risk;out.push({strategy:'RAPID',time:c[i+1].timestamp,exitTime:c[j].timestamp,r:Math.max(-1,Math.min(2,z)),side});busy=j}}return out}
function grok(m5,h1){const out=[],C=m5.map(x=>x.close),e9=ema(C,9),e21=ema(C,21),R=rsi(C),A=atr(m5),H=h1.map(x=>x.close),e200=ema(H,200),HA=atr(h1);const HD=adxSeries(h1,14);let busy=-1;for(let i=60;i<m5.length-1;i++){if(i<=busy)continue;const side=e9[i-1]<=e21[i-1]&&e9[i]>e21[i]&&R[i]>52?'BUY':e9[i-1]>=e21[i-1]&&e9[i]<e21[i]&&R[i]<48?'SELL':null;if(!side||!A[i]||Math.abs(e9[i]-e21[i])/A[i]<.04)continue;const vv=m5.slice(i-20,i).map(x=>x.volume||0),va=vv.reduce((a,b)=>a+b,0)/20;if(!(va>0&&(m5[i].volume||0)>=va*1.25))continue;const h=prev(h1,m5[i].timestamp);if(h<200||!HA[h]||HD[h]<20)continue;const bias=H[h]>e200[h]?'BUY':'SELL';if(side!==bias||Math.abs(H[h]-e200[h])/HA[h]<.10)continue;const en=m5[i+1].open,risk=A[i]*2,sl=side==='BUY'?en-risk:en+risk,tp=side==='BUY'?en+risk*.8:en-risk*.8;for(let j=i+1;j<m5.length;j++){const loss=side==='BUY'?m5[j].low<=sl:m5[j].high>=sl,win=side==='BUY'?m5[j].high>=tp:m5[j].low<=tp;if(loss||win){out.push({strategy:'GROK92',time:m5[i+1].timestamp,exitTime:m5[j].timestamp,r:loss?-1:.8,side});busy=j;break}}}return out}
function pro(m5,h1){const out=[],R=rsi(m5.map(x=>x.close)),D=adxSeries(m5,14),A=atr(m5),days=tf(h1,1440),DE=ema(days.map(x=>x.close),50);let last=-1,cool=0,ld='',losses=0;for(let i=80;i<m5.length-2;i++){if(i<=last)continue;const now=m5[i+1].timestamp,d=new Date(now),dk=day(now);if(ld!==dk){ld=dk;losses=0}if(losses>=2||now<cool)continue;const hr=d.getUTCHours();if([1,2,3,4,5,15,16,21,22,23].includes(hr))continue;if(d.getUTCDay()===3){const mn=hr*60+d.getUTCMinutes();if(mn>=1020&&mn<=1230)continue}const di=prev(days,m5[i].timestamp);if(di<50||!Number.isFinite(DE[di]))continue;const bias=days[di].close>DE[di]?'BUY':'SELL';if(!(D[i]>=15)||!Number.isFinite(A[i]))continue;const pa=A.slice(Math.max(0,i-50),i).filter(Number.isFinite);if(pa.length<50||A[i]/(pa.reduce((a,b)=>a+b,0)/pa.length)>1.15)continue;let side=null;if(R[i-1]>=37&&R[i]<37&&bias==='BUY')side='BUY';if(R[i-1]<=63&&R[i]>63&&bias==='SELL')side='SELL';if(!side)continue;const rg=m5[i].high-m5[i].low;if(!(rg>0)||Math.abs(m5[i].close-m5[i].open)/rg<.5)continue;const en=m5[i+1].open,sl=side==='BUY'?en-10:en+10;let z=null;for(let j=i+1;j<m5.length&&j<=i+4320;j++){const b=m5[j];if((side==='BUY'&&b.low<=sl)||(side==='SELL'&&b.high>=sl)){z={r:-1,j,won:false};break}if((side==='BUY'&&Number.isFinite(R[j])&&R[j]>=63)||(side==='SELL'&&Number.isFinite(R[j])&&R[j]<=37)){z={r:side==='BUY'?(b.close-en)/10:(en-b.close)/10,j,won:side==='BUY'?b.close>=en:b.close<=en};break}const q=new Date(b.timestamp);if(q.getUTCDay()===5&&(q.getUTCHours()>21||(q.getUTCHours()===21&&q.getUTCMinutes()>=45))){z={r:side==='BUY'?(b.close-en)/10:(en-b.close)/10,j,won:side==='BUY'?b.close>=en:b.close<=en};break}}if(!z)continue;out.push({strategy:'PRO',time:m5[i+1].timestamp,exitTime:m5[z.j].timestamp,r:z.r,side});last=z.j;i=z.j;if(!z.won){losses++;cool=m5[z.j].timestamp+180*60000}}return out}
function range(m5){const out=[],C=m5.map(x=>x.close),E=emaSeries(C,20),R=rsiSeries(C,14),A=atrSeries(m5,14),D=adxSeries(m5,14);let busy=-1;for(let i=100;i<m5.length-2;i++){if(i<=busy||![E[i],E[i-6],R[i],A[i],D[i]].every(Number.isFinite)||!(A[i]>0)||D[i]>RC.adxMax)continue;const sm=A.slice(i-50,i).filter(Number.isFinite);if(sm.length<45)continue;const av=sm.reduce((a,b)=>a+b,0)/sm.length,ratio=A[i]/av;if(ratio<RC.atrLo||ratio>RC.atrHi||Math.abs(E[i]-E[i-6])/A[i]>RC.emaSlopeMax)continue;const look=m5.slice(i-30,i),hi=Math.max(...look.map(x=>x.high)),lo=Math.min(...look.map(x=>x.low)),width=hi-lo;if(width<A[i]*RC.widthMin||width>A[i]*RC.widthMax)continue;const edge=Math.max(A[i]*RC.edgeAtr,width*RC.edgeWidth);let lt=0,ht=0;for(const b of look){if(b.low<=lo+edge)lt++;if(b.high>=hi-edge)ht++}if(lt<2||ht<2||look.slice(-6).some(b=>b.close<lo-A[i]*.10||b.close>hi+A[i]*.10))continue;const c=m5[i],br=Math.max(1e-9,c.high-c.low),body=Math.abs(c.close-c.open)/br,lw=(Math.min(c.open,c.close)-c.low)/br,uw=(c.high-Math.max(c.open,c.close))/br,mid=(hi+lo)/2;let side=null;if(c.low<=lo+edge&&c.close>=lo+edge*.75&&lw>=RC.wickMin&&body<=RC.bodyMax&&R[i]<=RC.rsiEdge)side='BUY';if(c.high>=hi-edge&&c.close<=hi-edge*.75&&uw>=RC.wickMin&&body<=RC.bodyMax&&R[i]>=100-RC.rsiEdge)side='SELL';if(!side||(side==='BUY'&&(c.close<=lo||c.close>=mid))||(side==='SELL'&&(c.close>=hi||c.close<=mid)))continue;const en=m5[i+1].open,ss=side==='BUY'?Math.max(A[i]*RC.slMinAtr,en-(lo-A[i]*RC.stopPadAtr)):Math.max(A[i]*RC.slMinAtr,(hi+A[i]*RC.stopPadAtr)-en),sd=Math.min(ss,A[i]*RC.slCapAtr),md=side==='BUY'?mid-en:en-mid,td=Math.min(md,sd*RC.maxRR),rr=td/sd;if(!(sd>0&&rr>=RC.minRR&&rr<=RC.maxRR))continue;const sl=side==='BUY'?en-sd:en+sd,tp=side==='BUY'?en+td:en-td;for(let j=i+1;j<m5.length;j++){const b=m5[j],loss=side==='BUY'?b.low<=sl:b.high>=sl,win=side==='BUY'?b.high>=tp:b.low<=tp;if(loss||win||j-i>=RC.maxBars){const mark=loss?-1:win?rr:Math.max(-1,Math.min(rr,side==='BUY'?(b.close-en)/sd:(en-b.close)/sd));out.push({strategy:'RANGE',time:m5[i+1].timestamp,exitTime:b.timestamp,r:mark,side});busy=j;break}}}return out}
function sweep(c){const A=atr(c),out=[];for(let i=30;i<c.length-5;i++){const a=A[i],b=c[i];if(!(a>0))continue;const h=new Date(b.timestamp).getUTCHours();if(h<9||h>=13)continue;let ph=-Infinity;for(let k=i-6;k<i;k++)ph=Math.max(ph,c[k].high);const rg=b.high-b.low;if(!(rg>0))continue;const uw=(b.high-Math.max(b.open,b.close))/rg,pm=Math.abs(c[i-1].close-c[i-3].close);if(b.high<ph+a*.04||!(b.close<ph)||!(b.close<b.open)||uw<.60||pm<a*.5)continue;const en=c[i+1].open,tp=en-5,sl=en+5;let r=null,jx=i+4;for(let j=i+1;j<=i+4;j++){const loss=c[j].high>=sl,win=c[j].low<=tp;if(loss||win){r=loss?-1:1;jx=j;break}}if(r===null)r=Math.max(-1,Math.min(1,(en-c[i+4].close)/5));out.push({strategy:'SWEEP5',time:c[i+1].timestamp,exitTime:c[jx].timestamp,r,side:'SELL'});i+=Math.max(0,jx-i-1)}return out}
(async()=>{console.log('🔥 EXACT LIVE GOLD PORTFOLIO — MAX OPEN 2');console.log(`📅 ${FROM} → ${TO}`);console.log('📥 Loading one shared Dukascopy M5 dataset...');const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:300,useCache:true,cacheFolderPath:CACHE});const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp),h1=tf(m5,60);console.log(`✅ M5 ${m5.length} | H1 ${h1.length}`);const sets=[exhaustion(m5),rapid(m5,h1),grok(m5,h1),pro(m5,h1),range(m5),sweep(m5)];const all=sets.flat().sort((a,b)=>a.time-b.time||a.strategy.localeCompare(b.strategy));console.log('\n📊 RAW COMPONENT LEDGERS');for(const z of sets)console.log(`${z[0]?.strategy||'EMPTY'} | ${fmt(stats(z))}`);const accepted=[],rejected=[];for(const t of all){const open=accepted.filter(x=>x.time<=t.time&&x.exitTime>=t.time);if(open.length>=MAX)rejected.push(t);else accepted.push(t)}console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log('🏆 PORTFOLIO MAX OPEN = 2');console.log(fmt(stats(accepted)));console.log(`Raw signals: ${all.length} | Accepted: ${accepted.length} | Blocked by MAX2: ${rejected.length}`);console.log('\n📦 ACCEPTED BY STRATEGY');for(const name of ['EXHAUST','RAPID','GROK92','PRO','RANGE','SWEEP5']){const z=accepted.filter(x=>x.strategy===name),b=rejected.filter(x=>x.strategy===name);console.log(`${name.padEnd(7)} ${fmt(stats(z))} | MAX2 blocked ${b.length}`)}console.log('\n📅 YEARLY PORTFOLIO');for(const y of [2025,2026])console.log(`${y} | ${fmt(stats(accepted.filter(x=>new Date(x.time).getUTCFullYear()===y)))}`);console.log('\n🔒 Research only. Live strategies/VIP routing untouched.');})().catch(e=>{console.error(e);process.exit(1)});
