const db = require('./db');
const config = require('../config');

function referralCode(telegramId) {
  return `ref_${telegramId}`;
}

function isVipActive(user) {
  if (!user || Number(user.is_vip) !== 1) return false;
  if (!user.vip_expires_at) return true;
  const expiry = new Date(user.vip_expires_at).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

function findUser(telegramId) {
  const id = String(telegramId);
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(id);
  if (!user) return user;

  // Make every legacy `user.is_vip` check expiry-safe. Once an expired
  // membership is observed, normalize it in the database immediately.
  if (Number(user.is_vip) === 1 && !isVipActive(user)) {
    db.prepare(`
      UPDATE users
      SET is_vip = 0, vip_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).run(id);
    return { ...user, is_vip: 0, vip_expires_at: null };
  }

  return user;
}

function createOrUpdateUser(from, startPayload) {
  const telegramId = String(from.id);
  const existing = findUser(telegramId);
  const code = referralCode(telegramId);
  const referrerCode = startPayload && startPayload.startsWith('ref_') ? startPayload : null;

  if (!existing) {
    db.prepare(`
      INSERT INTO users (telegram_id, first_name, username, referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(telegramId, from.first_name || '', from.username || '', code, referrerCode);

    if (referrerCode && referrerCode !== code) {
      const referrer = db.prepare('SELECT * FROM users WHERE referral_code = ?').get(referrerCode);

      if (referrer) {
        const referralResult = db.prepare(`
          INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward_points)
          VALUES (?, ?, ?)
        `).run(referrer.telegram_id, telegramId, config.referralRewardPoints);

        if (referralResult.changes > 0) {
          db.prepare(`
            UPDATE users
            SET points = points + ?, updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `).run(config.referralRewardPoints, referrer.telegram_id);

          checkReferralReward(referrer.telegram_id);
        }
      }
    }
  } else {
    db.prepare(`
      UPDATE users
      SET first_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).run(from.first_name || '', from.username || '', telegramId);

    if (referrerCode && referrerCode !== code && !existing.referred_by) {
      const alreadyReferred = db.prepare(`
        SELECT 1 FROM referrals WHERE referred_id = ? LIMIT 1
      `).get(telegramId);

      const referrer = db.prepare(`
        SELECT * FROM users WHERE referral_code = ?
      `).get(referrerCode);

      if (!alreadyReferred && referrer) {
        const referralResult = db.prepare(`
          INSERT OR IGNORE INTO referrals
            (referrer_id, referred_id, reward_points)
          VALUES (?, ?, ?)
        `).run(referrer.telegram_id, telegramId, config.referralRewardPoints);

        if (referralResult.changes > 0) {
          db.prepare(`
            UPDATE users SET referred_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `).run(referrerCode, telegramId);

          db.prepare(`
            UPDATE users SET points = points + ?, updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `).run(config.referralRewardPoints, referrer.telegram_id);

          checkReferralReward(referrer.telegram_id);
        }
      }
    }
  }

  return findUser(telegramId);
}

function setLanguage(telegramId, language) {
  const normalized = language === 'en' ? 'en' : 'ar';
  db.prepare(`
    UPDATE users SET language = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(normalized, String(telegramId));
  return findUser(telegramId);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
}

function allUsers(options = {}) {
  if (options.vipOnly) {
    return db.prepare(`
      SELECT telegram_id FROM users
      WHERE is_vip = 1
        AND (vip_expires_at IS NULL OR vip_expires_at > datetime('now'))
    `).all();
  }
  return db.prepare('SELECT telegram_id FROM users').all();
}

function addPoints(telegramId, points) {
  db.prepare(`
    UPDATE users SET points = points + ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(Number(points), String(telegramId));

  const user = findUser(telegramId);
  if (user && user.points >= 200 && !isVipActive(user)) {
    addVip(telegramId, 14);
    db.prepare('UPDATE users SET points = 0 WHERE telegram_id = ?').run(String(telegramId));
  }
  return findUser(telegramId);
}

function addVip(telegramId, days) {
  const expires = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE users SET is_vip = 1, vip_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(expires, String(telegramId));
  return expires;
}

function removeVip(telegramId) {
  db.prepare(`
    UPDATE users SET is_vip = 0, vip_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(String(telegramId));
}

function expireVipUsers() {
  const expiredUsers = db.prepare(`
    SELECT telegram_id FROM users
    WHERE is_vip = 1 AND vip_expires_at IS NOT NULL
      AND datetime(vip_expires_at) <= datetime('now')
  `).all();

  db.prepare(`
    UPDATE users
    SET is_vip = 0, vip_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE is_vip = 1 AND vip_expires_at IS NOT NULL
      AND datetime(vip_expires_at) <= datetime('now')
  `).run();
  return expiredUsers;
}

function checkReferralReward(telegramId) {
  const user = findUser(telegramId);
  if (!user || user.points < 200) return false;
  db.prepare('UPDATE users SET points = points - 200 WHERE telegram_id = ?').run(String(telegramId));
  addVip(telegramId, 14);
  return true;
}

function getStats() {
  expireVipUsers();
  const total = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const vip = db.prepare(`
    SELECT COUNT(*) AS c FROM users
    WHERE is_vip = 1
      AND (vip_expires_at IS NULL OR datetime(vip_expires_at) > datetime('now'))
  `).get().c;
  const points = db.prepare('SELECT SUM(points) AS p FROM users').get().p || 0;
  return { total, vip, points };
}

module.exports = {
  referralCode,
  findUser,
  isVipActive,
  createOrUpdateUser,
  setLanguage,
  countUsers,
  allUsers,
  addVip,
  removeVip,
  expireVipUsers,
  checkReferralReward,
  getStats,
  addPoints
};
