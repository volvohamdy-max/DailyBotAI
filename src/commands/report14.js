const {
  buildReport14
} = require('../services/report14Service');

const config = require('../config');


function isAdmin(ctx) {
  return (config.adminIds || [])
    .map(String)
    .includes(
      String(ctx.from?.id)
    );
}


function registerReport14(bot) {

  bot.command(
    'report14',
    async ctx => {

      if (!isAdmin(ctx)) {
        return ctx.reply(
          '🔒 Admin only.'
        );
      }

      try {
        return ctx.reply(
          buildReport14()
        );

      } catch (error) {
        console.log(
          '/report14 error:',
          error.stack ||
          error.message
        );

        return ctx.reply(
          '❌ تعذر إنشاء تقرير الـ14 يوم حاليًا.'
        );
      }
    }
  );
}


module.exports =
  registerReport14;
