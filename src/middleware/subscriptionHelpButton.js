const { Markup } = require('telegraf');

const SUPPORT_URL = 'https://t.me/Forexai_support';

function isSubscriptionStep(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;

  return [
    'payment method',
    'طريقة الدفع',
    'after payment',
    'بعد التحويل',
    'payment proof',
    'إثبات الدفع',
    'payment proof received',
    'تم استلام إثبات الدفع',
    'usdt',
    'trc20'
  ].some((token) => value.includes(token));
}

function helpKeyboard(en = false) {
  return Markup.inlineKeyboard([
    [Markup.button.url(en ? '💬 Subscription Help' : '💬 مساعدة الاشتراك', SUPPORT_URL)]
  ]);
}

function subscriptionHelpButton() {
  return async (ctx, next) => {
    const originalReply = ctx.reply.bind(ctx);

    ctx.reply = (text, extra) => {
      if (!isSubscriptionStep(text)) return originalReply(text, extra);

      const hasMarkup = Boolean(extra?.reply_markup);
      if (hasMarkup) return originalReply(text, extra);

      const en = String(text || '').toLowerCase().includes('payment') ||
        String(text || '').toLowerCase().includes('subscription');

      return originalReply(text, helpKeyboard(en));
    };

    return next();
  };
}

module.exports = subscriptionHelpButton;
