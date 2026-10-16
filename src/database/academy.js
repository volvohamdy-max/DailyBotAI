const db = require('./db');

function completeLesson(telegramId, schoolKey, lessonIndex, score = 100) {
  db.prepare(`
    INSERT INTO academy_progress (telegram_id, school_key, lesson_index, score, completed_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id, school_key, lesson_index)
    DO UPDATE SET score = MAX(score, excluded.score), completed_at = CURRENT_TIMESTAMP
  `).run(String(telegramId), String(schoolKey), Number(lessonIndex), Number(score));
}

function getProgress(telegramId) {
  return db.prepare(`
    SELECT school_key, lesson_index, score, completed_at
    FROM academy_progress
    WHERE telegram_id = ?
    ORDER BY completed_at ASC
  `).all(String(telegramId));
}

function isLessonComplete(telegramId, schoolKey, lessonIndex) {
  return Boolean(db.prepare(`
    SELECT 1 FROM academy_progress
    WHERE telegram_id = ? AND school_key = ? AND lesson_index = ?
  `).get(String(telegramId), String(schoolKey), Number(lessonIndex)));
}

module.exports = { completeLesson, getProgress, isLessonComplete };
