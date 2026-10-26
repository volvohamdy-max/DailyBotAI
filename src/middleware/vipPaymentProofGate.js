const config = require('../config');
const { findUser } = require('../database/users');
const { getPendingVipRequest, attachProofToPendingRequest } = require('../services/vipService');
const { trackVipProof } = require('../services/promoAnalytics');

function isMediaMessage(ctx) {
  return Boolean(ctx.message?.photo?.length || ctx.message?.document);
}

function paymentProofGate() {
  return async (ctx, next) => {
    if (!isMediaMessage(ctx)) return next();

    const userId = ctx.from?.id;
    if (!userId) return next();

    const pending = getPendingVipRequest(userId);

    // Important: a random photo/document is NOT a payment proof.
    // Consume nothing here; simply let future non-payment media handlers decide.
    // userLegacy's old generic proof handler is registered later, so we must stop
    // this update here to prevent it from creating a fake manual VIP request.
    if (!pending) {
      console.log(`🖼️ Media ignored by VIP payment gate | user=${userId} | no pending payment`);
      return;
    }

    const fileId = ctx.message.photo?.at(-1)?.file_id || ctx.message.document?.file_id;
    if (!fileId) return;

    const caption = String(ctx.message.caption || '').slice(0, 1000);
    const updated = attachProofToPendingRequest(userId, fileId, caption);
    if (!updated) {
      return ctx.reply(
        findUser(userId)?.language === 'en'
          ? '⚠️ No active VIP payment request was found. Please choose a VIP plan first.'
          : '⚠️ لا يوجد طلب دفع VIP نشط. اختر باقة VIP أولًا.'
      );
    }

    trackVipProof(userId, updated.plan_key);

    const info = `📥 إثبات دفع VIP جديد\n\n👤 الاسم: ${ctx.from.first_name || ''}\n🆔 ID: ${userId}\n👤 Username: @${ctx.from.username || 'لا يوجد'}\n💎 الخطة: ${updated.plan_key}\n🧾 Request ID: ${updated.id}\n\n📝 ملاحظة:\n${caption || 'لا يوجد'}`;

    for (const adminId of config.adminIds || []) {
      try {
        await ctx.telegram.sendMessage(adminId, info);
        await ctx.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id);
      } catch (error) {
        console.log(`VIP proof forward to ${adminId} failed:`, error.message);
      }
    }

    return ctx.reply(
      findUser(userId)?.language === 'en'
        ? '✅ Payment proof received. The administration will review your selected VIP plan.'
        : '✅ تم استلام إثبات الدفع. سيتم مراجعة باقة VIP التي اخترتها وتفعيل الاشتراك بعد المراجعة.'
    );
  };
}

module.exports = paymentProofGate;
