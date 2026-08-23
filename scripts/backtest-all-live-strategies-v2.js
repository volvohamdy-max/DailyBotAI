const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'backtest-all-live-strategies.js');
let source = fs.readFileSync(basePath, 'utf8');

const grokFn = String.raw`
function testGrok92(m5,h1){
  const out=[];
  const e9=emaSeries(m5.map(x=>x.close),9);
  const e21=emaSeries(m5.map(x=>x.close),21);
  const rsi=rsiSeries(m5.map(x=>x.close),14);
  const atr5=atrSeries(m5,14);
  const h1Close=h1.map(x=>x.close);
  const h1Ema200=emaSeries(h1Close,200);
  const h1Atr=atrSeries(h1,14);
  const h1Adx=adxSeries(h1,14);

  for(let i=220;i<m5.length-2;i++){
    const sig=m5[i];
    const entryIdx=i+1;
    const entryBar=m5[entryIdx];
    const hour=new Date(entryBar.timestamp).getUTCHours();
    if(!((hour>=13&&hour<16)||(hour>=18&&hour<20))) continue;

    const prev=i-1;
    if(![e9[i],e21[i],e9[prev],e21[prev],rsi[i],atr5[i]].every(Number.isFinite) || !(atr5[i]>0)) continue;

    const crossUp=e9[prev]<=e21[prev] && e9[i]>e21[i];
    const crossDown=e9[prev]>=e21[prev] && e9[i]<e21[i];
    let side=null;
    if(crossUp && rsi[i]>52) side='BUY';
    if(crossDown && rsi[i]<48) side='SELL';
    if(!side) continue;

    const emaGapAtr=Math.abs(e9[i]-e21[i])/atr5[i];
    if(emaGapAtr<0.04) continue;

    let volSum=0;
    let volOk=true;
    for(let k=i-20;k<i;k++){
      const v=Number(m5[k]?.volume)||0;
      if(!(v>=0)){volOk=false;break;}
      volSum+=v;
    }
    if(!volOk) continue;
    const volAvg=volSum/20;
    const signalVolume=Number(sig.volume)||0;
    if(!(volAvg>0) || !(signalVolume>=volAvg*1.25)) continue;

    const h=prevIndex(h1,sig.timestamp+1);
    if(h<220) continue;
    if(![h1Close[h],h1Ema200[h],h1Atr[h],h1Adx[h]].every(Number.isFinite) || !(h1Atr[h]>0)) continue;
    if(h1Adx[h]<20) continue;

    const h1Bias=h1Close[h]>h1Ema200[h]?'BUY':h1Close[h]<h1Ema200[h]?'SELL':null;
    if(side!==h1Bias) continue;
    const h1Distance=Math.abs(h1Close[h]-h1Ema200[h])/h1Atr[h];
    if(h1Distance<0.10) continue;

    const entry=entryBar.open;
    const risk=atr5[i]*2.0;
    if(!(risk>0)) continue;
    const sl=side==='BUY'?entry-risk:entry+risk;
    const tp=side==='BUY'?entry+risk*0.8:entry-risk*0.8;
    const z=simFixed(m5,entryIdx,side,entry,sl,tp,4320);
    if(!z) continue;

    out.push({time:entryBar.timestamp,r:z.r,side});
    i=z.exit;
  }
  return out;
}
`;

source = source.replace('(async()=>{', grokFn + '\n(async()=>{');
source = source.replace(
  "['🟣 GOLD H4 MR — LIVE',testH4MR(m5,h4)]\n  ];",
  "['🟣 GOLD H4 MR — LIVE',testH4MR(m5,h4)],\n    ['⚡ GROK GOLD 92 — LIVE',testGrok92(m5,h1)]\n  ];"
);
source = source.replace('🤖 ALL LIVE GOLD STRATEGIES — UNIFIED BACKTEST','🤖 ALL 5 LIVE GOLD STRATEGIES — UNIFIED BACKTEST');
source = source.replace("console.log('⚠️ New York/Regime entries use the next M5 bar as the historical execution proxy; Pro/H4 exits follow their current live management rules.');","console.log('⚠️ New York/Regime/Grok entries use historical M5 execution proxies; Pro/H4 exits follow their current live management rules.');\n  console.log('⚠️ Grok Gold 92 uses the next M5 open as the historical proxy for the live price entry after a closed signal bar.');");

if(!source.includes('⚡ GROK GOLD 92 — LIVE')){
  throw new Error('Failed to inject Grok Gold 92 into unified backtest');
}

eval(source);
