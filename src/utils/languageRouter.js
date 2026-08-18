// Compatibility layer for existing handlers in src/commands/user.js.
// It lets the new English keyboard call the current Arabic handlers without
// rewriting the 1000+ line user command file in Sprint 1.
//
// Important: this translates BUTTON INPUT only. Some old handler output text
// will still be Arabic until Sprint 2 moves those messages into locales.

const englishToLegacy = new Map([
  ['⚡ Trade Now', '⚡ صفقة الآن'],
  ['📈 Market Analysis', '📈 تحليل'],
  ['🔎 Smart Scanner', '🔎 Smart Scanner'],
  ['🧪 AI Signal Lab', '🧪 AI Signal Lab'],
  ['💎 VIP', '💎 VIP'],
  ['👤 My Account', '👤 حالة الحساب'],
  ['🔗 Referral', '🔗 الإحالة'],
  ['🎧 Support', '🎧 الدعم']
]);

function languageRouter() {
  return async (ctx, next) => {
    if (ctx.message && typeof ctx.message.text === 'string') {
      const legacyText = englishToLegacy.get(ctx.message.text);
      if (legacyText) {
        ctx.message.text = legacyText;
      }
    }

    return next();
  };
}

module.exports = languageRouter;
