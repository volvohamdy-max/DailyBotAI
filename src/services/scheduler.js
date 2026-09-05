const cron = require('node-cron');
const { isForexWeekend } = require('../utils/marketHours');
const { expireVipUsers } = require('../database/users');
const { expireVipGroupMembers } = require('./vipGroupManager');
const { scanMarket } = require('./autoSignals');
const { monitorTrades } = require('./tradeMonitor');
const { monitorCopilotTrades } = require('./tradeCopilotScaled');
const { monitorOpportunityRadar } = require('./opportunityRadar');
const { runOpportunityTeaser } = require('./opportunityTeaser');
const { collectShadowOpportunities } = require('./shadowOpportunityCollector');
const { monitorShadowTrades } = require('./shadowTradeEngine');
const { runPersonalizedAlerts } = require('./personalizedAlerts');
const { runHourlyMarketBiasTrade } = require('./hourlyMarketBiasTrade');
const { ensureOpenTradesAnnounced } = require('./vipTradeEntryGuard');
const { checkEconomicNews } = require('./newsService');
const { checkUpcomingNewsReliable } = require('./reliableUpcomingNews');
const { refreshDailyNewsBrief } = require('./dailyNewsBriefService');

let scanRunning=false, newsRunning=false, newsBriefRefreshRunning=false, monitorRunning=false;
let copilotMonitorRunning=false, radarMonitorRunning=false, opportunityTeaserRunning=false, shadowSystemRunning=false;
let hourlyBiasRunning=false, vipEntryGuardRunning=false;

function startScheduler(bot) {
  console.log('⏰ Scheduler started');
  ensureOpenTradesAnnounced(bot).catch(err=>console.log('❌ VIP ENTRY GUARD INIT:',err.message));
  cron.schedule('*/10 * * * * *',async()=>{if(vipEntryGuardRunning)return;vipEntryGuardRunning=true;try{await ensureOpenTradesAnnounced(bot);}catch(err){console.log('❌ VIP ENTRY GUARD:',err.message);}finally{vipEntryGuardRunning=false;}});

  cron.schedule('*/5 * * * *',async()=>{if(newsRunning){console.log('⚠️ Previous news check still running');return;}newsRunning=true;console.log('📰 Checking economic news...');try{const results=await Promise.allSettled([checkEconomicNews(bot),checkUpcomingNewsReliable(bot)]);const labels=['release','upcoming'];results.forEach((r,i)=>{if(r.status==='rejected')console.log(`❌ News ${labels[i]} path error:`,r.reason?.message||r.reason);});console.log('✅ News check finished');}catch(err){console.log('❌ News error:',err.message);}finally{newsRunning=false;}});
  cron.schedule('*/10 * * * *',async()=>{if(newsBriefRefreshRunning){console.log('⚠️ Previous daily news brief refresh still running');return;}newsBriefRefreshRunning=true;try{await refreshDailyNewsBrief(bot);}catch(err){console.log('❌ Daily news brief refresh error:',err.message);}finally{newsBriefRefreshRunning=false;}});

  // Every hour, expire database access and remove the same users from the VIP
  // Telegram group/channel. Ban + immediate unban means they may rejoin after renewal.
  cron.schedule('5 * * * *',async()=>{
    try {
      const expiredUsers=expireVipUsers();
      if(expiredUsers.length===0)return;
      console.log(`⏰ Expired VIP users: ${expiredUsers.length}`);
      const results=await expireVipGroupMembers(bot,expiredUsers);
      const removed=results.filter(x=>x.ok).length;
      const failed=results.filter(x=>!x.ok&&!x.skipped).length;
      console.log(`👥 VIP group expiry sync | removed=${removed} failed=${failed}`);
      for(const item of results){if(item.error)console.log(`VIP group removal failed for ${item.telegramId}:`,item.error.message);}
    } catch(err) {
      console.log('❌ VIP expiration error:',err.message);
    }
  });

  // Strong Market Bias: scan continuously for quality, not at the top of the hour.
  // It never stacks its own trades; the service skips while one of its trades is open.
  cron.schedule('*/5 * * * *',async()=>{
    if(isForexWeekend())return;
    if(hourlyBiasRunning){console.log('⚠️ Previous Strong Market Bias scan still running - skipped');return;}
    hourlyBiasRunning=true;
    try{await runHourlyMarketBiasTrade(bot);}catch(err){console.log('❌ Strong Market Bias error:',err.message);}finally{hourlyBiasRunning=false;}
  });

  cron.schedule('* * * * *',async()=>{if(isForexWeekend()){console.log('🌙 Weekend: Gold Auto Scalper paused');return;}if(scanRunning){console.log('⚠️ Previous Gold Scalper scan still running - skipped');return;}scanRunning=true;const startTime=Date.now();console.log('⚡ AUTO GOLD SCALPER SCAN');try{await scanMarket(bot);console.log(`✅ Gold Scalper scan finished in ${((Date.now()-startTime)/1000).toFixed(1)}s`);}catch(err){console.log('❌ Gold Scalper scan error:',err.message);}finally{scanRunning=false;}});
  let smartAlertRunning=false;
  cron.schedule('*/5 * * * *',async()=>{if(smartAlertRunning){console.log('⚠️ Previous Smart Scanner Alert still running - skipped');return;}smartAlertRunning=true;console.log('🚨 PERSONALIZED SMART ALERT TRIGGERED');try{await runPersonalizedAlerts(bot);console.log('✅ Smart Scanner Alert finished');}catch(err){console.log('❌ Smart Scanner Alert error:',err.message);}finally{smartAlertRunning=false;}});
  cron.schedule('*/15 * * * * *',async()=>{if(isForexWeekend())return;if(monitorRunning){console.log('⚠️ Previous trade monitor still running - skipped');return;}monitorRunning=true;console.log('🔎 Checking open trades...');try{await monitorTrades(bot);console.log('✅ Trade monitor finished');}catch(err){console.log('❌ Trade monitor error:',err.message);}finally{monitorRunning=false;}});
  cron.schedule('*/2 * * * *',async()=>{if(shadowSystemRunning){console.log('👻 Previous Shadow Engine cycle still running - skipped');return;}shadowSystemRunning=true;try{const created=await collectShadowOpportunities();await monitorShadowTrades();if(created>0)console.log(`👻 Shadow Engine: ${created} new opportunity(s)`);}catch(error){console.log('❌ Shadow Decision Engine:',error.message);}finally{shadowSystemRunning=false;}});
  cron.schedule('*/2 * * * *',async()=>{if(opportunityTeaserRunning)return;opportunityTeaserRunning=true;try{await runOpportunityTeaser(bot);}catch(error){console.log('❌ Public Opportunity Teaser:',error.message);}finally{opportunityTeaserRunning=false;}});
  cron.schedule('*/2 * * * *',async()=>{if(radarMonitorRunning){console.log('⚠️ Previous Opportunity Radar monitor still running - skipped');return;}radarMonitorRunning=true;try{await monitorOpportunityRadar(bot);}catch(error){console.log('❌ Opportunity Radar monitor:',error.message);}finally{radarMonitorRunning=false;}});
  cron.schedule('*/30 * * * * *',async()=>{if(isForexWeekend())return;if(copilotMonitorRunning){console.log('⚠️ Previous Copilot monitor still running - skipped');return;}copilotMonitorRunning=true;try{await monitorCopilotTrades(bot);}catch(error){console.log('❌ Trade Copilot monitor error:',error.message);}finally{copilotMonitorRunning=false;}});
}
module.exports=startScheduler;
