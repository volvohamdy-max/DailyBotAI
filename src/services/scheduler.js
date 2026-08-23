const cron = require('node-cron');
const {
  isForexWeekend
} = require('../utils/marketHours');

const { expireVipUsers } = require('../database/users');
const { scanMarket } = require('./autoSignals');
const { monitorTrades } = require('./tradeMonitor');
const { monitorCopilotTrades } = require('./tradeCopilotScaled');
const { monitorOpportunityRadar } = require('./opportunityRadar');
const { runOpportunityTeaser } = require('./opportunityTeaser');
const { collectShadowOpportunities } = require('./shadowOpportunityCollector');
const { monitorShadowTrades } = require('./shadowTradeEngine');
const { runPersonalizedAlerts } = require('./personalizedAlerts');

const {
    checkEconomicNews
} = require('./newsService');
const { checkUpcomingNewsReliable } = require('./reliableUpcomingNews');
const { refreshDailyNewsBrief } = require('./dailyNewsBriefService');

let scanRunning = false;
let newsRunning = false;
let newsBriefRefreshRunning = false;
let monitorRunning = false;
let copilotMonitorRunning = false;
let radarMonitorRunning = false;
let opportunityTeaserRunning = false;
let shadowSystemRunning = false;

function startScheduler(bot) {

    console.log("⏰ Scheduler started");

    // =========================
    // الأخبار - كل 5 دقائق
    // Release + upcoming checks are independent so one slow/failing
    // path does not block the other.
    // =========================

    cron.schedule('*/5 * * * *', async () => {

        if (newsRunning) {
            console.log("⚠️ Previous news check still running");
            return;
        }

        newsRunning = true;

        console.log("📰 Checking economic news...");

        try {

            const results = await Promise.allSettled([
                checkEconomicNews(bot),
                checkUpcomingNewsReliable(bot)
            ]);

            const labels = ['release', 'upcoming'];
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.log(
                        `❌ News ${labels[index]} path error:`,
                        result.reason?.message || result.reason
                    );
                }
            });

            console.log("✅ News check finished");

        } catch (err) {

            console.log(
                "❌ News error:",
                err.message
            );

        } finally {

            newsRunning = false;

        }

    });

    // =========================
    // تحديث رسالة الأخبار اليومية المثبتة
    // كل 10 دقائق طوال اليوم.
    // Independent lock: a slow refresh never blocks urgent alerts.
    // =========================

    cron.schedule('*/10 * * * *', async () => {

        if (newsBriefRefreshRunning) {
            console.log('⚠️ Previous daily news brief refresh still running');
            return;
        }

        newsBriefRefreshRunning = true;

        try {
            await refreshDailyNewsBrief(bot);
        } catch (err) {
            console.log(
                '❌ Daily news brief refresh error:',
                err.message
            );
        } finally {
            newsBriefRefreshRunning = false;
        }

    });


    // =========================
    // VIP expiration - كل ساعة
    // =========================

    cron.schedule('5 * * * *', async () => {

        try {

            const expiredUsers = expireVipUsers();

            if (expiredUsers.length > 0) {

                console.log(
                    `✅ Expired VIP users: ${expiredUsers.length}`
                );

                for (const user of expiredUsers) {

                    try {

                        await bot.telegram.sendMessage(
                            user.telegram_id,
                            `⏰ انتهى اشتراك VIP الخاص بك.\n\nيمكنك التجديد من خلال:\n💎 /vip`
                        );

                    } catch (e) {

                        console.log(
                            "VIP message error:",
                            e.message
                        );

                    }

                }

            }

        } catch (err) {

            console.log(
                "❌ VIP expiration error:",
                err.message
            );

        }

    });


    // =========================
    // Gold Scalper Scan - كل دقيقة
    // =========================

// =========================
// AUTO GOLD SCALPER - every 1 minute
// =========================

