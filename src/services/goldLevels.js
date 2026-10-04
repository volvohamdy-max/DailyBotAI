const { getGoldCandlesResilient } = require('./goldCandleRecovery');
const marketService = require('./marketService');

const FRAMES = [
  { code:'M5', interval:'5min', weight:1 },
  { code:'M15', interval:'15min', weight:1.2 },
  { code:'M30', interval:'30min', weight:1.5 },
  { code:'H1', interval:'1h', weight:2 },
  { code:'H4', interval:'4h', weight:3 },
  { code:'D1', interval:'1day', weight:4 },
  { code:'W1', interval:'1week', weight:5 },
  { code:'MN', interval:'1month', weight:6 }
];

function pivots(candles, frame) {
  const out=[];
  const span = frame === 'M5' || frame === 'M15' ? 2 : 3;
  for(let i=span;i<candles.length-span;i++){
    const c=candles[i];
    let high=true,low=true;
    for(let j=i-span;j<=i+span;j++){
      if(j===i)continue;
      if(Number(candles[j].high)>=Number(c.high))high=false;
      if(Number(candles[j].low)<=Number(c.low))low=false;
    }
    if(high)out.push({price:Number(c.high),kind:'R',frame});
    if(low)out.push({price:Number(c.low),kind:'S',frame});
  }
  return out;
}

function cluster(points, price) {
  const tolerance=Math.max(2.5, price*0.0008);
  const sorted=[...points].filter(x=>Number.isFinite(x.price)).sort((a,b)=>a.price-b.price);
  const groups=[];
  for(const p of sorted){
    let g=groups.find(x=>Math.abs(x.price-p.price)<=tolerance);
    if(!g){g={price:p.price,points:[]};groups.push(g);}
    g.points.push(p);
    g.price=g.points.reduce((s,x)=>s+x.price,0)/g.points.length;
  }
  return groups.map(g=>{
    const frames=[...new Set(g.points.map(x=>x.frame))];
    const touches=g.points.length;
    const tfScore=frames.reduce((s,f)=>s+(FRAMES.find(x=>x.code===f)?.weight||1),0);
    const score=Math.min(100,Math.round(20+touches*6+tfScore*6));
    return {...g,frames,touches,score,type:g.price<price?'SUPPORT':'RESISTANCE',distance:Math.abs(g.price-price)};
  });
}

async function getGoldSupportResistance(){
  const livePrice=Number(await marketService.getPrice('XAUUSD'));
  if(!(livePrice>0))throw new Error('Invalid live gold price');
  const settled=await Promise.allSettled(FRAMES.map(async f=>({f,candles:await getGoldCandlesResilient(f.interval)})));
  const points=[]; const frameSummary=[];
  for(const row of settled){
    if(row.status!=='fulfilled')continue;
    const {f,candles}=row.value;
    const ps=pivots(candles,f.code);
    points.push(...ps);
    const supports=ps.filter(x=>x.price<livePrice).sort((a,b)=>b.price-a.price);
    const resistances=ps.filter(x=>x.price>livePrice).sort((a,b)=>a.price-b.price);
    frameSummary.push({frame:f.code,support:supports[0]?.price||null,resistance:resistances[0]?.price||null});
  }
  const levels=cluster(points,livePrice);
  const supports=levels.filter(x=>x.type==='SUPPORT').sort((a,b)=>(b.score-a.score)||(a.distance-b.distance)).slice(0,5);
  const resistances=levels.filter(x=>x.type==='RESISTANCE').sort((a,b)=>(b.score-a.score)||(a.distance-b.distance)).slice(0,5);
  const strongest=[...levels].sort((a,b)=>(b.score-a.score)||(a.distance-b.distance)).slice(0,6);
  return {price:livePrice,supports,resistances,strongest,frameSummary};
}

module.exports={getGoldSupportResistance};
