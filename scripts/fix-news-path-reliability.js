const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/services/scheduler.js');
let s = fs.readFileSync(file, 'utf8');

const importOld = "const { checkUpcomingNewsReliable } = require('./reliableUpcomingNews');";
const importNew = `${importOld}\nconst { refreshDailyNewsBrief } = require('./dailyNewsBriefService');`;
if (!s.includes("refreshDailyNewsBrief } = require('./dailyNewsBriefService')")) {
  if (!s.includes(importOld)) throw new Error('scheduler news import marker not found');
  s = s.replace(importOld, importNew);
}

const sequential = `            await checkEconomicNews(bot);\n            await checkUpcomingNewsReliable(bot);`;
const parallel = `            const newsResults = await Promise.allSettled([\n                checkEconomicNews(bot),\n                checkUpcomingNewsReliable(bot)\n            ]);\n\n            for (const result of newsResults) {\n                if (result.status === 'rejected') {\n                    console.log('⚠️ News sub-task failed:', result.reason?.message || result.reason);\n                }\n            }`;
if (s.includes(sequential)) s = s.replace(sequential, parallel);
if (!s.includes('Promise.allSettled([\n                checkEconomicNews(bot)')) {
  throw new Error('failed to patch parallel news checks');
}

const marker = `\n\n    // =========================\n    // VIP expiration - كل ساعة`;
const refreshBlock = `\n\n    // =========================\n    // DAILY PINNED NEWS REFRESH\n    // كل 10 دقائق من 08:07 حتى 23:57 بتوقيت القاهرة\n    // =========================\n    cron.schedule('7,17,27,37,47,57 8-23 * * *', async () => {\n        try {\n            await refreshDailyNewsBrief(bot);\n        } catch (err) {\n            console.log('⚠️ Daily news brief refresh scheduler:', err.message);\n        }\n    }, { timezone: 'Africa/Cairo' });\n`;
if (!s.includes('DAILY PINNED NEWS REFRESH')) {
  if (!s.includes(marker)) throw new Error('scheduler VIP marker not found');
  s = s.replace(marker, refreshBlock + marker);
}

fs.writeFileSync(file, s);
console.log('✅ News path reliability patch applied');
console.log('   • release + upcoming checks run in parallel');
console.log('   • pinned daily brief refreshes every 10 minutes');
console.log('   • trading logic untouched');
