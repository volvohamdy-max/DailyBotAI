const { getGoldHistoricalCandles } = require('./backtestHistoryDukascopyLocal');
const H = Math.max(10000, Math.min(100000, Number(process.env.BACKTEST_HISTORY || 100000)));
const COST = Number(process.env.COST_PRICE || 0.45);
const RR = 1.5;
function agg(c,m){const o=[];for(let i=0;i<c.length;i+=m){const z=c.slice(i,i+m);if(z.length<m)break;o.push({time:z[0].time,open:z[0].open,high:Math.max(...z.map(x=>x.high)),low:Math.min(...z.map(x=>x.low)),close:z[z.length-1].close,volume:z.reduce((s,x)=>s+(x.volume||0),0)});}return o;}
function ema(a,p){if(a.length<p)return null;let e=a.slice(0,p).reduce((x,y)=>x+y,0)/p,k=2/(p+1);for(let i=p;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function atr(a,p=14){if(a.length<p+1)return null;const z=a.slice(-(p+1));let s=0;for(let i=1;i<z.length;i++)s+=Math.max(z[i].high-z[i].low,Math.abs(z[i].high-z[i-1].close),Math.abs(z[i].low-z[i-1].close));return s/p;}
function rsi(a,p=14){if(a.length<p+1)return null;let g=0,l=0;for(let i=a.length-p;i<a.length;i++){const d=a[i]-a[i-1];if(d>=0)g+=d;else l-=d;}return l===0?100:100-100/(1+g/l);}
function adx(a,p=14){if(a.length<p*2+1)return null;const z=a.slice(-(p*2+1)),tr=[],pd=[],md=[];for(let i=1;i<z.length;i++){const u=z[i].high-z[i-1].high,d=z[i-1].low-z[i].low;pd.push(u>d&&u>0?u:0);md.push(d>u&&d>0?d:0);tr.push(Math.max(z[i].high-z[i].low,Math.abs(z[i].high-z[i-1].close),Math.abs(z[i].low-z[i-1].close)));}const dx=[];for(let e=p;e<=tr.length;e++){const s=e-p,T=tr.slice(s,e).reduce((x,y)=>x+y,0);if(!T)continue;const P=100*pd.slice(s,e).reduce((x,y)=>x+y,0)/T,M=100*md.slice(s,e).reduce((x,y)=>x+y,0)/T;if(P+M)dx.push(100*Math.abs(P-M)/(P+M));}const q=dx.slice(-p);return q.length?q.reduce((x,y)=>x+y,0)/q.length:null;}
function trend(a){const c=a.map(x=>x.close),e20=ema(c,20),e50=ema(c,50);return e20==null||e50==null?null:e20>e50?'BUY':e20<e50?'SELL':null;}
function vwap(a){const z=a.slice(-24);let pv=0,v=0;for(const c of z){const q=c.volume||0;if(q>0){pv+=(c.high+c.low+c.close)/3*q;v+=q;}}return v?pv/v:null;}
function signal(c,i){
 const c5=c.slice(Math.max(0,i-100),i+1),c15=agg(c.slice(0,i+1),3).slice(-60),c1=agg(c.slice(0,i+1),12).slice(-60);
 if(c5.length<55||c15.length<55||c1.length<55)return null;
 const t15=trend(c15),t1=trend(c1),a15=adx(c15);if(!t15||t15!==t1||!(a15>=23))return null;
 const side=t15,C=c5.map(x=>x.close),A=atr(c5),R=rsi(C),e9=ema(C,9),e20=ema(C,20),V=vwap(c5),entry=c[i+1]&&c[i+1].open;
 if(!entry||![A,e9,e20,V].every(Number.isFinite)||!(A>0))return null;
 if(!(side==='BUY'?e9>e20:e9<e20))return null;
 if(!(side==='BUY'?entry>=V-A*0.08:entry<=V+A*0.08))return null;
 const anchor=Math.min(Math.abs(entry-e20),Math.abs(entry-V))/A;if(anchor>0.55)return null;
 const rec=c5.slice(-3),tol=A*0.20,touch=rec.some(x=>x.low<=e20+tol&&x.high>=e20-tol)||rec.some(x=>x.low<=V+tol&&x.high>=V-tol);if(!touch)return null;
 const last=c5[c5.length-1],range=last.high-last.low,body=Math.abs(last.close-last.open);if(range/A>1.2||body/A>0.8)return null;
 const confirm=side==='BUY'?(last.close>last.open&&(last.close>=e20||last.close>=V)):(last.close<last.open&&(last.close<=e20||last.close<=V));if(!confirm)return null;
 if(body/Math.max(range,0.00001)<0.30)return null;
 const z=c5.slice(-3),imp=z.reduce((s,x)=>s+x.close-x.open,0),str=Math.abs(z.reduce((s,x)=>s+(x.close>x.open?1:x.close<x.open?-1:0),0));if((imp>0?'BUY':imp<0?'SELL':null)!==side||str<2)return null;
 if(!(R!=null&&(side==='BUY'?(R>=44&&R<=70):(R>=30&&R<=56))))return null;
 const move=(entry-last.open)/A,trigger=side==='BUY'?(move>=0.02&&entry>=e20):(move<=-0.02&&entry<=e20);if(!trigger||Math.abs(move)>0.35)return null;
 const vals=c5.slice(-12).map(x=>side==='BUY'?x.low:x.high),sw=side==='BUY'?Math.min(...vals):Math.max(...vals),risk=Math.max(side==='BUY'?entry-sw:sw-entry,A*0.55);
 return {side,entry,risk,sl:side==='BUY'?entry-risk:entry+risk,tp:side==='BUY'?entry+RR*risk:entry-RR*risk,time:c[i+1].time};
}
function run(c,A,B){const out=[];let p=null;for(let i=Math.max(A,800);i<Math.min(B,c.length-1);i++){if(p){const hs=p.side==='BUY'?c[i].low<=p.sl:c[i].high>=p.sl,ht=p.side==='BUY'?c[i].high>=p.tp:c[i].low<=p.tp;if(hs||ht){out.push({...p,r:(hs?-1:RR)-COST/p.risk});p=null;}continue;}p=signal(c,i);}return out;}
function stats(t){if(!t.length)return{trades:0,wr:0,netR:0,avgR:0,pf:0,dd:0,ls:0};let w=0,gw=0,gl=0,e=0,pk=0,dd=0,ls=0,ml=0;for(const x of t){e+=x.r;if(x.r>0){w++;gw+=x.r;ls=0;}else{gl-=x.r;ls++;ml=Math.max(ml,ls);}pk=Math.max(pk,e);dd=Math.max(dd,pk-e);}return{trades:t.length,wr:100*w/t.length,netR:e,avgR:e/t.length,pf:gl?gw/gl:999,dd,ls:ml};}
const f=s=>`${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.netR>=0?'+':''}${s.netR.toFixed(2)}R | Avg ${s.avgR.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;
(async()=>{console.log('⚡ GOLD REGIME — LIVE RULES DUKASCOPY BACKTEST');console.log('XAUUSD M5 | H1+M15 regime | ADX15>=23 | M5 EMA/VWAP pullback + momentum/RSI/live trigger | TP 1.5R');const c=(await getGoldHistoricalCandles('5min',H)).map(x=>({...x,time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})),s=800,u=c.length-s,de=s+Math.floor(u*0.6),ve=s+Math.floor(u*0.8),D=run(c,s,de),V=run(c,de,ve),O=run(c,ve,c.length),F=run(c,s,c.length);console.log('\n📊 DEV\n'+f(stats(D))+'\n\n📊 VAL\n'+f(stats(V))+'\n\n🧪 OOS — UNTOUCHED 20%\n'+f(stats(O))+'\n\n📈 OOS BUY\n'+f(stats(O.filter(x=>x.side==='BUY')))+'\n\n📉 OOS SELL\n'+f(stats(O.filter(x=>x.side==='SELL'))));console.log('\n📅 YEARLY — FULL HISTORY');const y={};for(const t of F){const k=new Date(t.time).getUTCFullYear();(y[k]??=[]).push(t);}for(const [k,v] of Object.entries(y))console.log(`${k} | ${f(stats(v))}`);})().catch(e=>{console.error(e);process.exit(1);});
