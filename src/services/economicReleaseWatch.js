const cron = require('node-cron');
const db = require('../database/db');
const config = require('../config');
const { getMultiSourceCalendar, eventHash, isHighImpact } = require('./newsCalendarGate');
const { translateToArabic } = require('./newsTranslator');
const { refreshDailyNewsBrief } = require('./dailyNewsBriefService');
const { getInvestingFallback } = require('./investingFallback');

const IMPORTANT = new Set(['USD','EUR','GBP','JPY','CHF']);
const TZ = 'Africa/Cairo';
const PENDING_TTL_MINUTES = Number(process.env.NEWS_PENDING_TTL_MINUTES) || 360;
let running = false;

function ensurePendingTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_news_releases (
      pending_id TEXT PRIMARY KEY,
      event_hash TEXT NOT NULL,
      currency TEXT NOT NULL,
      title TEXT NOT NULL,
      event_time TEXT NOT NULL,
      forecast TEXT,
      previous TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `).run();
}

function validActual(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return Boolean(s && s !== '-' && s.length <= 80 && /[-+]?\d/.test(s));
}
function seen(k) { return Boolean(db.prepare('SELECT 1 FROM news_alerts WHERE news_id=?').get(k)); }
function mark(k) { db.prepare('INSERT OR IGNORE INTO news_alerts(news_id,alert_sent) VALUES(?,1)').run(k); }
function impact(e) {
  const x = String(e.impact || '').toLowerCase();
  return isHighImpact(e) || x === 'high' ? 'high' : (x === 'medium' || x === 'med' ? 'medium' : 'low');
}
function flag(e) {
  const c = String(e.currency || '').toUpperCase();
  const title = String(e.title || '').toLowerCase();
  if (c === 'EUR') {
    if (/german|germany/.test(title)) return '🇩🇪';
    if (/french|france/.test(title)) return '🇫🇷';
    if (/italian|italy/.test(title)) return '🇮🇹';
    if (/spanish|spain/.test(title)) return '🇪🇸';
    return '🇪🇺';
  }
  return ({USD:'🇺🇸',GBP:'🇬🇧',JPY:'🇯🇵',CHF:'🇨🇭'})[c] || '🌍';
}
function countryName(e) {
  const c = String(e.currency || '').toUpperCase();
  const title = String(e.title || '').toLowerCase();
  if (c === 'EUR') {
    if (/german|germany/.test(title)) return 'ألمانيا';
    if (/french|france/.test(title)) return 'فرنسا';
    if (/italian|italy/.test(title)) return 'إيطاليا';
    if (/spanish|spain/.test(title)) return 'إسبانيا';
    return 'منطقة اليورو';
  }
  return ({USD:'الولايات المتحدة',GBP:'المملكة المتحدة',JPY:'اليابان',CHF:'سويسرا'})[c] || c;
}
async function arabicTitle(title) {
  const t = String(title || '').toLowerCase();
  const rules = [
    ['producer price index','مؤشر أسعار المنتجين'],['ppi','مؤشر أسعار المنتجين'],
    ['consumer price index','مؤشر أسعار المستهلكين'],['cpi','مؤشر أسعار المستهلكين'],
    ['retail sales','مبيعات التجزئة'],['unemployment rate','معدل البطالة'],
    ['jobless claims','طلبات إعانة البطالة'],['nonfarm payroll','الوظائف غير الزراعية'],
    ['gross domestic product','الناتج المحلي الإجمالي'],['gdp','الناتج المحلي الإجمالي'],
    ['manufacturing pmi','مؤشر مديري المشتريات الصناعي'],['services pmi','مؤشر مديري المشتريات الخدمي'],
    ['fomc minutes','محضر اجتماع الاحتياطي الفيدرالي'],['interest rate','قرار سعر الفائدة']
  ];
  for (const [en, ar] of rules) if (t.includes(en)) return ar;
  try { return (await translateToArabic(String(title || ''))) || String(title || 'خبر اقتصادي'); } catch { return String(title || 'خبر اقتصادي'); }
}
function num(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g,'').match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function interpretation(e) {
  const a = num(e.actual), f = num(e.forecast), c = String(e.currency || '').toUpperCase();
  if (a == null || f == null) return `صدرت القراءة الجديدة؛ راقب تأثيرها الفعلي على ${c}.`;
  const title = String(e.title || '').toLowerCase();
  const higherPositive = /ppi|producer price|cpi|consumer price|gdp|retail sales|pmi|employment change|average hourly/.test(title);
  const lowerPositive = /unemployment rate|jobless claims|unemployment claims/.test(title);
  let positive = null;
  if (higherPositive) positive = a > f ? true : a < f ? false : null;
  if (lowerPositive) positive = a < f ? true : a > f ? false : null;
  if (positive === true) return `القراءة جاءت أفضل من المتوقع، وهو عامل إيجابي مبدئيًا لـ ${c}.`;
  if (positive === false) return `القراءة جاءت أضعف من المتوقع، وهو عامل سلبي مبدئيًا لـ ${c}.`;
  return `القراءة جاءت قريبة من المتوقع؛ التأثير يعتمد على تفاصيل الإصدار ورد فعل السوق.`;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(final|prelim|preliminary|revised|flash)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);
  if (!aa || !bb) return 0;
  if (aa === bb || aa.includes(bb) || bb.includes(aa)) return 1;
  const aset = new Set(aa.split(' ').filter(x => x.length > 2));
  const bset = new Set(bb.split(' ').filter(x => x.length > 2));
  if (!aset.size || !bset.size) return 0;
  let common = 0;
  for (const token of aset) if (bset.has(token)) common++;
  return common / Math.max(aset.size, bset.size);
}

function snapshotFiveMinuteAlerts(events, now) {
  ensurePendingTable();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pending_news_releases
      (pending_id,event_hash,currency,title,event_time,forecast,previous,status)
    VALUES (?,?,?,?,?,?,?,'pending')
  `);

  for (const e of events || []) {
    const cur = String(e.currency || '').toUpperCase();
    if (!IMPORTANT.has(cur)) continue;
    if (impact(e) !== 'high') continue;
    const ts = new Date(e.date).getTime();
    if (!Number.isFinite(ts)) continue;
    const minutesTo = (ts - now) / 60000;
    if (minutesTo < -2 || minutesTo > 10) continue;

    const hash = eventHash(e);
    if (!seen(`news_5m_${hash}`)) continue;

    const pendingId = `pending_${hash}`;
    insert.run(
      pendingId,
      hash,
      cur,
      String(e.title || 'Economic event'),
      new Date(ts).toISOString(),
      e.forecast == null ? null : String(e.forecast),
      e.previous == null ? null : String(e.previous)
    );
    console.log(`🧷 Pending release locked from 5m alert: ${e.title} | ${cur}`);
  }
}

