const { Markup } = require('telegraf');
const { findUser } = require('../database/users');

function isEnglish(ctx) {
  return findUser(ctx.from?.id)?.language === 'en';
}

function vipOfferKeyboard(en = false) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(en ? '💎 1 Month — $29.99' : '💎 شهر — $29.99', 'vip_monthly')],
    [Markup.button.callback(en ? '🔥 3 Months — $74.99 (Save $15)' : '🔥 3 شهور — $74.99 (وفر $15)', 'vip_quarterly')],
    [Markup.button.callback(en ? '👑 1 Year — $249.99 (Save $110)' : '👑 سنة — $249.99 (وفر $110)', 'vip_yearly')],
    [Markup.button.url(en ? '💬 Subscription Help' : '💬 مساعدة الاشتراك', 'https://t.me/Forexai_support')]
  ]);
}

function vipOfferText(en = false) {
  if (en) return `💎 FOREX AI — VIP
━━━━━━━━━━━━━━━━━━

Turn the bot into your complete trading assistant — with a special focus on GOLD 🥇

🥇 VIP GOLD TOOLS
🚨 Gold Zone Radar — direct READY opportunity alerts
⭐ Best Gold Trade Now
🥇 Check Your Trade — BUY / SELL multi-timeframe analysis
🤖 Trade Copilot — monitor your Gold trade as market conditions change
🎯 Daily Gold Plan
🧱 Strong Gold Support & Resistance
📊 Gold Top-Down Analysis
💰 Available Gold Trades

🧠 ADVANCED MARKET TOOLS
🔎 Full Smart Scanner
📡 Opportunity Radar
⚡ Trading Center tools
🧠 Advanced market analysis and opportunity scoring
🔔 VIP opportunity alerts

📌 Trade analysis may include:
💰 Entry | 🛑 SL | 🎯 TP1 | 🏆 TP2
⭐ Opportunity strength | 📊 Multi-timeframe confirmation

━━━━━━━━━━━━━━━━━━
🔥 VIP PLANS

💎 1 Month — $29.99
🔥 3 Months — $74.99 — Save $15
👑 1 Year — $249.99 — Save $110

💳 Payment: USDT — TRC20
📸 After payment, send the proof in the bot for admin activation.
💬 Need subscription help? Contact @Forexai_support

⚠️ FOREX AI provides automated market analysis and decision-support tools. It does not guarantee profit.

👇 Choose your VIP plan:`;

  return `💎 FOREX AI — VIP
━━━━━━━━━━━━━━━━━━

حوّل البوت لمساعد تداول متكامل مع تركيز قوي على الذهب 🥇

🥇 أدوات الذهب VIP
🚨 رادار مناطق الذهب — تنبيه مباشر عند ظهور فرصة READY
⭐ أفضل صفقة ذهب الآن
🥇 اختبر صفقتك — BUY / SELL بتحليل شامل لكل الفريمات
🤖 راقب صفقتي — Trade Copilot لمتابعة صفقة الذهب مع تغير السوق
🎯 خطة الذهب اليومية
🧱 أقوى مستويات الدعم والمقاومة
📊 تحليل الذهب Top-Down
💰 صفقات الذهب المتاحة

🧠 أدوات السوق المتقدمة
🔎 Smart Scanner كامل
📡 Opportunity Radar
⚡ أدوات مركز التداول
🧠 تحليلات متقدمة وتقييم قوة الفرص
🔔 تنبيهات فرص VIP

📌 التحليل قد يشمل:
💰 Entry | 🛑 SL | 🎯 TP1 | 🏆 TP2
⭐ قوة الفرصة | 📊 تأكيد متعدد الفريمات

━━━━━━━━━━━━━━━━━━
🔥 خطط VIP

💎 شهر — $29.99
🔥 3 شهور — $74.99 — وفر $15
👑 سنة — $249.99 — وفر $110

💳 الدفع: USDT — TRC20
📸 بعد التحويل ابعت إثبات الدفع داخل البوت لتفعيل الاشتراك من الإدارة.
💬 لو محتاج مساعدة في الاشتراك تواصل مع @Forexai_support

⚠️ FOREX AI يقدم تحليلات آلية وأدوات مساعدة لاتخاذ القرار، ولا يضمن تحقيق أرباح.

👇 اختر خطة الاشتراك:`;
}

function registerVipOffer(bot) {
  const send = ctx => {
    const en = isEnglish(ctx);
    return ctx.reply(vipOfferText(en), vipOfferKeyboard(en));
  };

  // Registered before legacy user handlers so this launch-ready offer is the
  // single public VIP sales page for both the slash command and menu button.
  bot.command('vip', send);
  bot.hears('💎 VIP', send);
}

module.exports = registerVipOffer;
