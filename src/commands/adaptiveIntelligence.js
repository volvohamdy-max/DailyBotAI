const {
  getAdaptiveModel,
  adaptiveReport
} = require('../services/adaptiveIntelligence');


function registerAdaptiveIntelligence(bot) {

  async function show(ctx) {
    try {
      const model =
        getAdaptiveModel('XAUUSD');

      return ctx.reply(
        adaptiveReport(model)
      );

    } catch (error) {
      console.log(
        'Adaptive Intelligence error:',
        error.message
      );

      return ctx.reply(
        '❌ تعذر عرض Adaptive Intelligence حاليًا.'
      );
    }
  }


  bot.command(
    'adaptive',
    show
  );


  bot.hears(
    [
      '🧠 Adaptive Intelligence',
      '🧠 الذكاء المتكيف'
    ],
    show
  );
}


module.exports =
  registerAdaptiveIntelligence;
