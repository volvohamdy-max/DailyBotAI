const config = require('../config');
const { findUser } = require('../database/users');

function isAdmin(id) {
  return config.adminIds.includes(String(id));
}

function requireAdmin(ctx, silent = false) {

    if (!isAdmin(ctx.from.id)) {

        if(!silent){
            ctx.reply('هذا الأمر للأدمن فقط.');
        }

        return false;
    }

    return true;
}
function isVip(telegramId) {
  const user = findUser(telegramId);
  return Boolean(user && user.is_vip && (!user.vip_expires_at || new Date(user.vip_expires_at) > new Date()));
}

module.exports = { isAdmin, requireAdmin, isVip };
