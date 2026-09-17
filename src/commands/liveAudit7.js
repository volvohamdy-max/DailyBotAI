'use strict';
const db=require('../database/db');
const config=require('../config');

function isAdmin(ctx){return (config.adminIds||[]).map(String).includes(String(ctx.from?.id||''));}
function n(v,d=2){const x=Number(v);return Number.isFinite(x)?x.toFixed(d):'-';}
function src(v){return String(v||'ADMIN').replace(/^VIP_SCALP_/i,'');}
function esc(s){return String(s).replace(/[<>]/g,'');}

module.exports=function registerLiveAudit7(bot){
 bot.command('liveaudit7',async ctx=>{
  if(!isAdmin(ctx))return;
  try{
   await db.ready;
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
   const tradeCols=db.prepare('PRAGMA table_info(trades)').all().map(x=>x.name);
   const perfExists=tables.includes('trade_performance');
   const perfCols=perfExists?db.prepare('PRAGMA table_info(trade_performance)').all().map(x=>x.name):[];
   const rows=db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 120').all();
   const perf=perfExists?db.prepare('SELECT * FROM trade_performance ORDER BY trade_id DESC LIMIT 200').all():[];
   const pm=new Map(perf.map(x=>[Number(x.trade_id),x]));
   const closed=rows.filter(x=>String(x.status||'').toLowerCase()==='closed').slice(0,60);
   const lines=[];
   lines.push('🔬 LIVE AUDIT — RECENT CLOSED XAUUSD');
   lines.push('DB is the running bot database');
   lines.push(`trades cols: ${tradeCols.join(',')}`);
   lines.push(`performance cols: ${perfCols.join(',')||'NONE'}`);
   lines.push('━━━━━━━━━━━━━━━━━━');
   for(const t of closed){
    const p=pm.get(Number(t.id))||{};
    const result=p.result||p.result_type||p.outcome||p.status||'-';
    const close=p.close_price??p.exit_price??p.final_price??'-';
    const pips=p.pips??p.net_pips??p.profit_pips??'-';
    const r=p.r_multiple??p.r??p.net_r??'-';
    const stamp=t.closed_at||p.closed_at||t.created_at||p.created_at||t.updated_at||p.updated_at||'-';
    lines.push(`#${t.id} | ${src(t.telegram_id)} | ${t.action}`);
    lines.push(`E ${n(t.entry)} | SL ${n(t.stop_loss)} | T1 ${n(t.target1)} | T2 ${n(t.target2)}`);
    lines.push(`RESULT ${result} | CLOSE ${close==='-'?'-':n(close)} | PIPS ${pips} | R ${r} | TIME ${stamp}`);
   }
   lines.push('━━━━━━━━━━━━━━━━━━');
   lines.push(`Shown ${closed.length} latest closed trades (max 60).`);
   const text=lines.join('\n');
   const chunks=[];for(let i=0;i<text.length;i+=3800)chunks.push(text.slice(i,i+3800));
   for(const c of chunks)await ctx.reply(esc(c));
  }catch(e){await ctx.reply('❌ liveaudit7: '+e.message);}
 });
};