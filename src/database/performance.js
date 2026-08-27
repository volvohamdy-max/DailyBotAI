const db = require('./db');

function nowSql() {
  return new Date().toISOString();
}

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER UNIQUE NOT NULL,
      telegram_id TEXT,
      pair TEXT NOT NULL,
      action TEXT NOT NULL,
      entry REAL,
      stop_loss REAL,
      target1 REAL,
      target2 REAL,
      opened_at TEXT,
      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      sl_hit INTEGER NOT NULL DEFAULT 0,
      tp1_at TEXT,
      closed_at TEXT,
      exit_price REAL,
      outcome TEXT,
      realized_r REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    UPDATE trade_performance
    SET
      sl_hit = 0,
      closed_at = COALESCE(tp1_at, closed_at, updated_at, created_at),
      exit_price = CASE WHEN target1 IS NOT NULL THEN target1 ELSE exit_price END,
      outcome = 'TP1',
      realized_r = CASE
        WHEN entry IS NOT NULL AND stop_loss IS NOT NULL AND target1 IS NOT NULL AND ABS(entry - stop_loss) > 0
        THEN ROUND(ABS(target1 - entry) / ABS(entry - stop_loss), 3)
        ELSE realized_r
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE tp1_hit = 1 AND COALESCE(tp2_hit, 0) = 0 AND COALESCE(outcome, '') <> 'TP1';
  `);

  try {
    db.exec(`
      UPDATE trades SET status = 'closed'
      WHERE id IN (
        SELECT trade_id FROM trade_performance
        WHERE tp1_hit = 1 AND COALESCE(tp2_hit, 0) = 0 AND outcome = 'TP1'
      ) AND status <> 'closed';
    `);
  } catch (_) {}
}

function riskDistance(trade) {
  const entry = Number(trade.entry), sl = Number(trade.stop_loss);
  if (!Number.isFinite(entry) || !Number.isFinite(sl)) return null;
  const risk = Math.abs(entry - sl);
  return risk > 0 ? risk : null;
}

function realizedR(trade, exitPrice, outcome) {
  const risk = riskDistance(trade);
  if (!risk) return null;
  if (outcome === 'SL') return -1;
  const entry = Number(trade.entry), exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  return Number((Math.abs(exit - entry) / risk).toFixed(3));
}

function directionalR(trade, exitPrice) {
  const risk = riskDistance(trade);
  if (!risk) return null;
  const entry = Number(trade.entry), exit = Number(exitPrice), action = String(trade.action || '').toUpperCase();
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  if (action !== 'BUY' && action !== 'SELL') return null;
  const move = action === 'BUY' ? exit - entry : entry - exit;
  return Number((move / risk).toFixed(3));
}

function isProStrategyTrade(trade) {
  return String(trade?.telegram_id || '').toUpperCase() === 'VIP_SCALP_PRO_STRATEGY';
}

function ensureTradeTracked(trade) {
  ensureTable();
  const exists = db.prepare('SELECT trade_id FROM trade_performance WHERE trade_id = ?').get(Number(trade.id));
  if (exists) return;
  db.prepare(`INSERT INTO trade_performance
    (trade_id, telegram_id, pair, action, entry, stop_loss, target1, target2, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(trade.id), trade.telegram_id != null ? String(trade.telegram_id) : null,
    String(trade.pair || '').toUpperCase(), String(trade.action || '').toUpperCase(),
    Number(trade.entry), Number(trade.stop_loss), Number(trade.target1), Number(trade.target2),
    trade.created_at || nowSql());
}

function recordProRsiWin(trade, price) {
  ensureTradeTracked(trade);
  const exitPrice = Number(price), r = directionalR(trade, exitPrice), now = nowSql();
  db.prepare(`UPDATE trade_performance SET tp1_hit=0,tp2_hit=0,sl_hit=0,closed_at=?,exit_price=?,outcome='PRO_RSI_WIN',realized_r=?,updated_at=? WHERE trade_id=?`)
    .run(now, exitPrice, r, now, Number(trade.id));
}

function recordTp1(trade, price) {
  if (isProStrategyTrade(trade)) return recordProRsiWin(trade, price);
  ensureTradeTracked(trade);
  const exitPrice = Number.isFinite(Number(trade.target1)) ? Number(trade.target1) : Number(price);
  const r = realizedR(trade, exitPrice, 'TP1'), now = nowSql();
  db.prepare(`UPDATE trade_performance SET tp1_hit=1,sl_hit=0,tp1_at=COALESCE(tp1_at,?),closed_at=COALESCE(closed_at,?),exit_price=?,outcome='TP1',realized_r=?,updated_at=? WHERE trade_id=?`)
    .run(now, now, exitPrice, r, now, Number(trade.id));
}

