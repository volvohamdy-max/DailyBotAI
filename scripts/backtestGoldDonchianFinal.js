// Final validation for selected robust candidate: DON_ENTRY=30, ADX_MIN=20.
// BUY + SELL. No further parameter optimization.
const { spawnSync } = require('child_process');

const baseEnv = { ...process.env, DON_ENTRY:'30', ADX_MIN:'20' };
console.log('🧪 GOLD DONCHIAN TREND — FINAL VALIDATION');
console.log('FIXED candidate: H1 | BUY+SELL | DON30 | ADX>=20 | EMA200 | SL 2ATR | TP 2R | DON10 exit');
console.log('No further optimization.');

// First print the canonical full-history DEV/VAL/OOS + yearly result.
const full = spawnSync(process.execPath,['scripts/backtestGoldDonchianTrendDukascopy.js'],{cwd:process.cwd(),env:baseEnv,encoding:'utf8',maxBuffer:10*1024*1024});
if(full.status!==0){console.error(full.stderr||full.stdout);process.exit(full.status||1)}
console.log('\n━━━━━━━━━━ CANONICAL DEV / VAL / OOS ━━━━━━━━━━');
console.log(full.stdout.trim());

// A compact independent implementation is used below so we can slice by actual trade time.
const { getGoldHistoricalCandles } = require('./backtestHistoryDukascopyLocal');
const HISTORY=Math.max(100000,Math.min(141000,Number(process.env.BACKTEST_HISTORY||100000))), COST=.03, RR=2, DON=30, EXIT=10, ADXMIN=20;
function agg(c,f){let o=[];for(let i=0;i+f<=c.length;i+=f){let z=c.slice(i,i+f);o.push({time:+z[0].time,open:+z[0].open,high:Math.max(...z.map(x=>+x.high)),low:Math.min(...z.map(x=>+x.low)),close:+z.at(-1).close})}return o}
function ema(v,p){let o=Array(v.length).fill(null),e=v[0],k=2/(p+1);for(let i=0;i<v.length;i++){if(i)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e}return o}
function atr(c,p=14){let o=Array(c.length).fill(null),tr=Array(c.length).fill(null);for(let i=1;i<c.length;i++)tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=tr[j];o[i]=s/p}return o}
function adx(c,p=14){let o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0),dx=Array(c.length).fill(null);for(let i=1;i<c.length;i++){let u=c[i].high-c[i-1].high,d=c[i-1].low-c[i].low;pd[i]=u>d&&u>0?u:0;md[i]=d>u&&d>0?d:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))}for(let i=p;i<c.length;i++){let T=0,P=0,M=0;for(let j=i-p+1;j<=i;j++){T+=tr[j];P+=pd[j];M+=md[j]}if(T){P=100*P/T;M=100*M/T;if(P+M)dx[i]=100*Math.abs(P-M)/(P+M)}}for(let i=2*p-1;i<c.length;i++){let s=0,n=0;for(let j=i-p+1;j<=i;j++)if(Number.isFinite(dx[j])){s+=dx[j];n++}if(n===p)o[i]=s/p}return o}
function hi(c,i,n){let v=-Infinity;for(let j=i-n;j<i;j++)v=Math.max(v,c[j].high);return v}function lo(c,i,n){let v=Infinity;for(let j=i-n;j<i;j++)v=Math.min(v,c[j].low);return v}
function trades(c){let C=c.map(x=>x.close),E=ema(C,200),A=atr(c),D=adx(c),out=[],p=null;for(let i=220;i<c.length-1;i++){if(p){let b=c[i],sl=p.side==='BUY'?b.low<=p.sl:b.high>=p.sl,tp=p.side==='BUY'?b.high>=p.tp:b.low<=p.tp,ex=p.side==='BUY'?b.low<=lo(c,i,EXIT):b.high>=hi(c,i,EXIT);if(sl||tp||ex){let r=sl?-1-COST:tp?RR-COST:((p.side==='BUY'?b.close-p.entry:p.entry-b.close)/p.risk)-COST;out.push({...p,exitTime:b.time,r});p=null}continue}if(![E[i],A[i],D[i]].every(Number.isFinite)||D[i]<ADXMIN)continue;let side=c[i].close>hi(c,i,DON)&&c[i].close>E[i]?'BUY':c[i].close<lo(c,i,DON)&&c[i].close<E[i]?'SELL':null;if(!side)continue;let en=c[i+1].open,risk=A[i]*2;p={side,time:c[i+1].time,entry:en,risk,sl:side==='BUY'?en-risk:en+risk,tp:side==='BUY'?en+RR*risk:en-RR*risk}}return out}
function st(t){let n=t.length,w=0,gp=0,gl=0,e=0,pk=0,dd=0,ls=0,ml=0;for(let x of t){e+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;ml=Math.max(ml,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{n,wr:n?100*w/n:0,net:e,avg:n?e/n:0,pf:gl?gp/gl:(gp?999:0),dd,ls:ml}}
const fmt=s=>`${s.n} trades | WR ${s.wr.toFixed(1)}% | Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | Avg ${s.avg.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;
(async()=>{let m5=(await getGoldHistoricalCandles('5min',HISTORY)).map(x=>({...x,time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close})),h1=agg(m5,12),T=trades(h1).sort((a,b)=>a.time-b.time);let end=Math.max(...h1.map(x=>x.time)),start=end-365*86400000,last=T.filter(x=>x.time>=start&&x.time<=end);console.log('\n━━━━━━━━━━ LAST 12 MONTHS ━━━━━━━━━━');console.log(new Date(start).toISOString().slice(0,10)+' → '+new Date(end).toISOString().slice(0,10));console.log('\n📊 ALL\n'+fmt(st(last)));console.log('\n📈 BUY\n'+fmt(st(last.filter(x=>x.side==='BUY'))));console.log('\n📉 SELL\n'+fmt(st(last.filter(x=>x.side==='SELL'))));console.log('\n📅 MONTHLY');let mo={};for(let x of last)(mo[new Date(x.time).toISOString().slice(0,7)]??=[]).push(x);for(let[k,v]of Object.entries(mo))console.log(`${k} | ${fmt(st(v))}`);
console.log('\n━━━━━━━━━━ WALK-FORWARD — FIXED RULES ━━━━━━━━━━');let first=h1[220].time,span=end-first,fold=span/4,passes=0;for(let i=0;i<4;i++){let a=first+i*fold,b=i===3?end+1:first+(i+1)*fold,z=T.filter(x=>x.time>=a&&x.time<b),s=st(z),pass=s.net>0&&s.pf>1;passes+=pass;console.log(`WF${i+1} ${new Date(a).toISOString().slice(0,10)} → ${new Date(b-1).toISOString().slice(0,10)} | ${fmt(s)} | ${pass?'✅':'❌'}`)}console.log(`\nWalk-forward positive folds: ${passes}/4`);console.log(passes>=3?'✅ FINAL STATUS: candidate remains viable for portfolio testing':'❌ FINAL STATUS: not stable enough for portfolio inclusion');})().catch(e=>{console.error(e);process.exit(1)});
