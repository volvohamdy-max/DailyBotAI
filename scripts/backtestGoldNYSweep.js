const { getGoldHistoricalCandles } = require('./backtestHistoryDukascopyLocal');

const HISTORY = Math.max(30000, Math.min(141000, Number(process.env.BACKTEST_HISTORY || 100000)));
const COST_R = Number(process.env.COST_R || 0.03);
const TP_R = Number(process.env.TP_R || 1.25);
const MAX_TRADES_PER_DAY = Number(process.env.MAX_TRADES_PER_DAY || 2);
const BUFFER_ATR = Number(process.env.BUFFER_ATR || 0.10);

function atrSeries(c, p=14){
  const out=Array(c.length).fill(null),tr=Array(c.length).fill(null);
  for(let i=1;i<c.length;i++) tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));
  for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=tr[j];out[i]=s/p;}
  return out;
}
function stats(t){if(!t.length)return{trades:0,wr:0,netR:0,avgR:0,pf:0,dd:0,ls:0};let w=0,gp=0,gl=0,e=0,pk=0,dd=0,ls=0,ml=0;for(const x of t){e+=x.r;if(x.r>0){w++;gp+=x.r;ls=0}else{gl-=x.r;ls++;ml=Math.max(ml,ls)}pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{trades:t.length,wr:100*w/t.length,netR:e,avgR:e/t.length,pf:gl?gp/gl:999,dd,ls:ml};}
const fmt=s=>`${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.netR>=0?'+':''}${s.netR.toFixed(2)}R | Avg ${s.avgR.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;
function nyParts(ts){const d=new Date(ts);const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return{date:`${m.year}-${m.month}-${m.day}`,minute:+m.hour*60+(+m.minute)};}
function utcDateKey(ts){return new Date(ts).toISOString().slice(0,10)}
function buildLevels(c){
  const map=new Map();
  for(let i=0;i<c.length;i++){
    const ny=nyParts(c[i].time); if(!map.has(ny.date)) map.set(ny.date,{asiaH:-Infinity,asiaL:Infinity,londonH:-Infinity,londonL:Infinity,prevH:null,prevL:null});
  }
  const days=[...map.keys()].sort();
  for(let di=0;di<days.length;di++){
    const key=days[di],o=map.get(key); let dayH=-Infinity,dayL=Infinity;
    for(const b of c){const ny=nyParts(b.time); if(ny.date!==key)continue; const m=ny.minute; dayH=Math.max(dayH,b.high);dayL=Math.min(dayL,b.low); if(m>=0&&m<420){o.asiaH=Math.max(o.asiaH,b.high);o.asiaL=Math.min(o.asiaL,b.low);} if(m>=420&&m<500){o.londonH=Math.max(o.londonH,b.high);o.londonL=Math.min(o.londonL,b.low);} }
    if(di>0){const pk=days[di-1];let ph=-Infinity,pl=Infinity;for(const b of c){const ny=nyParts(b.time);if(ny.date===pk){ph=Math.max(ph,b.high);pl=Math.min(pl,b.low)}} if(Number.isFinite(ph)){o.prevH=ph;o.prevL=pl;}}
  }
  return map;
}
function run(c,start,end,tpR){
  const A=atrSeries(c),levels=buildLevels(c),out=[];let p=null,currentDay='',count=0;
  for(let i=Math.max(start,20);i<Math.min(end,c.length-1);i++){
    const ny=nyParts(c[i].time); if(ny.date!==currentDay){currentDay=ny.date;count=0;}
    if(p){const b=c[i],sl=p.side==='BUY'?b.low<=p.sl:b.high>=p.sl,tp=p.side==='BUY'?b.high>=p.tp:b.low<=p.tp;if(sl||tp){out.push({...p,exitTime:b.time,r:(sl?-1:tpR)-COST_R});p=null;} continue;}
    if(count>=MAX_TRADES_PER_DAY)continue;
    if(ny.minute<500||ny.minute>660)continue; // 08:20 -> 11:00 NY
    if(!Number.isFinite(A[i]))continue;
    const L=levels.get(ny.date); if(!L)continue;
    const levelsHigh=[L.asiaH,L.londonH,L.prevH].filter(Number.isFinite),levelsLow=[L.asiaL,L.londonL,L.prevL].filter(Number.isFinite);
    const b=c[i],next=c[i+1]; if(!next)continue;
    let side=null,ref=null;
    for(const lv of levelsLow){if(b.low<lv && b.close>lv && b.close>b.open){side='BUY';ref=lv;break;}}
    if(!side)for(const lv of levelsHigh){if(b.high>lv && b.close<lv && b.close<b.open){side='SELL';ref=lv;break;}}
    if(!side)continue;
    const body=Math.abs(b.close-b.open),range=b.high-b.low;if(!range||body/range<0.35)continue;
    const entry=next.open;
    let rawRisk=side==='BUY'?entry-(Math.min(b.low,ref)-A[i]*BUFFER_ATR):(Math.max(b.high,ref)+A[i]*BUFFER_ATR)-entry;
    if(!(rawRisk>0))continue;
    const minRisk=A[i]*0.25,maxRisk=A[i]*1.25;if(rawRisk<minRisk||rawRisk>maxRisk)continue;
    p={side,time:next.time,entry,risk:rawRisk,sl:side==='BUY'?entry-rawRisk:entry+rawRisk,tp:side==='BUY'?entry+rawRisk*tpR:entry-rawRisk*tpR,ref}; count++;
  }
  return out;
}
(async()=>{
  console.log('⚡ GOLD NY LIQUIDITY SWEEP — M5');
  console.log(`08:20-11:00 New York | Asia/London/PrevDay sweep + rejection | TP ${TP_R}R | ATR buffer ${BUFFER_ATR}`);
  const c=(await getGoldHistoricalCandles('5min',HISTORY)).map(x=>({...x,time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close}));
  console.log(`✅ Dukascopy local history: 5min ${c.length} candles`);
  const s=500,u=c.length-s,de=s+Math.floor(u*.6),ve=s+Math.floor(u*.8);
  for(const rr of [1,1.25]){
    const D=run(c,s,de,rr),V=run(c,de,ve,rr),O=run(c,ve,c.length,rr),F=run(c,s,c.length,rr);
    console.log(`\n━━━━━━━━━━ TP ${rr}R ━━━━━━━━━━`);
    console.log('\n📊 DEV\n'+fmt(stats(D))+'\n\n📊 VAL\n'+fmt(stats(V))+'\n\n🧪 OOS — UNTOUCHED 20%\n'+fmt(stats(O)));
    console.log('\n📈 OOS BUY\n'+fmt(stats(O.filter(x=>x.side==='BUY')))+'\n\n📉 OOS SELL\n'+fmt(stats(O.filter(x=>x.side==='SELL'))));
    console.log('\n📅 YEARLY — FULL HISTORY'); const y={};for(const t of F)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);for(const[k,v]of Object.entries(y))console.log(`${k} | ${fmt(stats(v))}`);
  }
})().catch(e=>{console.error(e);process.exit(1)});
