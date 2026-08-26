#!/usr/bin/env node
'use strict';

/**
 * 🔥 GOLD EXHAUSTION V3 — COST STRESS TEST
 *
 * SAME V3 SIGNALS.
 * NO optimization.
 *
 * Cost is charged per completed trade as:
 * total round-trip cost = ATR_at_signal * costATR
 *
 * Cost is converted to R:
 * costR = costPrice / initialRisk
 */

const { getHistoricalRates } = require('dukascopy-node');

const FROM = process.argv[2] || '2025-08-24';
const TO   = process.argv[3] || '2026-08-24';
const CACHE = './data/dukascopy-cache';

const BUY = {
  burstBars: 3,
  burstATR: 2.2,
  wick: 0.30,
  retrace: 0.20,
  tpATR: 1.0,
  slATR: 1.0,
  maxBars: 3
};

const SELL = {
  burstBars: 3,
  burstATR: 2.6,
  wick: 0.40,
  retrace: 0.15,
  tpATR: 1.0,
  slATR: 0.75,
  maxBars: 3
};

function atr(c, p=14) {
  const o = Array(c.length).fill(null);

  for (let i=p; i<c.length; i++) {
    let s=0;

    for (let j=i-p+1; j<=i; j++) {
      const pc=c[j-1].close;

      s += Math.max(
        c[j].high-c[j].low,
        Math.abs(c[j].high-pc),
        Math.abs(c[j].low-pc)
      );
    }

    o[i]=s/p;
  }

  return o;
}

function stats(t, costATR=0) {
  let eq=0, peak=0, dd=0;
  let gp=0, gl=0, wins=0;
  let ls=0, maxLS=0;
  let bars=0;

  for (const x of t) {

    /*
     * risk = ATR * slATR
     * cost = ATR * costATR
     *
     * Therefore:
     * costR = costATR / slATR
     */
    const costR = costATR / x.slATR;
    const r = x.rawR - costR;

    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak-eq);
    bars += x.bars;

    if (r > 0) {
      wins++;
      gp += r;
      ls=0;
    } else {
      gl += -r;
      ls++;
      maxLS=Math.max(maxLS,ls);
    }
  }

  return {
    n:t.length,
    wr:t.length ? wins/t.length*100 : 0,
    net:eq,
    pf:gl ? gp/gl : (gp ? 999 : 0),
    dd,
    ls:maxLS,
    mins:t.length ? bars/t.length*5 : 0
  };
}


function statsDollar(t, costUSD=0) {
  let eq=0,peak=0,dd=0,gp=0,gl=0,wins=0;
  let ls=0,maxLS=0,bars=0;

  for(const x of t){

    // Round-trip execution cost in XAUUSD price dollars.
    const costR = costUSD / x.risk;
    const r = x.rawR - costR;

    eq += r;
    peak=Math.max(peak,eq);
    dd=Math.max(dd,peak-eq);
    bars+=x.bars;

    if(r>0){
      wins++;
      gp+=r;
      ls=0;
    }else{
      gl+=-r;
      ls++;
      maxLS=Math.max(maxLS,ls);
    }
  }

  return {
    n:t.length,
    wr:t.length?wins/t.length*100:0,
    net:eq,
    pf:gl?gp/gl:(gp?999:0),
    dd,
    ls:maxLS,
    mins:t.length?bars/t.length*5:0
  };
}

function F(s) {
  return `${s.n} trades | ` +
    `WR ${s.wr.toFixed(1)}% | ` +
    `Net ${s.net>=0?'+':''}${s.net.toFixed(2)}R | ` +
    `PF ${s.pf.toFixed(2)} | ` +
    `DD ${s.dd.toFixed(2)}R | ` +
    `LS ${s.ls} | ` +
    `Avg ${s.mins.toFixed(1)}m`;
}