function getPendingRows(now) {
  ensurePendingTable();
  const rows = db.prepare(`
    SELECT * FROM pending_news_releases
    WHERE status='pending'
    ORDER BY event_time ASC
  `).all();

  const expire = db.prepare(`UPDATE pending_news_releases SET status='expired' WHERE pending_id=?`);
  return rows.filter(row => {
    const ts = new Date(row.event_time).getTime();
    if (!Number.isFinite(ts)) {
      expire.run(row.pending_id);
      return false;
    }
    const ageMin = (now - ts) / 60000;
    if (ageMin > PENDING_TTL_MINUTES) {
      expire.run(row.pending_id);
      console.log(`⌛ Pending news expired after ${PENDING_TTL_MINUTES}m: ${row.title} | ${row.currency}`);
      return false;
    }
    return ageMin >= -2;
  });
}

function findPendingMatch(row, events) {
  const targetTs = new Date(row.event_time).getTime();
  let best = null;
  let bestScore = 0;

  for (const e of events || []) {
    if (String(e.currency || '').toUpperCase() !== String(row.currency || '').toUpperCase()) continue;
    const ts = new Date(e.date).getTime();
    if (!Number.isFinite(ts) || Math.abs(ts - targetTs) > 60 * 60 * 1000) continue;
    const similarity = titleSimilarity(row.title, e.title);
    if (similarity < 0.45) continue;
    const timeScore = 1 - Math.min(Math.abs(ts - targetTs) / (60 * 60 * 1000), 1);
    const score = similarity * 0.8 + timeScore * 0.2;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

async function enrichPending(row, events) {
  let e = findPendingMatch(row, events);
  if (e && validActual(e.actual)) return e;

  const base = e || {
    currency: row.currency,
    title: row.title,
    date: row.event_time,
    forecast: row.forecast,
    previous: row.previous,
    impact: 'high'
  };

  const ageMin = (Date.now() - new Date(row.event_time).getTime()) / 60000;
  if (ageMin >= 1) {
    try {
      const fallback = await getInvestingFallback(base);
      if (fallback) {
        base.actual = fallback.actual ?? base.actual;
        base.forecast = fallback.forecast ?? base.forecast;
        base.previous = fallback.previous ?? base.previous;
      }
    } catch (error) {
      console.log(`⚠️ Pending Investing fallback failed: ${row.title} | ${error.message}`);
    }
  }

  return base;
}

function touchPending(row) {
  db.prepare(`
    UPDATE pending_news_releases
    SET attempts=attempts+1,last_checked_at=CURRENT_TIMESTAMP
    WHERE pending_id=?
  `).run(row.pending_id);
}

function completePending(row) {
  db.prepare(`
    UPDATE pending_news_releases
    SET status='sent',last_checked_at=CURRENT_TIMESTAMP
    WHERE pending_id=?
  `).run(row.pending_id);
}

async function sendRelease(bot, e, releaseHash) {
  const key = `news_released_${releaseHash}`;
  if (seen(key) || !validActual(e.actual)) return false;

  const imp = impact(e) === 'medium' ? 'medium' : 'high';
  const title = await arabicTitle(e.title);
  const stars = imp === 'high' ? '⭐⭐⭐' : '⭐⭐';
  const icon = imp === 'high' ? '🔴' : '🟠';
  const msg = `${icon} <b>صدر الآن :</b>\n\n💠 <b>${countryName(e)} - ${flag(e)}</b>\n\n🔵 <b>${title}</b>\n\n🔖 درجة الأهمية ${stars}\n\n🕒 السابق : ${e.previous ?? '-'}\n🕞 التقدير : ${e.forecast ?? '-'}\n🕓 الحالي : <b>${e.actual}</b>\n\n👈 النتيجة : ${interpretation(e)}\n\n━━━━━━━━━━━━━━\n\n#ForexNews #EconomicNews\n@Forexaitrade_bot`;
  await bot.telegram.sendMessage(String(config.mainGroupId), msg, { parse_mode:'HTML', disable_web_page_preview:true });
  mark(key);
  console.log(`📣 Economic release sent: ${e.title} | ${e.currency} | ${imp} | Actual=${e.actual}`);
  return true;
}

async function cycle(bot) {
  if (running) return;
  running = true;
  try {
    ensurePendingTable();
    const cal = await getMultiSourceCalendar(true);
    const now = Date.now();
    let sentAny = false;

    // Any HIGH-impact event that already produced a 5-minute warning is
    // persisted before release. It remains pending even if providers later
    // rename, move or temporarily omit the event.
    snapshotFiveMinuteAlerts(cal.data || [], now);

    // Normal release discovery for all HIGH/MEDIUM events.
    for (const e of cal.data || []) {
      const cur = String(e.currency || '').toUpperCase();
      if (!IMPORTANT.has(cur)) continue;
      const imp = impact(e);
      if (imp !== 'high' && imp !== 'medium') continue;
      const ts = new Date(e.date).getTime();
      if (!Number.isFinite(ts)) continue;
      const ageMin = (now - ts) / 60000;
      if (ageMin < -2 || ageMin > 180) continue;
      if (!validActual(e.actual)) continue;
      if (await sendRelease(bot, e, eventHash(e))) sentAny = true;
    }

    // Guaranteed follow-up lane for events that had a 5-minute warning.
    // Keep retrying for up to NEWS_PENDING_TTL_MINUTES (default 6 hours).
    for (const row of getPendingRows(now)) {
      const releasedKey = `news_released_${row.event_hash}`;
      if (seen(releasedKey)) {
        completePending(row);
        continue;
      }

      touchPending(row);
      const e = await enrichPending(row, cal.data || []);
      if (!validActual(e.actual)) {
        console.log(`⏳ Pending release waiting Actual: ${row.title} | ${row.currency} | attempt=${Number(row.attempts || 0) + 1}`);
        continue;
      }

      if (await sendRelease(bot, e, row.event_hash)) {
        completePending(row);
        sentAny = true;
        console.log(`✅ Pending 5m alert completed with Actual: ${row.title} | ${row.currency}`);
      }
    }

    if (sentAny) {
      await refreshDailyNewsBrief(bot);
    }
  } catch (err) {
    console.log('⚠️ Economic release watch error:', err.message);
  } finally { running = false; }
}
function startEconomicReleaseWatch(bot) {
  ensurePendingTable();
  cron.schedule('* * * * *', () => cycle(bot), { timezone: TZ });
  setTimeout(() => cycle(bot), 15000);
  console.log(`📣 Economic release watch every 1 minute | HIGH+MEDIUM | 5m alerts persisted | pending TTL=${PENDING_TTL_MINUTES}m | syncs pinned daily brief`);
}
module.exports = { startEconomicReleaseWatch, cycle };
