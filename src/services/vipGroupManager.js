const config = require('../config');

function vipChatId() {
  return config.vipGroupId || config.vipChannelId || null;
}

async function removeFromVipGroup(bot, telegramId) {
  const chatId = vipChatId();
  if (!chatId) return { ok: false, skipped: true, reason: 'VIP_GROUP_ID/VIP_CHANNEL_ID is not configured' };

  try {
    // Telegram has no direct "kick but allow rejoin" call. Ban then immediately
    // unban removes the member while allowing a future invite after renewal.
    await bot.telegram.banChatMember(chatId, Number(telegramId));
    await bot.telegram.unbanChatMember(chatId, Number(telegramId), { only_if_banned: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

async function sendVipInvite(bot, telegramId) {
  const chatId = vipChatId();
  if (!chatId) return { ok: false, skipped: true, reason: 'VIP_GROUP_ID/VIP_CHANNEL_ID is not configured' };

  try {
    // A one-use link prevents subscribers from freely forwarding the VIP invite.
    const invite = await bot.telegram.createChatInviteLink(chatId, {
      member_limit: 1,
      name: `VIP ${telegramId}`
    });
    await bot.telegram.sendMessage(
      telegramId,
      `💎 تم تفعيل اشتراك VIP الخاص بك.\n\n🔐 رابط الدخول الخاص بك إلى جروب VIP:\n${invite.invite_link}\n\n⚠️ الرابط مخصص لاستخدام واحد فقط.`
    );
    return { ok: true, inviteLink: invite.invite_link };
  } catch (error) {
    return { ok: false, error };
  }
}

async function expireVipGroupMembers(bot, expiredUsers) {
  const results = [];
  for (const user of expiredUsers || []) {
    const telegramId = String(user.telegram_id);
    const removal = await removeFromVipGroup(bot, telegramId);
    results.push({ telegramId, ...removal });

    try {
      await bot.telegram.sendMessage(
        telegramId,
        '⏰ انتهى اشتراك VIP الخاص بك.\n\nتم إيقاف دخولك إلى جروب VIP مؤقتًا حتى التجديد.\n\n💎 للتجديد استخدم /vip وبعد تأكيد الدفع سيصلك رابط دخول جديد.'
      );
    } catch (error) {
      console.log(`VIP expiry message failed for ${telegramId}:`, error.message);
    }
  }
  return results;
}

module.exports = {
  vipChatId,
  removeFromVipGroup,
  sendVipInvite,
  expireVipGroupMembers
};
