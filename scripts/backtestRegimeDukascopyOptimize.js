const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2024-08-23';
const TO = process.argv[3] || '2026-08-23';

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function tf(rows,min){const ms=min*60000,m=new Map();for(const x of rows){const t=Math.floor(x.timestamp/ms)*ms;if(!m.has(t))m.set(t,{timestamp:t,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume||0});else{const b=m.get(t);b.high=Math.max(b.high,x.high);b.low=Math.min(b.low,x.low);b.close=x.close;b.volume+=(x.volume||0);}}return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp);}
function prevIndex(rows,ts){let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].timestamp<ts)lo=m+1;else hi=m;}return lo-1;}
function emaSeries(v,p){const o=Array(v.length).fill(null),k=2/(p+1);if(!v.length)return o;let e=v[0];for(let i=0;i<v.length;i++){if(i>0)e=v[i]*k+e*(1-k);if(i>=p-1)o[i]=e;}return o;}
function rsiSeries(v,p=14){const o=Array(v.length).fill(null);let ag=null,al=null;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);if(i===p){let gs=0,ls=0;for(let j=1;j<=p;j++){const x=v[j]-v[j-1];gs+=Math.max(x,0);ls+=Math.max(-x,0);}ag=gs/p;al=ls/p;}else if(i>p){ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;}if(i>=p)o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atrSeries(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++){const pc=c[j-1].close;s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-pc),Math.abs(c[j].low-pc));}o[i]=s/p;}return o;}
function adxSeries(c,p=14){const o=Array(c.length).fill(null),tr=Array(c.length).fill(0),pd=Array(c.length).fill(0),md=Array(c.length).fill(0);for(let i=1;i<c.length;i++){const up=c[i].high-c[i-1].high,dn=c[i-1].low-c[i].low;pd[i]=up>dn&&up>0?up:0;md[i]=dn>up&&dn>0?dn:0;tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));}if(c.length<=p*2)return o;let trN=0,pN=0,mN=0;for(let i=1;i<=p;i++){trN+=tr[i];pN+=pd[i];mN+=md[i];}const dx=Array(c.length).fill(null);for(let i=p;i<c.length;i++){if(i>p){trN=trN-trN/p+tr[i];pN=pN-pN/p+pd[i];mN=mN-mN/p+md[i];}if(trN<=0)continue;const pdi=100*pN/trN,mdi=100*mN/trN,den=pdi+mdi;if(den>0)dx[i]=100*Math.abs(pdi-mdi)/den;}let seed=0,count=0;for(let i=p;i<c.length;i++){if(!Number.isFinite(dx[i]))continue;if(count<p){seed+=dx[i];count++;if(count===p)o[i]=seed/p;}else if(Number.isFinite(o[i-1]))o[i]=(o[i-1]*(p-1)+dx[i])/p;}return o;}
function vwapSeries(c,lookback=24){const o=Array(c.length).fill(null);let pv=0,vol=0;const q=[];for(let i=0;i<c.length;i++){const v=Number(c[i].volume)||0,tp=(c[i].high+c[i].low+c[i].close)/3;q.push([tp,v]);pv+=tp*v;vol+=v;if(q.length>lookback){const [otp,ov]=q.shift();pv-=otp*ov;vol-=ov;}o[i]=vol>0?pv/vol:null;}return o;}
function trendSeries(c){const cls=c.map(x=>x.close),e20=emaSeries(cls,20),e50=emaSeries(cls,50);return c.map((_,i)=>e20[i]>e50[i]?'BUY':e20[i]<e50[i]?'SELL':null);}
function scoreRegime({direction,adx15,adx5,anchor,momentum,rsi}){let s=25+10+20;if(adx15>=35)s+=15;else if(adx15>=28)s+=12;else if(adx15>=23)s+=9;if(adx5>=20)s+=5;s+=anchor<=0.35?10:7;s+=10;s+=momentum.strength>=3?8:6;const healthy=direction==='BUY'?(rsi>=46&&rsi<=68):(rsi<=54&&rsi>=32);if(healthy)s+=5;s+=4;return Math.min(100,Math.round(s));}
function simFixed(m5,start,side,entry,sl,tp,maxBars=4320){for(let j=start;j<m5.length&&j<=start+maxBars;j++){const b=m5[j];if(side==='BUY'){if(b.low<=sl)return{r:-1,exit:j};if(b.high>=tp)return{r:(tp-entry)/(entry-sl),exit:j};}else{if(b.high>=sl)return{r:-1,exit:j};if(b.low<=tp)return{r:(entry-tp)/(sl-entry),exit:j};}}return null;}
function stats(name,trades){let net=0,peak=0,dd=0,gp=0,gl=0,w=0,ls=0,maxLs=0;const years={};for(const t of trades){net+=t.r;if(t.r>0){w++;gp+=t.r;ls=0;}else{gl+=Math.abs(t.r);ls++;maxLs=Math.max(maxLs,ls);}peak=Math.max(peak,net);dd=Math.max(dd,peak-net);const y=new Date(t.time).getUTCFullYear();if(!years[y])years[y]={n:0,r:0};years[y].n++;years[y].r+=t.r;}return{name,trades:trades.length,wr:trades.length?w/trades.length*100:0,net,avg:trades.length?net/trades.length:0,pf:gl?gp/gl:Infinity,dd,maxLs,years};}
function robust(s){if(s.trades<25)return -999+s.trades;const pf=Math.min(3,Number.isFinite(s.pf)?s.pf:3);return s.net*1.15+s.avg*30+Math.log10(Math.max(0.1,pf))*15-s.dd*1.1+Math.min(s.trades,200)/100;}
function print(s){console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log(`📊 ${s.name}`);console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');console.log(`Trades: ${s.trades}`);console.log(`WR: ${s.wr.toFixed(1)}%`);console.log(`Net R: ${s.net>=0?'+':''}${s.net.toFixed(2)}R`);console.log(`Avg R: ${s.avg.toFixed(3)}R`);console.log(`PF: ${Number.isFinite(s.pf)?s.pf.toFixed(2):'∞'}`);console.log(`DD: ${s.dd.toFixed(2)}R`);console.log(`Max LS: ${s.maxLs}`);console.log('\n📅 Yearly');for(const [y,v] of Object.entries(s.years))console.log(`${y} | ${v.n} | ${v.r>=0?'+':''}${v.r.toFixed(2)}R`);}

function runRegime(m5,m15,h1,ind,cfg,startIndex,endIndex){const out=[];for(let i=Math.max(100,startIndex);i<Math.min(endIndex,m5.length-2);i++){const eidx=i+1,j15=prevIndex(m15,m5[i].timestamp+1),j1=prevIndex(h1,m5[i].timestamp+1);if(j15<55||j1<55)continue;const t15=ind.t15[j15],t1=ind.t1[j1];if(!t15||t15!==t1||!(ind.adx15[j15]>=cfg.adxMin))continue;const side=t15,atr=ind.a5[i];if(!(atr>0))continue;if(side==='BUY'&&!(ind.e9[i]>ind.e20[i]))continue;if(side==='SELL'&&!(ind.e9[i]<ind.e20[i]))continue;const entryOpen=m5[eidx].open;if(side==='BUY'&&entryOpen<ind.vw[i]-atr*0.08)continue;if(side==='SELL'&&entryOpen>ind.vw[i]+atr*0.08)continue;const anchor=Math.min(Math.abs(entryOpen-ind.e20[i]),Math.abs(entryOpen-ind.vw[i]))/atr;if(anchor>cfg.anchorMax||Math.abs(entryOpen-ind.e20[i])/atr>cfg.anchorMax)continue;const recent=m5.slice(i-2,i+1),tol=atr*0.20;const touched=recent.some(x=>(x.high>=ind.e20[i]-tol&&x.low<=ind.e20[i]+tol)||(x.high>=ind.vw[i]-tol&&x.low<=ind.vw[i]+tol));if(!touched)continue;const b=m5[i],range=Math.max(b.high-b.low,1e-9),body=Math.abs(b.close-b.open),upper=b.high-Math.max(b.open,b.close),lower=Math.min(b.open,b.close)-b.low;if(range/atr>cfg.maxRangeAtr||body/atr>cfg.maxBodyAtr)continue;const dirClose=side==='BUY'?b.close>b.open:b.close<b.open,closeBack=side==='BUY'?(b.close>=ind.e20[i]||b.close>=ind.vw[i]):(b.close<=ind.e20[i]||b.close<=ind.vw[i]),rej=side==='BUY'?(lower>=upper*1.15&&lower>=body*0.35):(upper>=lower*1.15&&upper>=body*0.35),cont=dirClose&&body/range>=cfg.bodyShareMin;if(!(dirClose&&closeBack&&(rej||cont)))continue;let up=0,dn=0;for(let k=i-3;k<=i;k++){if(k<=0)continue;if(m5[k].close>m5[k-1].close)up++;else if(m5[k].close<m5[k-1].close)dn++;}const md=up>=3?'BUY':dn>=3?'SELL':up>dn?'BUY':dn>up?'SELL':'WAIT',strength=Math.max(up,dn);if(md!==side||strength<cfg.momentumMin)continue;const rr=ind.r5[i];if(side==='BUY'&&!(rr>=cfg.rsiBuyMin&&rr<=cfg.rsiBuyMax))continue;if(side==='SELL'&&!(rr<=cfg.rsiSellMax&&rr>=cfg.rsiSellMin))continue;const liveMove=(m5[eidx].close-m5[eidx].open)/atr;if(side==='BUY'&&!(liveMove>=0.02&&m5[eidx].close>=ind.e20[i]))continue;if(side==='SELL'&&!(liveMove<=-0.02&&m5[eidx].close<=ind.e20[i]))continue;if(Math.abs(liveMove)>cfg.maxLiveMove)continue;const sc=scoreRegime({direction:side,adx15:ind.adx15[j15],adx5:ind.adx5[i]||0,anchor,momentum:{strength},rsi:rr});if(sc<cfg.scoreMin)continue;const liveEntry=m5[eidx].close,swingRows=m5.slice(Math.max(0,i-11),i+1),swing=side==='BUY'?Math.min(...swingRows.map(x=>x.low)):Math.max(...swingRows.map(x=>x.high)),base=Math.max(atr*cfg.baseAtr,3),swingRisk=side==='BUY'?liveEntry-swing+Math.max(atr*0.15,0.5):swing-liveEntry+Math.max(atr*0.15,0.5),risk=Math.min(Math.max(base,swingRisk>0?swingRisk:base),Math.max(atr*cfg.capAtr,8.5));const sl=side==='BUY'?liveEntry-risk:liveEntry+risk,tp=side==='BUY'?liveEntry+risk*cfg.tpR:liveEntry-risk*cfg.tpR;const z=simFixed(m5,eidx,side,liveEntry,sl,tp);if(!z)continue;out.push({time:m5[eidx].timestamp,r:z.r,side});i=z.exit;}return out;}

(async()=>{
  console.log('🧭 GOLD REGIME — DUKASCOPY OPTIMIZER');
  console.log(`📅 ${FROM} → ${TO}`);
  console.log('⏳ Loading XAUUSD M5 from Dukascopy...');
  const raw=await getHistoricalRates({instrument:'xauusd',dates:{from:new Date(FROM+'T00:00:00Z'),to:new Date(TO+'T23:59:59Z')},timeframe:'m5',format:'json',volumes:true,batchSize:10,pauseBetweenBatchesMs:500,useCache:true,cacheFolderPath:'./data/dukascopy-cache'});
  const m5=raw.map(x=>({timestamp:+x.timestamp,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume||0})).filter(x=>[x.timestamp,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.timestamp-b.timestamp);
  const m15=tf(m5,15),h1=tf(m5,60);
  console.log(`✅ M5 ${m5.length} | M15 ${m15.length} | H1 ${h1.length}`);

  const cls=m5.map(x=>x.close),ind={e9:emaSeries(cls,9),e20:emaSeries(cls,20),r5:rsiSeries(cls,14),a5:atrSeries(m5,14),adx5:adxSeries(m5,14),vw:vwapSeries(m5,24),adx15:adxSeries(m15,14),t15:trendSeries(m15),t1:trendSeries(h1)};

  const n=m5.length,devEnd=Math.floor(n*0.60),valEnd=Math.floor(n*0.80);
  const configs=[];
  for(const adxMin of [23,26,29])
  for(const anchorMax of [0.35,0.45,0.55])
  for(const momentumMin of [2,3])
  for(const bodyShareMin of [0.30,0.40])
  for(const tpR of [1.2,1.5,1.8])
  for(const scoreMin of [78,82])
    configs.push({adxMin,anchorMax,momentumMin,bodyShareMin,tpR,scoreMin,maxRangeAtr:1.2,maxBodyAtr:0.8,rsiBuyMin:44,rsiBuyMax:70,rsiSellMin:30,rsiSellMax:56,maxLiveMove:0.35,baseAtr:1.2,capAtr:2.2});

  console.log(`🔬 Variants=${configs.length}`);
  const ranked=[];
  for(let k=0;k<configs.length;k++){
    const cfg=configs[k];
    const s=stats('DEV',runRegime(m5,m15,h1,ind,cfg,0,devEnd));
    ranked.push({cfg,dev:s,score:robust(s)});
    if((k+1)%25===0||k===configs.length-1)console.log(`🔍 ${k+1}/${configs.length}`);
  }
  ranked.sort((a,b)=>b.score-a.score);
  const finalists=ranked.slice(0,12).map(x=>{const val=stats('VAL',runRegime(m5,m15,h1,ind,x.cfg,devEnd,valEnd));return {...x,val,combined:x.score+robust(val)*1.35};}).sort((a,b)=>b.combined-a.combined);
  const top=finalists.slice(0,5).map(x=>{const hold=stats('HOLDOUT',runRegime(m5,m15,h1,ind,x.cfg,valEnd,n-2));const full=stats('FULL',runRegime(m5,m15,h1,ind,x.cfg,0,n-2));return {...x,hold,full};});

  console.log('\n🏆 TOP 5 ROBUST CONFIGS');
  console.table(top.map((x,i)=>({Rank:i+1,ADX:x.cfg.adxMin,Anchor:x.cfg.anchorMax,Mom:x.cfg.momentumMin,Body:x.cfg.bodyShareMin,TP:x.cfg.tpR,ScoreMin:x.cfg.scoreMin,DEV_PF:x.dev.pf.toFixed(2),VAL_PF:x.val.pf.toFixed(2),HOLD_PF:x.hold.pf.toFixed(2),FULL_Trades:x.full.trades,FULL_WR:x.full.wr.toFixed(1)+'%',FULL_NetR:x.full.net.toFixed(2),FULL_PF:x.full.pf.toFixed(2),FULL_DD:x.full.dd.toFixed(2)})));
  for(let i=0;i<top.length;i++){console.log(`\n🥇 Candidate ${i+1}: ${JSON.stringify(top[i].cfg)}`);print(top[i].dev);print(top[i].val);print(top[i].hold);print(top[i].full);}
})().catch(e=>{console.error('❌ OPTIMIZER ERROR:',e);process.exit(1);});