cron.schedule('* * * * *', async () => {

    if (isForexWeekend()) {
        console.log(
            '🌙 Weekend: Gold Auto Scalper paused'
        );
        return;
    }

    if (scanRunning) {
        console.log(
            '⚠️ Previous Gold Scalper scan still running - skipped'
        );
        return;
    }

    scanRunning = true;

    const startTime = Date.now();

    console.log(
        '⚡ AUTO GOLD SCALPER SCAN'
    );

    try {

        await scanMarket(bot);

        const duration =
            ((Date.now() - startTime) / 1000)
                .toFixed(1);

        console.log(
            `✅ Gold Scalper scan finished in ${duration}s`
        );

    } catch (err) {

        console.log(
            '❌ Gold Scalper scan error:',
            err.message
        );

    } finally {

        scanRunning = false;
    }
});

// =========================
// Smart Scanner Auto Alert - كل 5 دقائق
// =========================

let smartAlertRunning = false;

cron.schedule('*/5 * * * *', async () => {

    if (smartAlertRunning) {
        console.log(
            '⚠️ Previous Smart Scanner Alert still running - skipped'
        );
        return;
    }

    smartAlertRunning = true;

    console.log(
        '🚨 PERSONALIZED SMART ALERT TRIGGERED'
    );

    try {

        await runPersonalizedAlerts(bot);

        console.log(
            '✅ Smart Scanner Alert finished'
        );

    } catch (err) {

        console.log(
            '❌ Smart Scanner Alert error:',
            err.message
        );

    } finally {

        smartAlertRunning = false;

    }

});

    // =========================
    // Trade Monitor - كل 15 ثانية
    // =========================

    cron.schedule('*/15 * * * * *', async () => {

        if (isForexWeekend()) {
            return;
        }

        if (monitorRunning) {

            console.log(
                "⚠️ Previous trade monitor still running - skipped"
            );

            return;
        }

        monitorRunning = true;

        console.log(
            "🔎 Checking open trades..."
        );

        try {

            await monitorTrades(bot);

            console.log(
                "✅ Trade monitor finished"
            );

        } catch (err) {

            console.log(
                "❌ Trade monitor error:",
                err.message
            );

        } finally {

            monitorRunning = false;

        }

    });


  // =========================
// =========================
// =========================
// SHADOW DECISION ENGINE
// every 2 minutes
// =========================

cron.schedule('*/2 * * * *', async () => {

  if (shadowSystemRunning) {
    console.log(
      '👻 Previous Shadow Engine cycle still running - skipped'
    );
    return;
  }

  shadowSystemRunning = true;

  try {

    const created =
      await collectShadowOpportunities();

    await monitorShadowTrades();

    if (created > 0) {
      console.log(
        `👻 Shadow Engine: ${created} new opportunity(s)`
      );
    }

  } catch (error) {

    console.log(
      '❌ Shadow Decision Engine:',
      error.message
    );

  } finally {

    shadowSystemRunning = false;
  }

});

// =========================
// PUBLIC OPPORTUNITY TEASER
// every 2 minutes
// =========================

cron.schedule('*/2 * * * *', async () => {

  if (opportunityTeaserRunning) {
    return;
  }

  opportunityTeaserRunning = true;

  try {
    await runOpportunityTeaser(bot);

  } catch (error) {
    console.log(
      '❌ Public Opportunity Teaser:',
      error.message
    );

  } finally {
    opportunityTeaserRunning = false;
  }
});

// OPPORTUNITY RADAR MONITOR
// every 2 minutes
// =========================

cron.schedule('*/2 * * * *', async () => {
  if (radarMonitorRunning) {
    console.log(
      '⚠️ Previous Opportunity Radar monitor still running - skipped'
    );
    return;
  }

  radarMonitorRunning = true;

  try {
    await monitorOpportunityRadar(bot);

  } catch (error) {
    console.log(
      '❌ Opportunity Radar monitor:',
      error.message
    );

  } finally {
    radarMonitorRunning = false;
  }
});

  // AI Trade Copilot - every 30 seconds
  // =========================

  cron.schedule('*/30 * * * * *', async () => {

    if (isForexWeekend()) {
        return;
    }

    if (copilotMonitorRunning) {
      console.log(
        '⚠️ Previous Copilot monitor still running - skipped'
      );
      return;
    }

    copilotMonitorRunning = true;

    try {
      await monitorCopilotTrades(bot);
    } catch (error) {
      console.log(
        '❌ Trade Copilot monitor error:',
        error.message
      );
    } finally {
      copilotMonitorRunning = false;
    }
  });

}

module.exports = startScheduler;