function recordTp2(trade, price) {
  ensureTradeTracked(trade);
  const exitPrice = Number.isFinite(Number(trade.target2)) ? Number(trade.target2) : Number(price);
  const r = realizedR(trade, exitPrice, 'TP2'), now = nowSql();
  db.prepare(`UPDATE trade_performance SET tp1_hit=1,tp2_hit=1,sl_hit=0,tp1_at=COALESCE(tp1_at,?),closed_at=?,exit_price=?,outcome='TP2',realized_r=?,updated_at=? WHERE trade_id=?`)
    .run(now, now, exitPrice, r, now, Number(trade.id));
}

function recordSl(trade, price) {
  ensureTradeTracked(trade);
  const existing = db.prepare('SELECT tp1_hit, tp2_hit FROM trade_performance WHERE trade_id = ?').get(Number(trade.id));
  if (Number(existing?.tp1_hit || 0) === 1 && Number(existing?.tp2_hit || 0) !== 1) return recordTp1(trade, trade.target1 ?? price);
  const r = realizedR(trade, price, 'SL');
  db.prepare(`UPDATE trade_performance SET sl_hit=1,closed_at=?,exit_price=?,outcome='SL',realized_r=?,updated_at=? WHERE trade_id=?`)
    .run(nowSql(), Number(price), r, nowSql(), Number(trade.id));
}

function recordBreakeven(trade, price) {
  ensureTradeTracked(trade);
  db.prepare(`UPDATE trade_performance SET closed_at=?,exit_price=?,outcome='BREAKEVEN',realized_r=0,updated_at=? WHERE trade_id=?`)
    .run(nowSql(), Number(price), nowSql(), Number(trade.id));
}

function goldPipsForRow(row) {
  if (String(row.pair || '').toUpperCase() !== 'XAUUSD') return null;
  const action = String(row.action || '').toUpperCase(), entry = Number(row.entry);
  if (!Number.isFinite(entry) || (action !== 'BUY' && action !== 'SELL')) return null;
  const moveTo = price => {
    const exit = Number(price); if (!Number.isFinite(exit)) return null;
    return (action === 'BUY' ? exit - entry : entry - exit) / 0.01;
  };
  if (row.outcome === 'TP1') return moveTo(row.target1);
  if (row.outcome === 'TP2') return moveTo(row.target2);
  if (row.outcome === 'SL') return moveTo(row.stop_loss);
  if (row.outcome === 'PRO_RSI_WIN') return moveTo(row.exit_price);
  if (row.outcome === 'BREAKEVEN') return 0;
  return null;
}

function strategyKey(row) {
  const source = String(row.telegram_id || '').trim().toUpperCase();
  if (source === 'VIP_REGIME') return 'REGIME';
  if (source === 'VIP_POWER') return 'POWER';
  if (source === 'VIP_H4_MR') return 'H4_MR';
  if (source === 'VIP_SCALP_PRO_STRATEGY') return 'PRO_STRATEGY';
  if (source === 'VIP_SCALP_GROK_GOLD_92') return 'GROK_GOLD_92';
  if (source === 'VIP_SCALP_NEW_YORK') return 'NEW_YORK';
  if (source === 'VIP_SCALP_AGGRESSIVE_BREAKOUT_A') return 'BREAKOUT_A';
  if (source.startsWith('VIP_HOURLY_MARKET_BIAS')) return 'HOURLY_MARKET_BIAS';
  if (source.startsWith('VIP_SCALP_')) return source.slice('VIP_SCALP_'.length) || 'SCALP';
  if (source === 'VIP_SCALP' || source === 'VIP' || source === 'VIP_FREE') return 'SCALP';
  return source ? `SOURCE:${source}` : 'UNKNOWN_SOURCE';
}

