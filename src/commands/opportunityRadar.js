const { Markup } = require('telegraf');

const {
  findUser
} = require('../database/users');

const {
  addWatch,
  removeWatch,
  getUserWatches
} = require('../database/opportunityRadar');

const {
  buildOpportunityRadar,
  radarText
} = require('../services/opportunityRadar');


function isEnglish(ctx) {
  return (
    findUser(ctx.from.id)?.language === 'en'
  );
}


function radarKeyboard(rows, en) {
  const buttons = [];

  for (const row of rows.slice(0, 5)) {
    buttons.push([
      Markup.button.callback(
        en
          ? `🔔 Watch ${row.pair}`
          : `🔔 راقب ${row.pair}`,
        `radar_watch_${row.pair}`
      )
    ]);
  }

  buttons.push([
    Markup.button.callback(
      en
        ? '🔄 Refresh Radar'
        : '🔄 تحديث الرادار',
      'radar_refresh'
    )
  ]);

  buttons.push([
    Markup.button.callback(
      en
        ? '👁 My Watches'
        : '👁 الفرص تحت المراقبة',
      'radar_my_watches'
    )
  ]);

  return Markup.inlineKeyboard(buttons);
}


async function showRadar(ctx, edit = false) {
  const en = isEnglish(ctx);

  const rows =
    await buildOpportunityRadar();

  const text =
    radarText(rows);

  const keyboard =
    radarKeyboard(rows, en);

  if (edit) {
    return ctx.editMessageText(
      text,
      keyboard
    ).catch(error => {

      const msg = String(
        error?.response?.description ||
        error?.message ||
        ''
      );

      if (
        msg.includes(
          'message is not modified'
        )
      ) {
        return;
      }

      throw error;
    });
  }

  return ctx.reply(
    text,
    keyboard
  );
}


function registerOpportunityRadar(bot) {

  // ==========================================
  // /radar
  // ==========================================

  bot.command(
    'radar',
    async ctx => {
      try {
        return await showRadar(ctx);
      } catch (error) {
        console.log(
          'Opportunity Radar error:',
          error.message
        );

        return ctx.reply(
          isEnglish(ctx)
            ? '❌ Opportunity Radar is temporarily unavailable.'
            : '❌ تعذر تشغيل رادار الفرص حاليًا.'
        );
      }
    }
  );


  // ==========================================
  // MAIN BUTTON
  // ==========================================

  bot.hears(
    [
      '📡 رادار الفرص',
      '📡 Opportunity Radar'
    ],
    async ctx => {
      try {
        return await showRadar(ctx);
      } catch (error) {
        console.log(
          'Opportunity Radar error:',
          error.message
        );

        return ctx.reply(
          isEnglish(ctx)
            ? '❌ Opportunity Radar is temporarily unavailable.'
            : '❌ تعذر تشغيل رادار الفرص حاليًا.'
        );
      }
    }
  );


  // ==========================================
  // REFRESH
  // ==========================================

  bot.action(
    'radar_refresh',
    async ctx => {

      await ctx.answerCbQuery(
        isEnglish(ctx)
          ? 'Refreshing...'
          : 'جاري تحديث الرادار...'
      ).catch(() => null);

      return showRadar(
        ctx,
        true
      );
    }
  );


  // ==========================================
  // WATCH PAIR
  // ==========================================

  bot.action(
    /^radar_watch_(.+)$/,
    async ctx => {

      const pair =
        String(
          ctx.match[1]
        ).toUpperCase();

      addWatch(
        ctx.from.id,
        pair
      );

      await ctx.answerCbQuery(
        isEnglish(ctx)
          ? `${pair} watch activated`
          : `تمت مراقبة ${pair}`
      ).catch(() => null);

      return ctx.reply(
        isEnglish(ctx)
          ? `📡 Opportunity Radar activated for ${pair}.

The bot will alert you when the setup gets close to completion or becomes fully confirmed.`
          : `📡 تم تفعيل مراقبة ${pair}.

البوت هينبهك لما الفرصة تقترب من الاكتمال أو تكتمل شروطها بالكامل.`
      );
    }
  );


  // ==========================================
  // MY WATCHES
  // ==========================================

  bot.action(
    'radar_my_watches',
    async ctx => {

      await ctx.answerCbQuery()
        .catch(() => null);

      const watches =
        getUserWatches(
          ctx.from.id
        );

      if (!watches.length) {
        return ctx.reply(
          isEnglish(ctx)
            ? '👁 You are not watching any radar opportunities.'
            : '👁 لا توجد فرص تحت مراقبتك حاليًا.'
        );
      }

      const text =
        watches
          .map(w =>
            `📡 ${w.pair}
📊 ${w.last_state || 'WATCHING'}
⭐ ${w.last_score ?? '—'}`
          )
          .join('\n\n');

      const buttons =
        watches.map(w => [
          Markup.button.callback(
            isEnglish(ctx)
              ? `❌ Stop ${w.pair}`
              : `❌ إلغاء ${w.pair}`,
            `radar_stop_${w.pair}`
          )
        ]);

      return ctx.reply(
        isEnglish(ctx)
          ? `👁 RADAR WATCHES

${text}`
          : `👁 الفرص تحت المراقبة

${text}`,
        Markup.inlineKeyboard(
          buttons
        )
      );
    }
  );


  // ==========================================
  // STOP WATCH
  // ==========================================

  bot.action(
    /^radar_stop_(.+)$/,
    async ctx => {

      const pair =
        String(
          ctx.match[1]
        ).toUpperCase();

      removeWatch(
        ctx.from.id,
        pair
      );

      await ctx.answerCbQuery(
        isEnglish(ctx)
          ? `${pair} watch stopped`
          : `تم إيقاف مراقبة ${pair}`
      ).catch(() => null);

      return ctx.reply(
        isEnglish(ctx)
          ? `✅ ${pair} removed from Opportunity Radar.`
          : `✅ تم حذف ${pair} من رادار الفرص.`
      );
    }
  );
}


module.exports =
  registerOpportunityRadar;
