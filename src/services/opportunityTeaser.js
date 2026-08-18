const config = require('../config');
const PUBLIC_TEASER_COOLDOWN_MS =
  Number(process.env.PUBLIC_TEASER_COOLDOWN_MS) ||
  60 * 60 * 1000;


const {
  buildOpportunityRadar
} = require('./opportunityRadar');

const {
  getState,
  saveState
} = require('../database/opportunityTeaser');


function stateOf(row) {
  if (!row) {
    return 'WEAK';
  }

  if (
    row.ready ||
    row.passed >= row.total
  ) {
    return 'CONFIRMED';
  }

  if (row.passed === 5) {
    return 'ALMOST_READY';
  }

  if (row.passed === 4) {
    return 'FORMING';
  }

  return 'WEAK';
}


function directionText(direction) {
  if (direction === 'BUY') {
    return 'صعودي';
  }

  if (direction === 'SELL') {
    return 'هبوطي';
  }

  return 'غير محسوم';
}


async function runOpportunityTeaser(bot) {
  if (!config.mainGroupId) {
    return;
  }

  const rows =
    await buildOpportunityRadar();


  for (const row of rows) {

    const pair =
      String(row.pair)
        .toUpperCase();

    const currentState =
      stateOf(row);

    const direction =
      String(
        row.direction || ''
      ).toUpperCase();

    const previous =
      getState(pair);

    const previousState =
      String(
        previous?.last_state ||
        'NONE'
      );

    const previousDirection =
      String(
        previous?.last_direction ||
        ''
      ).toUpperCase();

    const lastSentAt =
      previous?.last_sent_at
        ? new Date(previous.last_sent_at).getTime()
        : 0;

    const teaserCooldownPassed =
      !lastSentAt ||
      Date.now() - lastSentAt >=
        PUBLIC_TEASER_COOLDOWN_MS;


    let effectiveState =
      currentState;


    /*
     * Opportunity cancellation:
     * it had reached 4/6 or 5/6,
     * then lost confirmation or reversed.
     */
    const wasDeveloping =
      previousState === 'FORMING' ||
      previousState === 'ALMOST_READY';

    const directionChanged =
      previousDirection &&
      direction &&
      previousDirection !== direction;

    if (
      wasDeveloping &&
      (
        currentState === 'WEAK' ||
        directionChanged
      )
    ) {
      effectiveState =
        'CANCELLED';
    }


    let message = null;


    // =========================================
    // 5 / 6 — PUBLIC TEASER
    // =========================================

    if (
      effectiveState === 'ALMOST_READY' &&
      previousState !== 'ALMOST_READY'
    ) {
      // 5/6 stays internal only.
      // No public-group spam.
      message = null;

      console.log(
        `🔕 PUBLIC 5/6 SUPPRESSED | ${pair}`
      );
    }


    // =========================================
    // 6 / 6 — CONFIRMED
    // =========================================

    if (
      effectiveState === 'CONFIRMED' &&
      previousState !== 'CONFIRMED'
    ) {

      const confirmedDirection =
        String(direction || row.direction || '')
          .toUpperCase();

      const entry =
        Number(
          row.entry ??
          row.signal?.entry ??
          row.levels?.entry
        );

      const sl =
        Number(
          row.sl ??
          row.stop_loss ??
          row.signal?.sl ??
          row.levels?.sl ??
          row.levels?.stop_loss
        );

      const tp1 =
        Number(
          row.tp1 ??
          row.target1 ??
          row.signal?.tp1 ??
          row.levels?.tp1
        );

      const tp2 =
        Number(
          row.tp2 ??
          row.target2 ??
          row.signal?.tp2 ??
          row.levels?.tp2
        );

      const hasValidLevels =
        ['BUY', 'SELL'].includes(
          confirmedDirection
        ) &&
        Number.isFinite(entry) &&
        Number.isFinite(sl) &&
        Number.isFinite(tp1) &&
        Number.isFinite(tp2);

      let vipSent = false;

      if (
        hasValidLevels &&
        config.vipChannelId
      ) {
        const vipMessage =
`🔥 فرصة مكتملة — VIP
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

${
  confirmedDirection === 'BUY'
    ? '📈 BUY'
    : '📉 SELL'
}

██████ 6/6

⭐ AI Score:
${Number(row.score || 0).toFixed(0)}/100

💰 Entry:
${entry}

🛑 Stop Loss:
${sl}

🎯 TP1:
${tp1}

🏆 TP2:
${tp2}

✅ جميع شروط التأكيد الفني اكتملت.

⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;

        try {
          await bot.telegram.sendMessage(
            config.vipChannelId,
            vipMessage
          );

          vipSent = true;

          console.log(
            `💎 VIP RADAR CONFIRMED SENT | ${pair} | ${confirmedDirection}`
          );

        } catch (error) {
          console.log(
            `❌ VIP Radar send failed ${pair}:`,
            error.message
          );
        }

      } else {
        console.log(
          `⚠️ CONFIRMED RADAR WITHOUT EXECUTION LEVELS | ${pair}`,
          {
            direction: confirmedDirection,
            entry,
            sl,
            tp1,
            tp2
          }
        );
      }


      /*
       * Public group only gets a confirmation teaser
       * if the actual VIP details were successfully sent.
       */
      if (vipSent) {
        message =
`🔥 فرصة فنية اكتملت الآن
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

██████ 6/6

⭐ AI Score:
${Number(row.score || 0).toFixed(0)}/100

✅ اكتمل التأكيد الفني.

💎 تم إرسال تفاصيل الفرصة لأعضاء VIP.

🔒 Direction
🔒 Entry
🔒 Stop Loss
🔒 TP1
🔒 TP2

🚀 /vip

⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
      } else {
        message = null;
      }
    }


    // =========================================
    // CANCELLED
    // =========================================

    if (
      effectiveState === 'CANCELLED' &&
      previousState !== 'CANCELLED'
    ) {
      // Keep CANCELLED state internally,
      // but do not spam the public group.
      message = null;

      console.log(
        `🔕 PUBLIC CANCEL SUPPRESSED | ${pair}`
      );
    }


    if (message) {
      try {
        await bot.telegram.sendMessage(
          config.mainGroupId,
          message
        );

        console.log(
          `📣 PUBLIC RADAR TEASER | ${pair} | ${effectiveState}`
        );

      } catch (error) {
        console.log(
          'Opportunity teaser send error:',
          error.message
        );
      }
    }


    saveState(
      pair,
      effectiveState,
      direction,
      row.score,
      Boolean(message)
    );
  }
}


module.exports = {
  runOpportunityTeaser
};
