const { scanMarkets } = require('./smartScanner');
const { isPairMarketOpen } = require('../utils/marketHours');

const {
  getWatches,
  updateWatchState
} = require('../database/opportunityRadar');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v) {
  return Math.max(0, Math.min(100, Number(v || 0)));
}

function getDirection(row) {
  const d = String(
    row.action ||
    row.signal?.action ||
    row.technicalDirection ||
    row.direction ||
    'WAIT'
  ).toUpperCase();

  return ['BUY', 'SELL'].includes(d) ? d : 'WAIT';
}

function getScore(row) {
  return clamp(
    row.finalScore ??
    row.score ??
    row.smartScore ??
    row.scalpMeta?.score ??
    row.signal?.confidence ??
    0
  );
}

function evaluate(row) {
  const direction = getDirection(row);
  const i = row.indicators || row.analysis?.indicators || {};

  const ema20 = num(i.ema20);
  const ema50 = num(i.ema50);
  const rsi = num(i.rsi);
  const adx = num(i.adx);

  const macd = num(
    i.macd?.histogram ??
    i.macdHistogram
  );

  const score = getScore(row);

  const checks = [
    {
      label: 'اتجاه السوق',
      ok: direction !== 'WAIT'
    },
    {
      label: 'تأكيد EMA',
      ok:
        ema20 !== null &&
        ema50 !== null &&
        (
          (direction === 'BUY' && ema20 > ema50) ||
          (direction === 'SELL' && ema20 < ema50)
        )
    },
    {
      label: 'منطقة RSI',
      ok:
        rsi !== null &&
        (
          (direction === 'BUY' && rsi >= 50 && rsi <= 75) ||
          (direction === 'SELL' && rsi <= 50 && rsi >= 25)
        )
    },
    {
      label: 'زخم MACD',
      ok:
        macd !== null &&
        (
          (direction === 'BUY' && macd > 0) ||
          (direction === 'SELL' && macd < 0)
        )
    },
    {
      label: 'قوة ADX',
      ok: adx !== null && adx >= 20
    },
    {
      label: 'جودة الفرصة',
      ok: score >= 80
    }
  ];

  const passed = checks.filter(x => x.ok).length;

  return {
    checks,
    passed,
    total: checks.length,
    completion: Math.round((passed / checks.length) * 100)
  };
}

function normalize(row) {
  const pair = String(
    row.pair || row.symbol || ''
  ).toUpperCase();

  const result = evaluate(row);

  return {
    pair,
    direction: getDirection(row),
    score: getScore(row),
    passed: result.passed,
    total: result.total,
    completion: result.completion,
    missing: result.checks
      .filter(x => !x.ok)
      .map(x => x.label),
    ready: result.passed === result.total,

    entry:
      row.entry ??
      row.signal?.entry ??
      row.levels?.entry ??
      null,

    sl:
      row.stop_loss ??
      row.sl ??
      row.signal?.sl ??
      row.levels?.sl ??
      row.levels?.stop_loss ??
      null,

    tp1:
      row.target1 ??
      row.tp1 ??
      row.signal?.tp1 ??
      row.levels?.tp1 ??
      null,

    tp2:
      row.target2 ??
      row.tp2 ??
      row.signal?.tp2 ??
      row.levels?.tp2 ??
      null
  };
}

async function buildOpportunityRadar() {
  const rows = await scanMarkets();

  return (rows || [])
    .filter(row => {
      const pair = String(
        row.pair || row.symbol || ''
      ).toUpperCase();

      return pair && isPairMarketOpen(pair);
    })
    .map(normalize)
    .sort((a, b) => {
      if (b.passed !== a.passed)
        return b.passed - a.passed;

      return b.score - a.score;
    })
    .slice(0, 8);
}