function getStats(days) {
  ensureTable();
  const cutoff = new Date(Date.now() - Number(days) * 86400000).toISOString();
  const rows = db.prepare(`SELECT * FROM trade_performance WHERE opened_at >= ? ORDER BY opened_at DESC`).all(cutoff);
  const closed = rows.filter(x => x.closed_at), active = rows.filter(x => !x.closed_at);
  const tp1 = rows.filter(x => Number(x.tp1_hit) === 1).length;
  const tp2 = rows.filter(x => Number(x.tp2_hit) === 1).length;
  const sl = rows.filter(x => Number(x.sl_hit) === 1).length;
  const pureSl = rows.filter(x => x.outcome === 'SL').length;
  const proRsiWins = rows.filter(x => x.outcome === 'PRO_RSI_WIN').length;
  const rValues = closed.filter(x => x.realized_r != null).map(x => Number(x.realized_r)).filter(Number.isFinite);
  const avgR = rValues.length ? rValues.reduce((a,b)=>a+b,0)/rValues.length : null;
  const totalR = rValues.length ? rValues.reduce((a,b)=>a+b,0) : null;
  const reachedRValues = rows.map(row => {
    const entry=Number(row.entry), stop=Number(row.stop_loss), risk=Math.abs(entry-stop);
    if(!Number.isFinite(risk)||risk<=0)return null;
    if(Number(row.tp2_hit)===1){const t=Number(row.target2);return Number.isFinite(t)?Math.abs(t-entry)/risk:null;}
    if(Number(row.tp1_hit)===1){const t=Number(row.target1);return Number.isFinite(t)?Math.abs(t-entry)/risk:null;}
    if(row.outcome==='PRO_RSI_WIN'&&Number.isFinite(Number(row.realized_r)))return Number(row.realized_r);
    return null;
  }).filter(Number.isFinite);
  const reachedR = reachedRValues.length ? reachedRValues.reduce((a,b)=>a+b,0) : null;
  const pipResults=closed.map(row=>({row,pips:goldPipsForRow(row)})).filter(x=>Number.isFinite(x.pips));
  const totalPips=pipResults.length?pipResults.reduce((s,x)=>s+x.pips,0):null;
  const avgPips=pipResults.length?totalPips/pipResults.length:null;
  const winningPipTrades=pipResults.filter(x=>x.pips>0).length;
  const losingPipTrades=pipResults.filter(x=>x.pips<0).length;
  const breakevenPipTrades=pipResults.filter(x=>Math.abs(x.pips)<.0001).length;
  const bestPipTrade=pipResults.length?pipResults.reduce((b,x)=>!b||x.pips>b.pips?x:b,null):null;
  const worstPipTrade=pipResults.length?pipResults.reduce((b,x)=>!b||x.pips<b.pips?x:b,null):null;
  const byPair={}, byStrategy={};
  for(const row of rows){
    const pair=row.pair||'UNKNOWN';
    if(!byPair[pair])byPair[pair]={total:0,closed:0,tp1:0,tp2:0,sl:0,tp1ThenSl:0};
    byPair[pair].total++; if(row.closed_at)byPair[pair].closed++; if(Number(row.tp1_hit)===1)byPair[pair].tp1++; if(Number(row.tp2_hit)===1)byPair[pair].tp2++; if(Number(row.sl_hit)===1)byPair[pair].sl++;
    const key=strategyKey(row);
    if(!byStrategy[key])byStrategy[key]={total:0,closed:0,tp1:0,tp2:0,sl:0,proRsiWins:0,netR:0};
    const st=byStrategy[key]; st.total++; if(row.closed_at)st.closed++; if(Number(row.tp1_hit)===1)st.tp1++; if(Number(row.tp2_hit)===1)st.tp2++; if(Number(row.sl_hit)===1)st.sl++; if(row.outcome==='PRO_RSI_WIN')st.proRsiWins++; if(Number.isFinite(Number(row.realized_r)))st.netR+=Number(row.realized_r);
  }
  return {days:Number(days),total:rows.length,open:active.length,waitingTp2:0,closed:closed.length,tp1,tp2,sl,pureSl,tp1ThenSl:0,proRsiWins,
    tp1Rate:rows.length?(tp1/rows.length)*100:0,tp2Rate:rows.length?(tp2/rows.length)*100:0,slRate:rows.length?(sl/rows.length)*100:0,
    avgR,totalR,reachedR,totalPips,avgPips,winningPipTrades,losingPipTrades,breakevenPipTrades,
    bestPipTrade:bestPipTrade?{tradeId:bestPipTrade.row.trade_id,pips:bestPipTrade.pips,action:bestPipTrade.row.action,outcome:bestPipTrade.row.outcome}:null,
    worstPipTrade:worstPipTrade?{tradeId:worstPipTrade.row.trade_id,pips:worstPipTrade.pips,action:worstPipTrade.row.action,outcome:worstPipTrade.row.outcome}:null,
    byPair,byStrategy};
}

module.exports={ensureTradeTracked,recordTp1,recordTp2,recordSl,recordBreakeven,recordProRsiWin,getStats};
