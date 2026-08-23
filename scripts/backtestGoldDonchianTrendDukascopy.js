const { getGoldHistoricalCandles } = require('./backtestHistoryDukascopyLocal');

const HISTORY = Math.max(30000, Math.min(141000, Number(process.env.BACKTEST_HISTORY || 100000)));
const RR = Number(process.env.TP_R || 2);
const DON_ENTRY = Number(process.env.DON_ENTRY || 20);
const DON_EXIT = Number(process.env.DON_EXIT || 10);
const ADX_MIN = Number(process.env.ADX_MIN || 20);
const ATR_MULT = Number(process.env.ATR_MULT || 2);
const COST_R = Number(process.env.COST_R || 0.03);

function aggregate(candles, factor) {
  const out = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const z = candles.slice(i, i + factor);
    out.push({
      time: z[0].time,
      open: z[0].open,
      high: Math.max(...z.map(x => x.high)),
      low: Math.min(...z.map(x => x.low)),
      close: z[z.length - 1].close
    });
  }
  return out;
}

function emaSeries(values, period) {
  const out = Array(values.length).fill(null);
  if (!values.length) return out;
  let e = values[0];
  const k = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    if (i) e = values[i] * k + e * (1 - k);
    if (i >= period - 1) out[i] = e;
  }
  return out;
}

function atrSeries(c, period = 14) {
  const out = Array(c.length).fill(null);
  const tr = Array(c.length).fill(null);
  for (let i = 1; i < c.length; i++) {
    tr[i] = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close)
    );
  }
  for (let i = period; i < c.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += tr[j];
    out[i] = s / period;
  }
  return out;
}

function adxSeries(c, p = 14) {
  const out = Array(c.length).fill(null);
  const tr = Array(c.length).fill(0), pd = Array(c.length).fill(0), md = Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    pd[i] = up > down && up > 0 ? up : 0;
    md[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  const dx = Array(c.length).fill(null);
  for (let i = p; i < c.length; i++) {
    let T = 0, P = 0, M = 0;
    for (let j = i - p + 1; j <= i; j++) { T += tr[j]; P += pd[j]; M += md[j]; }
    if (!T) continue;
    P = 100 * P / T; M = 100 * M / T;
    if (P + M) dx[i] = 100 * Math.abs(P - M) / (P + M);
  }
  for (let i = p * 2 - 1; i < c.length; i++) {
    let s = 0, n = 0;
    for (let j = i - p + 1; j <= i; j++) if (Number.isFinite(dx[j])) { s += dx[j]; n++; }
    if (n === p) out[i] = s / p;
  }
  return out;
}

function highest(c, i, lookback) {
  let v = -Infinity;
  for (let j = i - lookback; j < i; j++) v = Math.max(v, c[j].high);
  return v;
}
function lowest(c, i, lookback) {
  let v = Infinity;
  for (let j = i - lookback; j < i; j++) v = Math.min(v, c[j].low);
  return v;
}

function stats(t) {
  if (!t.length) return { trades:0, wr:0, netR:0, avgR:0, pf:0, dd:0, ls:0 };
  let w=0,gp=0,gl=0,e=0,pk=0,dd=0,ls=0,maxLs=0;
  for (const x of t) {
    e += x.r;
    if (x.r > 0) { w++; gp += x.r; ls = 0; }
    else { gl -= x.r; ls++; maxLs = Math.max(maxLs, ls); }
    pk = Math.max(pk, e); dd = Math.max(dd, pk - e);
  }
  return { trades:t.length, wr:100*w/t.length, netR:e, avgR:e/t.length, pf:gl?gp/gl:999, dd, ls:maxLs };
}
const fmt = s => `${s.trades} trades | WR ${s.wr.toFixed(1)}% | Net ${s.netR>=0?'+':''}${s.netR.toFixed(2)}R | Avg ${s.avgR.toFixed(3)}R | PF ${s.pf.toFixed(2)} | DD ${s.dd.toFixed(2)}R | LS ${s.ls}`;

function run(h1, start, end) {
  const C = h1.map(x=>x.close), EMA200 = emaSeries(C,200), ATR = atrSeries(h1), ADX = adxSeries(h1);
  const out=[]; let p=null;
  for (let i=Math.max(start,220); i<Math.min(end,h1.length-1); i++) {
    if (p) {
      const b = h1[i];
      const hitSl = p.side==='BUY' ? b.low <= p.sl : b.high >= p.sl;
      const hitTp = p.side==='BUY' ? b.high >= p.tp : b.low <= p.tp;
      const exitBreak = p.side==='BUY' ? b.low <= lowest(h1,i,DON_EXIT) : b.high >= highest(h1,i,DON_EXIT);
      if (hitSl || hitTp || exitBreak) {
        let r;
        if (hitSl) r = -1 - COST_R;
        else if (hitTp) r = RR - COST_R;
        else {
          const px = b.close;
          r = (p.side==='BUY' ? (px-p.entry) : (p.entry-px)) / p.risk - COST_R;
        }
        out.push({...p, exitTime:b.time, r});
        p=null;
      }
      continue;
    }
    if (![EMA200[i],ATR[i],ADX[i]].every(Number.isFinite) || ADX[i] < ADX_MIN) continue;
    const up = highest(h1,i,DON_ENTRY), dn = lowest(h1,i,DON_ENTRY), nextOpen = h1[i+1].open;
    let side=null;
    if (h1[i].close > up && h1[i].close > EMA200[i]) side='BUY';
    else if (h1[i].close < dn && h1[i].close < EMA200[i]) side='SELL';
    if (!side) continue;
    const risk = ATR[i] * ATR_MULT;
    p = {
      side,
      time:h1[i+1].time,
      entry:nextOpen,
      risk,
      sl:side==='BUY'?nextOpen-risk:nextOpen+risk,
      tp:side==='BUY'?nextOpen+risk*RR:nextOpen-risk*RR
    };
  }
  return out;
}

(async()=>{
  console.log('⚡ GOLD DONCHIAN TREND — H1');
  console.log(`EMA200 + Donchian${DON_ENTRY} breakout + ADX>=${ADX_MIN} | SL ${ATR_MULT}ATR | TP ${RR}R | reverse Donchian${DON_EXIT} exit`);
  const m5 = (await getGoldHistoricalCandles('5min', HISTORY)).map(x=>({...x,time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close}));
  const h1 = aggregate(m5,12);
  console.log(`✅ Dukascopy local history: 5min ${m5.length} candles | H1 ${h1.length}`);
  const s=220,u=h1.length-s,de=s+Math.floor(u*.6),ve=s+Math.floor(u*.8);
  const D=run(h1,s,de),V=run(h1,de,ve),O=run(h1,ve,h1.length),F=run(h1,s,h1.length);
  console.log('\n📊 DEV\n'+fmt(stats(D))+'\n\n📊 VAL\n'+fmt(stats(V))+'\n\n🧪 OOS — UNTOUCHED 20%\n'+fmt(stats(O)));
  console.log('\n📈 OOS BUY\n'+fmt(stats(O.filter(x=>x.side==='BUY')))+'\n\n📉 OOS SELL\n'+fmt(stats(O.filter(x=>x.side==='SELL'))));
  console.log('\n📅 YEARLY — FULL HISTORY');
  const y={}; for(const t of F)(y[new Date(t.time).getUTCFullYear()]??=[]).push(t);
  for(const [k,v] of Object.entries(y)) console.log(`${k} | ${fmt(stats(v))}`);
})().catch(e=>{console.error(e);process.exit(1)});
