const config = require('../config');

const {
  createHiddenSignal,
  getByTradeId,
  recordHiddenTp1,
  recordHiddenTp2,
  recordHiddenSl,
  markTp1Notified,
  markTp2Notified
} = require('../database/hiddenSignals');


async function publishHiddenSignal(
  bot,
  data
) {
  if (
    !config.mainGroupId ||
    !data?.tradeId
  ) {
    return false;
  }

  createHiddenSignal(data);

  const hidden =
    getByTradeId(data.tradeId);

  if (!hidden) {
    return false;
  }

  const text =
`🔐 FOREX AI — إشارة مخفية
━━━━━━━━━━━━━━━━━━

🥇 ${hidden.pair}

🧠 AI Score:
${Number(hidden.ai_score || 0).toFixed(0)}/100

🔥 تم تأكيد فرصة جديدة بواسطة FOREX AI.

🔒 اتجاه الصفقة
🔒 Entry
🔒 Stop Loss
🔒 TP1
🔒 TP2

💎 تم إرسال تفاصيل التنفيذ كاملة لأعضاء VIP.

🚀 /vip

⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;

  try {
    await bot.telegram.sendMessage(
      config.mainGroupId,
      text
    );

    console.log(
      `🔐 HIDDEN SIGNAL PUBLISHED | Trade ${data.tradeId}`
    );

    return true;

  } catch (error) {
    console.log(
      'Hidden signal publish error:',
      error.message
    );

    return false;
  }
}


async function handleHiddenResult(
  bot,
  tradeId,
  resultType
) {
  const hidden =
    getByTradeId(tradeId);

  if (!hidden) {
    return;
  }


  // ==========================================
  // TP1
  // ==========================================

  if (resultType === 'TP1') {
    recordHiddenTp1(tradeId);

    if (
      Number(hidden.tp1_notified) === 1
    ) {
      return;
    }

    if (config.mainGroupId) {
      try {
        await bot.telegram.sendMessage(
          config.mainGroupId,
`👀 تحديث الإشارة المخفية #${hidden.id}
━━━━━━━━━━━━━━━━━━

🥇 ${hidden.pair}

🎯 TP1 HIT ✅

الإشارة كانت مخفية عن الحسابات المجانية،
وتم إرسال تفاصيلها لأعضاء VIP عند التأكيد.

💎 /vip`
        );

        markTp1Notified(tradeId);

      } catch (error) {
        console.log(
          'Hidden TP1 notification error:',
          error.message
        );
      }
    }

    return;
  }


  // ==========================================
  // TP2
  // ==========================================

  if (resultType === 'TP2') {
    recordHiddenTp2(tradeId);

    const current =
      getByTradeId(tradeId);

    if (
      Number(current?.tp2_notified) === 1
    ) {
      return;
    }

    if (config.mainGroupId) {
      try {
        await bot.telegram.sendMessage(
          config.mainGroupId,
`🏆 الإشارة المخفية #${hidden.id}
━━━━━━━━━━━━━━━━━━

🥇 ${hidden.pair}

🏆 TP2 HIT ✅

تم إرسال تفاصيل الصفقة كاملة لأعضاء VIP
منذ لحظة تأكيد الفرصة.

🔐 Direction
🔐 Entry
🔐 SL
🔐 TP1
🔐 TP2

💎 /vip`
        );

        markTp2Notified(tradeId);

      } catch (error) {
        console.log(
          'Hidden TP2 notification error:',
          error.message
        );
      }
    }

    return;
  }


  // ==========================================
  // SL
  // IMPORTANT:
  // سجل النتيجة فقط.
  // لا Push Notification للجروب العام.
  // ==========================================

  if (
    resultType === 'SL' ||
    resultType === 'TP1_THEN_SL'
  ) {
    recordHiddenSl(tradeId);

    console.log(
      `🔕 HIDDEN SIGNAL SL RECORDED | Trade ${tradeId} | no public notification`
    );

    return;
  }
}


module.exports = {
  publishHiddenSignal,
  handleHiddenResult
};
