'use strict';

/**
 * Gold Rapid Scalp V5 — WR research optimizer.
 * RESEARCH ONLY. Does not modify live strategy.
 *
 * Uses the same core R3 setup, then searches stricter quality filters
 * with a bias toward higher WR while retaining useful trade count/PF/NetR.
 *
 * Usage:
 *   node scripts/optimize-gold-rapid-scalp-wr.js 2025-08-30 2026-08-29
 */

const { getHistoricalRates } = require('dukascopy-node');
const FROM = process.argv[2] || '2025-08-30';
const TO = process.argv[3] || '2026-08-29';
const DAY=86400000;
const warm = new Date(new Date(FROM+'T00:00:00Z').getTime()-90*DAY);
const from = new Date(FROM+'T00:00:00Z'), to = new Date(TO+'T23:59:59Z');

const n=x=>Number(x);
function ema(v,p){const o=Array(v.length).fill(null),k=2/(p+1);let e=v[0];for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atr(c,p=14){const o=Array(c.length).fill(null);let s=0;for(let i=1;i<c.length;i++){const tr=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));s+=tr;if(i>p){const j=i-p,old=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));s-=old}if(i>=p)o[i]=s/p}return o}
function h1FromM5(c){const m=new Map;for(const b of c){const t=Math.floor(b.timestamp/3600000)*3600000;let x=m.get(t);if(!x){x={timestamp:t,open:b.open,high:b.high,low:b.low,close:b.close};m.set(t,x)}else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close}}return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp)}
function hIndex(h,t){let lo=0,hi=h.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(h[m].timestamp<=t){ans=m;lo=m+1}else hi=m-1}return ans}
function resolve(c,i,side,entry,sl,tp,maxBars=8){for(let j=i+1;j<c.length&&j<=i+maxBars;j++){const b=c[j],hitSL=side==='BUY'?b.low<=sl:b.high>=sl,hitTP=side==='BUY'?b.high>=tp:b.low<=tp;if(hitSL&&hitTP)return {r:-1,exit:j};if(hitSL)return {r:-1,exit:j};if(hitTP)return {r:(Math.abs(tp-entry)/Math.abs(entry-sl)),exit:j}}return null}
function stats(t){let w=0,l=0,net=0,g=0,loss=0,eq=0,peak=0,dd=0,ls=0,maxLs=0;for(const x of t){net+=x.r;if(x.r>0){w++;g+=x.r;ls=0}else{l++;loss+=-x.r;ls++;maxLs=Math.max(maxLs,ls)}peak=Math.max(peak,net);dd=Math.max(dd,peak-net)}return {trades:t.length,w,l,wr:t.length?100*w/t.length:0,pf:loss?g/loss:999,net,dd,ls:maxLs}}

async function fetchM5(){const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:warm,to},timeframe:'m5',format:'json',priceType:'bid',volumes:true,batchSize:1,pauseBetweenBatchesMs:1200,useCache:true,cacheFolderPath:'./data/dukascopy-cache',retryCount:1,retryOnEmpty:false});return (raw||[]).map(x=>({timestamp:n(x.timestamp),open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close),volume:n(x.volume)||0})).filter(x=>Number.isFinite(x.timestamp)).sort((a,b)=>a.timestamp-b.timestamp)}

