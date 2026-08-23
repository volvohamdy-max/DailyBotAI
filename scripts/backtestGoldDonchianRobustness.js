// Small robustness grid for GOLD_DONCHIAN_TREND.
// Intentionally varies ONLY entry lookback and ADX threshold; BUY + SELL remain enabled.
const { spawnSync } = require('child_process');

const entries = [20, 30, 40];
const adxValues = [18, 20, 22];

function parseBlock(text, label) {
  const marker = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(marker + '\\n(\\d+) trades \\| WR ([\\d.]+)% \\| Net ([+-][\\d.]+)R \\| Avg ([+-]?[\\d.]+)R \\| PF ([\\d.]+) \\| DD ([\\d.]+)R \\| LS (\\d+)');
  const m = text.match(re);
  if (!m) return null;
  return { trades:+m[1], wr:+m[2], net:+m[3], avg:+m[4], pf:+m[5], dd:+m[6], ls:+m[7] };
}

const rows = [];
console.log('🔬 GOLD DONCHIAN ROBUSTNESS — BUY + SELL');
console.log('Grid: DON_ENTRY 20/30/40 × ADX 18/20/22 | everything else FIXED');

for (const don of entries) {
  for (const adx of adxValues) {
    console.log(`\n▶ DON=${don} ADX=${adx}`);
    const r = spawnSync(process.execPath, ['scripts/backtestGoldDonchianTrendDukascopy.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DON_ENTRY:String(don), ADX_MIN:String(adx) },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout || `Failed with code ${r.status}`);
      process.exit(r.status || 1);
    }
    const D=parseBlock(r.stdout,'📊 DEV'), V=parseBlock(r.stdout,'📊 VAL'), O=parseBlock(r.stdout,'🧪 OOS — UNTOUCHED 20%');
    if (!D || !V || !O) { console.error(r.stdout); throw new Error('Could not parse backtest output'); }
    const pass = D.net>0 && V.net>0 && O.net>0 && D.pf>1 && V.pf>1 && O.pf>1;
    const worstPf = Math.min(D.pf,V.pf,O.pf);
    const worstAvg = Math.min(D.avg,V.avg,O.avg);
    rows.push({don,adx,D,V,O,pass,worstPf,worstAvg});
    console.log(`DEV ${D.net>=0?'+':''}${D.net.toFixed(2)}R PF ${D.pf.toFixed(2)} | VAL ${V.net>=0?'+':''}${V.net.toFixed(2)}R PF ${V.pf.toFixed(2)} | OOS ${O.net>=0?'+':''}${O.net.toFixed(2)}R PF ${O.pf.toFixed(2)} | ${pass?'✅ PASS':'❌'}`);
  }
}

rows.sort((a,b)=>Number(b.pass)-Number(a.pass)||b.worstPf-a.worstPf||b.worstAvg-a.worstAvg);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🏆 ROBUSTNESS RANKING — ranked by PASS then worst split PF');
console.log('DON ADX | DEV Net/PF | VAL Net/PF | OOS Net/PF | WorstPF | Result');
for (const x of rows) {
  console.log(`${String(x.don).padStart(3)} ${String(x.adx).padStart(3)} | ${x.D.net>=0?'+':''}${x.D.net.toFixed(2)}/${x.D.pf.toFixed(2)} | ${x.V.net>=0?'+':''}${x.V.net.toFixed(2)}/${x.V.pf.toFixed(2)} | ${x.O.net>=0?'+':''}${x.O.net.toFixed(2)}/${x.O.pf.toFixed(2)} | ${x.worstPf.toFixed(2)} | ${x.pass?'✅ PASS':'❌ FAIL'}`);
}
const passed=rows.filter(x=>x.pass);
console.log(`\nPassed all DEV+VAL+OOS: ${passed.length}/${rows.length}`);
if (passed.length) console.log(`🥇 Candidate: DON_ENTRY=${passed[0].don} ADX_MIN=${passed[0].adx}`);
else console.log('🗑️ No robust candidate. Do not optimize further; reject this version.');
