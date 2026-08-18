const { Markup } = require('telegraf');

function adminV2Keyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Dashboard', 'adminv2_dashboard'),
      Markup.button.callback('📈 الصفقات الحية', 'adminv2_live')
    ],
    [
      Markup.button.callback('📉 الأداء', 'adminv2_performance'),
      Markup.button.callback('🧠 قرارات الإشارات', 'adminv2_decisions')
    ],
    [
      Markup.button.callback('👥 المستخدمون / VIP', 'adminv2_users'),
      Markup.button.callback('📰 الأخبار', 'adminv2_news')
    ],
    [
      Markup.button.callback('🎛️ التحكم', 'adminv2_controls'),
      Markup.button.callback('🩺 System Health', 'adminv2_health')
    ],
    [
      Markup.button.callback('🔄 تحديث', 'adminv2_dashboard')
    ]
  ]);
}

function controlsKeyboard(settings = {}) {
  const auto = settings.auto_signals_enabled === '1';
  const breaking = settings.breaking_news_enabled === '1';
  const maintenance = settings.maintenance_mode === '1';

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `${auto ? '🟢' : '🔴'} Auto Signals`,
        'adminv2_toggle_auto'
      ),
      Markup.button.callback(
        `${breaking ? '🟢' : '🔴'} Breaking News`,
        'adminv2_toggle_breaking'
      )
    ],
    [
      Markup.button.callback('➖ AI', 'adminv2_ai_down'),
      Markup.button.callback(`🤖 AI ${settings.min_ai_confidence || 60}%`, 'adminv2_controls'),
      Markup.button.callback('➕ AI', 'adminv2_ai_up')
    ],
    [
      Markup.button.callback('➖ Gold Risk', 'adminv2_risk_down'),
      Markup.button.callback(
        `🥇 ${settings.gold_max_risk_pct || '0.35'}%`,
        'adminv2_controls'
      ),
      Markup.button.callback('➕ Gold Risk', 'adminv2_risk_up')
    ],
    [
      Markup.button.callback(
        `${maintenance ? '🟠' : '⚪'} Maintenance`,
        'adminv2_toggle_maintenance'
      )
    ],
    [
      Markup.button.callback('⬅️ رجوع', 'adminv2_dashboard')
    ]
  ]);
}

module.exports = {
  adminV2Keyboard,
  controlsKeyboard
};