function run(c,h,p){const C=c.map(x=>x.close),E20=ema(C,20),A=atr(c),HC=h.map(x=>x.close),H20=ema(HC,20),H50=ema(HC,50),HA=atr(h),out=[];for(let i=60;i<c.length-9;i++){const b=c[i];if(b.timestamp<from.getTime()||b.timestamp>to.getTime())continue;const hour=new Date(b.timestamp).getUTCHours();if(!p.hours.includes(hour))continue;const hi1=hIndex(h,b.timestamp);if(hi1<52)continue;const hv=[E20[i],A[i],H20[hi1],H50[hi1],HA[hi1],H20[hi1-2]];if(!hv.every(Number.isFinite)||!(A[i]>0&&HA[hi1]>0))continue;const sep=Math.abs(H20[hi1]-H50[hi1])/HA[hi1];if(sep<p.sep)continue;const bullish=HC[hi1]>H20[hi1]&&H20[hi1]>H50[hi1]&&H20[hi1]>H20[hi1-2],bearish=HC[hi1]<H20[hi1]&&H20[hi1]<H50[hi1]&&H20[hi1]<H20[hi1-2];if(!bullish&&!bearish)continue;let hi=-Infinity,lo=Infinity;for(let j=i-3;j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low)}const rg=b.high-b.low,body=Math.abs(b.close-b.open);if(!(rg>0)||body/A[i]<p.body||rg/A[i]>p.rangeMax)continue;const pos=(b.close-b.low)/rg;if(Math.abs(b.close-E20[i])/A[i]>p.emaDist)continue;const buy=bullish&&b.close>hi+p.breakAtr*A[i]&&pos>=p.closePos&&b.close>E20[i],sell=bearish&&b.close<lo-p.breakAtr*A[i]&&pos<=1-p.closePos&&b.close<E20[i];if(!buy&&!sell)continue;const side=buy?'BUY':'SELL',entry=b.close,swing=side==='BUY'?Math.min(b.low,c[i-1].low):Math.max(b.high,c[i-1].high),risk=Math.max(A[i]*p.slAtr,Math.abs(entry-swing));if(risk>A[i]*p.riskCap)continue;const sl=side==='BUY'?entry-risk:entry+risk,tp=side==='BUY'?entry+risk*p.rr:entry-risk*p.rr,z=resolve(c,i,side,entry,sl,tp,8);if(z)out.push({time:b.timestamp,side,r:z.r});}return out}

(async()=>{console.log(`🚀 RAPID SCALP WR OPTIMIZER | ${FROM} → ${TO}`);console.log('🔒 Research only — LIVE strategy untouched');const c=await fetchM5(),h=h1FromM5(c);console.log(`✅ Data M5 ${c.length} | H1 ${h.length}`);
const spaces={sep:[.08,.10,.12,.15,.18],body:[.5,.6,.7,.8],closePos:[.72,.76,.80,.84],breakAtr:[.05,.08,.12,.16],emaDist:[.8,1.0,1.25,1.5],rangeMax:[1.6,2.0,2.4],slAtr:[.65],riskCap:[1.0,1.15,1.35],rr:[1.0,1.2,1.5],hours:[[11,12,13,14,15,17],[11,12,13,14,15],[12,13,14,15,17],[12,13,14,15],[11,12,13,14],[13,14,15,17]]};
let all=[],tested=0;for(const sep of spaces.sep)for(const body of spaces.body)for(const closePos of spaces.closePos)for(const breakAtr of spaces.breakAtr)for(const emaDist of spaces.emaDist)for(const rangeMax of spaces.rangeMax)for(const riskCap of spaces.riskCap)for(const rr of spaces.rr)for(const hours of spaces.hours){const p={sep,body,closePos,breakAtr,emaDist,rangeMax,slAtr:.65,riskCap,rr,hours},s=stats(run(c,h,p));tested++;if(s.trades>=80&&s.pf>=1.2&&s.net>0)all.push({p,s});}
all.sort((a,b)=>{const aw=a.s.wr+(Math.min(a.s.trades,180)/180)*3+Math.min(a.s.pf,2)*2, bw=b.s.wr+(Math.min(b.s.trades,180)/180)*3+Math.min(b.s.pf,2)*2;return bw-aw});console.log(`🧪 Tested ${tested.toLocaleString()} combinations | qualified ${all.length}`);console.log('\n🏆 TOP 20 — WR biased, min 80 trades / PF 1.20');for(const [k,x] of all.slice(0,20).entries()){const s=x.s,p=x.p;console.log(`${String(k+1).padStart(2)} | T${s.trades} WR${s.wr.toFixed(1)}% PF${s.pf.toFixed(2)} Net${s.net>=0?'+':''}${s.net.toFixed(2)}R DD${s.dd.toFixed(2)} LS${s.ls} | sep${p.sep} body${p.body} pos${p.closePos} br${p.breakAtr} ema${p.emaDist} rng${p.rangeMax} cap${p.riskCap} RR${p.rr} H[${p.hours}]`)}
const sixty=all.filter(x=>x.s.wr>=60);console.log(`\n🎯 WR >= 60% qualified: ${sixty.length}`);if(sixty[0])console.log('🥇 BEST >=60:',JSON.stringify(sixty[0],null,2));else if(all[0])console.log('🥇 BEST AVAILABLE:',JSON.stringify(all[0],null,2));})().catch(e=>{console.error(e);process.exit(1)});
