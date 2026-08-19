const { Telegraf } = require('telegraf');
const config = require('./config');
const initDatabase = require('./database/init');
const db = require('./database/db');
const registerStart = require('./commands/start');
const registerUserCommands = require('./commands/user');
const registerPerformance = require('./commands/performance');
const registerSlashCommands = require('./commands/slashCommands');
const registerMarketMap = require('./commands/marketMap');
const registerTrendHunter = require('./commands/trendHunter');
const registerOpportunityRadar = require('./commands/opportunityRadar');
const registerAdaptiveIntelligence = require('./commands/adaptiveIntelligence');
const registerShadowAudit = require('./commands/shadowAudit');
const registerReport14 = require('./commands/report14');
const registerAlerts = require('./commands/alerts');
const registerSettings = require('./commands/settings');
const registerAdminCommands = require('./admin/adminCommands');
const registerTradeAdminControls = require('./admin/tradeAdminControls');
const { registerAdminV21 } = require('./admin/adminControlCenterV21');
const { getBoolSetting: getAdminBoolSetting } = require('./database/adminControl');
const startScheduler = require('./services/scheduler');
const { startBreakingNews } = require('./services/breakingNewsService');
const languageRouter = require('./utils/languageRouter');
const registerVirtualPortfolio = require('./commands/virtualPortfolio');
const { registerStrategyLab } = require('./handlers/myStrategy');

function removeLegacyGoldPowerData() {
  try {
    const powerTrades = db.prepare(`
      SELECT id
      FROM trades
      WHERE UPPER(COALESCE(telegram_id, '')) = 'VIP_POWER'
    `).all();

    if (!powerTrades.length) return;

    db.prepare(`
      UPDATE trades
      SET status = 'cancelled'
      WHERE UPPER(COALESCE(telegram_id, '')) = 'VIP_POWER'
        AND status IN ('open', 'secured', 'target1')
    `).run();

    try {
      const deletePerformance = db.prepare(
        'DELETE FROM trade_performance WHERE trade_id = ?'
      );

      for (const trade of powerTrades) {
        deletePerformance.run(Number(trade.id));
      }
    } catch (error) {
      console.log(
        '⚠️ GOLD POWER performance cleanup skipped:',
        error.message
      );
    }

    console.log(
      `🧹 GOLD POWER removed | ${powerTrades.length} legacy trade record(s) excluded from performance`
    );
  } catch (error) {
    console.log(
      '⚠️ GOLD POWER legacy cleanup skipped:',
      error.message
    );
  }
}

async function main() {
  console.log('Starting Telegram Forex AI bot...');

  if (!config.botToken) {
    console.error('BOT_TOKEN is required. Copy .env.example to .env and configure it.');
    process.exit(1);
  }

  await db.ready;
  initDatabase();
  removeLegacyGoldPowerData();
  console.log('Database is ready.');

  const bot = new Telegraf(config.botToken);

  await bot.telegram.setMyCommands([
    { command: 'start', description: '🚀 Start / بدء' },
    { command: 'menu', description: '📋 Main menu / القائمة الرئيسية' },
    { command: 'trade', description: '⚡ Best trade / أفضل صفقة' },
    { command: 'scanner', description: '🔎 Smart Scanner / الماسح الذكي' },
    { command: 'strategy', description: '🧪 Gold Strategy Lab / استراتيجيتي' },
    { command: 'radar', description: '📡 Opportunity Radar / رادار الفرص' },
    { command: 'adaptive', description: '🧠 Adaptive Intelligence / الذكاء المتكيف' },
    { command: 'trend', description: '📡 Trend Hunter / صياد الترند' },
    { command: 'map', description: '🧭 Market Map / خريطة السوق' },
    { command: 'analysis', description: '📈 Analyze asset / تحليل أصل' },
    { command: 'gold', description: '🥇 XAUUSD analysis / تحليل الذهب' },
    { command: 'news', description: '📰 Economic news / الأخبار' },
    { command: 'alerts', description: '🔔 Alerts / التنبيهات' },
    { command: 'performance', description: '📊 Performance / الأداء' },
    { command: 'status', description: '👤 Account / الحساب' },
    { command: 'ref', description: '🔗 Referral / الإحالة' },
    { command: 'vip', description: '💎 VIP' },
    { command: 'help', description: 'ℹ️ Help / المساعدة' }
  ]);

  console.log('Commands menu set');

  bot.use(async (ctx, next) => {
    const maintenance = getAdminBoolSetting('maintenance_mode', false);
    const isAdmin = (config.adminIds || [])
      .map(String)
      .includes(String(ctx.from?.id));

    if (maintenance && !isAdmin) {
      return ctx.reply('🛠️ FOREX AI تحت الصيانة حاليًا. حاول مرة أخرى بعد قليل.\n\nMaintenance Mode is active.');
    }

    return next();
  });

  // Must run before text handlers.
  bot.use(languageRouter());

  registerStart(bot);
  registerSettings(bot);
  registerAlerts(bot);
  registerTrendHunter(bot);
  registerOpportunityRadar(bot);
  registerAdaptiveIntelligence(bot);
  registerShadowAudit(bot);
  registerReport14(bot);
  registerMarketMap(bot);
  registerStrategyLab(bot);
  registerSlashCommands(bot);
  registerUserCommands(bot);
  registerPerformance(bot);
  registerAdminCommands(bot);
  registerTradeAdminControls(bot);
  registerAdminV21(bot);

  console.log('Commands are registered.');

  bot.catch((error, ctx) => {
    console.error(`Bot error for update ${ctx.update.update_id}:`, error);
    ctx.reply('حدث خطأ مؤقت / Temporary error. Try again.').catch(() => null);
  });

  startScheduler(bot);
  startBreakingNews(bot);
  console.log('Scheduler started.');

  try {
registerVirtualPortfolio(bot);

    await bot.launch();
    console.log('Telegram Forex AI bot is running. Open Telegram and send /start.');
  } catch (error) {
    console.error('Failed to launch Telegram bot. Check BOT_TOKEN and internet connection.');
    console.error(error.message);
    process.exit(1);
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();