function getState(row) {
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

function radarText(rows) {
  if (!rows.length) {
    return `📡 رادار الفرص

لا توجد فرص نشطة حاليًا.`;
  }

  const medals = [
    '🥇',
    '🥈',
    '🥉',
    '4️⃣',
    '5️⃣'
  ];

  const body =
    rows.slice(0, 5)
      .map((r, i) => {

        const state =
          getState(r);

        const bars =
          '█'.repeat(r.passed) +
          '░'.repeat(
            Math.max(
              0,
              r.total - r.passed
            )
          );

        let directionText =
          '⏳ لم يتم تأكيد اتجاه دخول';

        /*
         * قبل 6/6:
         * نعرض الميل فقط، وليس BUY/SELL كتوصية.
         */
        if (
          state === 'FORMING' ||
          state === 'ALMOST_READY'
        ) {
          directionText =
            r.direction === 'BUY'
              ? '🧭 الميل الحالي: صعودي'
              : r.direction === 'SELL'
                ? '🧭 الميل الحالي: هبوطي'
                : '🧭 الميل الحالي: غير محسوم';
        }

        /*
         * BUY / SELL يظهر فقط عند التأكيد.
         */
        if (state === 'CONFIRMED') {
          directionText =
            r.direction === 'BUY'
              ? '📈 إشارة مؤكدة: BUY'
              : r.direction === 'SELL'
                ? '📉 إشارة مؤكدة: SELL'
                : '✅ الإشارة مكتملة';
        }

        let stateText =
          '⏳ تحت المراقبة';

        if (state === 'FORMING') {
          stateText =
            '🟡 الفرصة تتكوّن';
        }

        if (state === 'ALMOST_READY') {
          stateText =
            '👀 باقي شرط واحد فقط';
        }

        if (state === 'CONFIRMED') {
          stateText =
            '🔥 الفرصة اكتملت';
        }

        const missing =
          r.missing?.length
            ? `الناقص: ${r.missing[0]}`
            : '✅ كل الشروط مؤكدة';

        return `${medals[i] || '•'} ${r.pair}

${directionText}

${bars} ${r.passed}/${r.total}

⭐ Score: ${r.score}/100

${stateText}

${missing}`;
      })
      .join('\n\n');


  return `📡 FOREX AI — رادار الفرص
━━━━━━━━━━━━━━━━━━

${body}

━━━━━━━━━━━━━━━━━━

ℹ️ BUY / SELL لا يظهر كإشارة دخول إلا بعد اكتمال جميع شروط التأكيد.

⚠️ التحليل فني ومعلوماتي ولا يضمن نتائج التداول.`;
}

async function monitorOpportunityRadar(bot) {
  const watches =
    getWatches();

  if (!watches.length) {
    return;
  }

  const rows =
    await buildOpportunityRadar();

  const map =
    new Map(
      rows.map(
        row => [
          row.pair,
          row
        ]
      )
    );


  for (const watch of watches) {
    try {
      const pair =
        String(
          watch.pair
        ).toUpperCase();

      if (!isPairMarketOpen(pair)) {
        continue;
      }

      const row =
        map.get(pair);

      if (!row) {
        continue;
      }

      const state =
        getState(row);

      const previous =
        String(
          watch.last_state ||
          'WATCHING'
        );

      const previousDirection =
        String(
          watch.last_direction ||
          ''
        ).toUpperCase();

      const currentDirection =
        String(
          row.direction ||
          ''
        ).toUpperCase();


      /*
       * CANCELLED:
       *
       * كانت فرصة حقيقية تتكوّن،
       * ثم فقدت شروطها أو انعكس اتجاهها.
       */
      const wasActiveSetup =
        previous === 'FORMING' ||
        previous === 'ALMOST_READY';

      const lostSetup =
        row.passed <= 3;

      const directionChanged =
        previousDirection &&
        currentDirection &&
        previousDirection !== currentDirection;

      let effectiveState =
        state;


      if (
        wasActiveSetup &&
        (
          lostSetup ||
          directionChanged
        )
      ) {
        effectiveState =
          'CANCELLED';
      }


      let message = null;


      // ======================================
      // FORMING
      // ======================================

      if (
        effectiveState === 'FORMING' &&
        previous !== 'FORMING'
      ) {
        message =
`🟡 فرصة بدأت تتكوّن
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

${
  currentDirection === 'BUY'
    ? '🧭 الميل الحالي: صعودي'
    : currentDirection === 'SELL'
      ? '🧭 الميل الحالي: هبوطي'
      : '🧭 الميل الحالي: غير محسوم'
}

📡 الشروط:
${row.passed}/${row.total}

⭐ Score:
${row.score}/100

⚠️ لا توجد إشارة دخول مؤكدة حتى الآن.

الرادار مستمر في المراقبة.`;
      }


      // ======================================
      // ALMOST READY
      // ======================================

      if (
        effectiveState === 'ALMOST_READY' &&
        previous !== 'ALMOST_READY'
      ) {
        message =
`👀 فرصة قوية تقترب من الاكتمال
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

${
  currentDirection === 'BUY'
    ? '🧭 الميل الحالي: صعودي'
    : currentDirection === 'SELL'
      ? '🧭 الميل الحالي: هبوطي'
      : '🧭 الميل الحالي: غير محسوم'
}

█████░ 5/6

⭐ Score:
${row.score}/100

⏳ الشرط المتبقي:
${row.missing?.[0] || '—'}

🔒 اتجاه الدخول النهائي لم يتم تأكيده بعد.

📡 الرادار مستمر في المتابعة.`;
      }


      // ======================================
      // CONFIRMED
      // ======================================

      if (
        effectiveState === 'CONFIRMED' &&
        previous !== 'CONFIRMED'
      ) {
        message =
`🔥 الفرصة اكتملت الآن
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

${
  currentDirection === 'BUY'
    ? '📈 BUY'
    : currentDirection === 'SELL'
      ? '📉 SELL'
      : '✅ CONFIRMED'
}

██████ 6/6

⭐ Score:
${row.score}/100

✅ جميع شروط التأكيد الفني اكتملت.

افتح البوت لمراجعة تفاصيل التحليل قبل اتخاذ القرار.

⚠️ التحليل آلي ومعلوماتي ولا يضمن نتائج التداول.`;
      }


      // ======================================
      // CANCELLED
      // ======================================

      if (
        effectiveState === 'CANCELLED' &&
        previous !== 'CANCELLED'
      ) {
        message =
`⚠️ الفرصة السابقة لم تكتمل
━━━━━━━━━━━━━━━━━━

🥇 ${pair}

📡 الرادار ألغى الفرصة قبل إصدار إشارة دخول مؤكدة.

${
  directionChanged
    ? '🔄 السبب: تغيّر اتجاه السوق.'
    : '📉 السبب: فقدت الفرصة عددًا من شروط التأكيد.'
}

✅ No Trade = قرار.

الرادار مستمر في البحث عن فرصة جديدة.`;
      }


      if (message) {
        try {
          await bot.telegram.sendMessage(
            watch.telegram_id,
            message
          );
        } catch (error) {
          console.log(
            `Radar alert send failed ${watch.telegram_id}:`,
            error.message
          );
        }
      }


      updateWatchState(
        watch.telegram_id,
        pair,
        effectiveState,
        row.score,
        currentDirection,
        row.completion
      );

    } catch (error) {
      console.log(
        'Opportunity Radar state error:',
        error.message
      );
    }
  }
}

module.exports = {
  buildOpportunityRadar,
  radarText,
  monitorOpportunityRadar
};