(async()=>{

  console.log('');
  console.log('🔥 EXHAUSTION V3 — COST STRESS TEST');
  console.log(`📅 ${FROM} -> ${TO}`);
  console.log('🔒 SAME V3 RULES — NO OPTIMIZATION');
  console.log('');

  const raw=await getHistoricalRates({
    instrument:'xauusd',
    dates:{
      from:new Date(FROM+'T00:00:00Z'),
      to:new Date(TO+'T23:59:59Z')
    },
    timeframe:'m5',
    format:'json',
    priceType:'bid',
    volumes:true,
    useCache:true,
    cacheFolderPath:CACHE
  });

  const c=raw.map(x=>({
    timestamp:+x.timestamp,
    open:+x.open,
    high:+x.high,
    low:+x.low,
    close:+x.close
  })).sort((a,b)=>a.timestamp-b.timestamp);

  const A=atr(c,14);

  console.log(`✅ Loaded ${c.length} M5 candles`);

  const T=[];

  for(let i=40;i<c.length-6;i++){

    if(!Number.isFinite(A[i]) || A[i]<=0)
      continue;

    const hr=new Date(c[i].timestamp).getUTCHours();

    if(hr<4 || hr>20)
      continue;

    const start=c[i-3].close;
    const end=c[i-1].close;
    const disp=end-start;

    if(disp===0)
      continue;

    const burstSide=disp>0 ? 'UP' : 'DOWN';
    const side=burstSide==='DOWN' ? 'BUY' : 'SELL';
    const q=side==='BUY' ? BUY : SELL;

    if(Math.abs(disp)<A[i]*q.burstATR)
      continue;

    let agreeing=0;

    for(let k=i-3;k<i;k++){

      if(
        burstSide==='UP' &&
        c[k].close>c[k].open
      ) agreeing++;

      if(
        burstSide==='DOWN' &&
        c[k].close<c[k].open
      ) agreeing++;
    }

    if(agreeing<2)
      continue;

    const ex=c[i];
    const range=ex.high-ex.low;

    if(!(range>0))
      continue;

    const upper=
      (ex.high-Math.max(ex.open,ex.close))/range;

    const lower=
      (Math.min(ex.open,ex.close)-ex.low)/range;

    if(side==='BUY' && lower<q.wick)
      continue;

    if(side==='SELL' && upper<q.wick)
      continue;

    const confirm=c[i+1];

    if(side==='BUY'){

      const trigger=ex.low+range*q.retrace;

      if(confirm.close<=trigger)
        continue;

      if(confirm.low<ex.low-A[i]*0.25)
        continue;

    } else {

      const trigger=ex.high-range*q.retrace;

      if(confirm.close>=trigger)
        continue;

      if(confirm.high>ex.high+A[i]*0.25)
        continue;
    }

    const entry=c[i+2].open;

    const risk=A[i]*q.slATR;
    const reward=A[i]*q.tpATR;

    if(!(risk>0 && reward>0))
      continue;

    const stop=
      side==='BUY'
        ? entry-risk
        : entry+risk;

    const target=
      side==='BUY'
        ? entry+reward
        : entry-reward;

    let exit=c[i+1+q.maxBars].close;
    let barsHeld=q.maxBars;

    for(
      let j=i+2;
      j<=i+1+q.maxBars;
      j++
    ){

      const hitSL=
        side==='BUY'
          ? c[j].low<=stop
          : c[j].high>=stop;

      const hitTP=
        side==='BUY'
          ? c[j].high>=target
          : c[j].low<=target;

      /*
       * Conservative:
       * if both touched in same M5 candle,
       * assume SL first.
       */
      if(hitSL || hitTP){

        exit=hitSL ? stop : target;
        barsHeld=j-(i+1);
        break;
      }
    }

    const rawR=
      side==='BUY'
        ? (exit-entry)/risk
        : (entry-exit)/risk;

    T.push({
      rawR,
      side,
      slATR:q.slATR,
      atr:A[i],
      risk:risk,
      bars:barsHeld,
      time:c[i+2].timestamp
    });

    i+=barsHeld;
  }

  const cut=Math.floor(T.length*0.70);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 BASELINE CHECK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const base=stats(T,0);

  console.log(F(base));

  console.log('');
  console.log(
    'Expected ≈ 217 trades | WR 59.9% | ' +
    'Net +43.96R | PF 1.57 | DD 7.82R'
  );

  const scenarios=[
    {label:'RAW / 0%', cost:0},
    {label:'LIGHT / 5% ATR', cost:0.05},
    {label:'MEDIUM / 10% ATR', cost:0.10},
    {label:'STRESS / 15% ATR', cost:0.15}
  ];

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💸 COST SCENARIOS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for(const s of scenarios){

    const all=stats(T,s.cost);
    const buy=stats(
      T.filter(x=>x.side==='BUY'),
      s.cost
    );
    const sell=stats(
      T.filter(x=>x.side==='SELL'),
      s.cost
    );

    const dev=stats(
      T.slice(0,cut),
      s.cost
    );

    const oos=stats(
      T.slice(cut),
      s.cost
    );

    console.log('');
    console.log(`━━ ${s.label} ━━`);
    console.log('ALL  '+F(all));
    console.log('BUY  '+F(buy));
    console.log('SELL '+F(sell));
    console.log('DEV  '+F(dev));
    console.log('OOS  '+F(oos));
  }


  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💵 XAUUSD DOLLAR COST TEST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Cost = total round-trip execution cost per trade');

  const dollarCosts=[0.20,0.30,0.50,0.75,1.00];

  for(const cost of dollarCosts){

    const all=statsDollar(T,cost);
    const dev=statsDollar(T.slice(0,cut),cost);
    const oos=statsDollar(T.slice(cut),cost);

    console.log('');
    console.log(`━━ $${cost.toFixed(2)} / trade ━━`);
    console.log('ALL '+F(all));
    console.log('DEV '+F(dev));
    console.log('OOS '+F(oos));
  }

  /*
   * Find approximate break-even cost.
   */
  let breakEven=null;

  for(let cost=0;cost<=0.50;cost+=0.005){

    const s=stats(T,cost);

    if(s.net<=0 || s.pf<=1){
      breakEven=cost;
      break;
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if(breakEven!==null){
    console.log(
      `🧨 Approx break-even total cost: `+
      `${(breakEven*100).toFixed(1)}% of ATR/trade`
    );
  }else{
    console.log(
      '🧨 Break-even cost > 50% ATR/trade'
    );
  }

  /*
   * Our practical acceptance check.
   */
  const medium=stats(T,0.10);
  const mediumOOS=stats(T.slice(cut),0.10);

  console.log('');

  if(
    medium.pf>=1.35 &&
    medium.net>=30 &&
    medium.dd<=10 &&
    mediumOOS.net>0 &&
    mediumOOS.pf>=1.20
  ){
    console.log(
      '🔥 COST VERDICT: STRONG — survives 10% ATR cost'
    );
  }else if(
    medium.pf>=1.20 &&
    medium.net>0 &&
    mediumOOS.net>0
  ){
    console.log(
      '✅ COST VERDICT: SURVIVES — but margin is thinner'
    );
  }else{
    console.log(
      '❌ COST VERDICT: EDGE too sensitive to execution costs'
    );
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

})().catch(e=>{
  console.error('❌',e);
  process.exit(1);
});
