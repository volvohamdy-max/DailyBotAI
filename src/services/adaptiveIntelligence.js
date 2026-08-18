const {
  getLearningRows
} = require('../database/adaptiveIntelligence');


const FEATURES = [
  'ema',
  'rsi',
  'adx',
  'vwap',
  'momentum'
];


const FEATURE_LABELS = {
  ema: 'EMA',
  rsi: 'RSI',
  adx: 'ADX',
  vwap: 'VWAP',
  momentum: 'Momentum'
};


const MIN_WEIGHT = 10;
const MAX_WEIGHT = 30;

const TARGET_SAMPLES = 100;


/**
 * Convert raw feature value to column name in DB.
 */
function featureColumn(feature) {
  return `${feature}_ok`;
}


function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}


/**
 * Calculates how useful a feature was historically.
 *
 * We compare:
 * - average R when feature was aligned
 * - average R when feature was NOT aligned
 *
 * Positive difference = useful feature.
 */
function featureEdge(rows, feature) {
  const column =
    featureColumn(feature);

  const aligned =
    rows.filter(
      row =>
        Number(row[column]) === 1 &&
        Number.isFinite(
          Number(row.realized_r)
        )
    );

  const notAligned =
    rows.filter(
      row =>
        Number(row[column]) !== 1 &&
        Number.isFinite(
          Number(row.realized_r)
        )
    );


  const avg = list => {
    if (!list.length) {
      return null;
    }

    return (
      list.reduce(
        (sum, row) =>
          sum + Number(row.realized_r),
        0
      ) / list.length
    );
  };


  const alignedAvg =
    avg(aligned);

  const notAlignedAvg =
    avg(notAligned);


  let edge = 0;

  if (
    alignedAvg !== null &&
    notAlignedAvg !== null
  ) {
    edge =
      alignedAvg -
      notAlignedAvg;

  } else if (
    alignedAvg !== null
  ) {
    edge =
      alignedAvg;
  }


  return {
    feature,
    alignedCount:
      aligned.length,

    notAlignedCount:
      notAligned.length,

    alignedAvgR:
      alignedAvg,

    notAlignedAvgR:
      notAlignedAvg,

    edge
  };
}


/**
 * Converts feature edges into normalized weights.
 *
 * We keep hard safety bounds:
 * 10% <= feature weight <= 30%
 */
function buildWeights(rows) {
  const stats =
    FEATURES.map(
      feature =>
        featureEdge(
          rows,
          feature
        )
    );


  /*
   * Shift edges to positive space.
   * Negative historical usefulness should
   * reduce importance, not create negative weights.
   */
  const rawScores =
    stats.map(item => {
      const score =
        1 +
        item.edge;

      return {
        ...item,
        rawScore:
          Math.max(
            0.1,
            score
          )
      };
    });


  const totalRaw =
    rawScores.reduce(
      (sum, x) =>
        sum + x.rawScore,
      0
    );


  let weights =
    rawScores.map(x => ({
      ...x,

      weight:
        totalRaw > 0
          ? (
              x.rawScore /
              totalRaw
            ) * 100
          : 20
    }));


  /*
   * Clamp to safety range.
   */
  weights =
    weights.map(x => ({
      ...x,

      weight:
        clamp(
          x.weight,
          MIN_WEIGHT,
          MAX_WEIGHT
        )
    }));


  /*
   * Re-normalize after clamping.
   */
  const clampedTotal =
    weights.reduce(
      (sum, x) =>
        sum + x.weight,
      0
    );


  weights =
    weights.map(x => ({
      ...x,

      weight:
        clampedTotal > 0
          ? (
              x.weight /
              clampedTotal
            ) * 100
          : 20
    }));


  return weights;
}


/**
 * Blend 30 / 60 / 90 day windows.
 *
 * Recent market gets more influence:
 * 30D = 50%
 * 60D = 30%
 * 90D = 20%
 */
function blendedWeights(
  w30,
  w60,
  w90
) {
  const map30 =
    new Map(
      w30.map(
        x => [
          x.feature,
          x.weight
        ]
      )
    );

  const map60 =
    new Map(
      w60.map(
        x => [
          x.feature,
          x.weight
        ]
      )
    );

  const map90 =
    new Map(
      w90.map(
        x => [
          x.feature,
          x.weight
        ]
      )
    );


  let output =
    FEATURES.map(feature => ({
      feature,

      label:
        FEATURE_LABELS[feature],

      weight:
        (
          (map30.get(feature) || 20) * 0.50 +
          (map60.get(feature) || 20) * 0.30 +
          (map90.get(feature) || 20) * 0.20
        )
    }));


  const total =
    output.reduce(
      (sum, x) =>
        sum + x.weight,
      0
    );


  output =
    output.map(x => ({
      ...x,

      weight:
        total > 0
          ? (
              x.weight /
              total
            ) * 100
          : 20
    }));


  return output;
}


function modelConfidence(
  sampleCount
) {
  const progress =
    clamp(
      sampleCount /
      TARGET_SAMPLES,
      0,
      1
    );

  return Math.round(
    progress * 100
  );
}


function modeForSamples(
  sampleCount
) {
  if (
    sampleCount < TARGET_SAMPLES
  ) {
    return 'LEARNING';
  }

  if (
    sampleCount <
    TARGET_SAMPLES * 2
  ) {
    return 'ASSISTED';
  }

  return 'ADAPTIVE';
}


function getAdaptiveModel(
  pair = null
) {
  const rows30 =
    getLearningRows(
      30,
      pair
    );

  const rows60 =
    getLearningRows(
      60,
      pair
    );

  const rows90 =
    getLearningRows(
      90,
      pair
    );


  const weights30 =
    buildWeights(
      rows30
    );

  const weights60 =
    buildWeights(
      rows60
    );

  const weights90 =
    buildWeights(
      rows90
    );


  const blended =
    blendedWeights(
      weights30,
      weights60,
      weights90
    );


  const samples =
    rows90.length;


  return {
    pair:
      pair
        ? String(pair).toUpperCase()
        : 'ALL',

    mode:
      modeForSamples(
        samples
      ),

    samples,

    targetSamples:
      TARGET_SAMPLES,

    learningProgress:
      Math.min(
        100,
        Math.round(
          (
            samples /
            TARGET_SAMPLES
          ) * 100
        )
      ),

    modelConfidence:
      modelConfidence(
        samples
      ),

    weights:
      blended
        .sort(
          (a, b) =>
            b.weight -
            a.weight
        ),

    windows: {
      days30: {
        samples:
          rows30.length,

        weights:
          weights30
      },

      days60: {
        samples:
          rows60.length,

        weights:
          weights60
      },

      days90: {
        samples:
          rows90.length,

        weights:
          weights90
      }
    }
  };
}


function adaptiveScore(
  featureState,
  model
) {
  if (
    !featureState ||
    !model?.weights?.length
  ) {
    return null;
  }


  let score = 0;


  for (
    const item
    of model.weights
  ) {
    const active =
      Boolean(
        featureState[
          item.feature
        ]
      );

    if (active) {
      score +=
        item.weight;
    }
  }


  return Number(
    clamp(
      score,
      0,
      100
    ).toFixed(1)
  );
}


function adaptiveReport(
  model
) {
  const modeEmoji =
    model.mode === 'ADAPTIVE'
      ? '🟢'
      : model.mode === 'ASSISTED'
        ? '🟠'
        : '🟡';


  const bars = value => {
    const count =
      Math.round(
        Number(value) / 4
      );

    return (
      '█'.repeat(
        Math.min(
          25,
          count
        )
      )
    );
  };


  const weights =
    model.weights
      .map(x =>
        `${x.label.padEnd(8)} ${bars(x.weight)} ${x.weight.toFixed(1)}%`
      )
      .join('\n');


  return `🧠 ADAPTIVE INTELLIGENCE
━━━━━━━━━━━━━━━━━━

${modeEmoji} Mode: ${model.mode}

📊 Samples:
${model.samples} / ${model.targetSamples}

📈 Learning Progress:
${model.learningProgress}%

🧠 Model Confidence:
${model.modelConfidence}%

━━━━━━━━━━━━━━━━━━
📌 LEARNED IMPORTANCE

${weights}

━━━━━━━━━━━━━━━━━━

30D Samples: ${model.windows.days30.samples}
60D Samples: ${model.windows.days60.samples}
90D Samples: ${model.windows.days90.samples}

ℹ️ الأوزان الحالية في وضع التعلم.
لن تغيّر قرارات التداول تلقائيًا حتى تتجمع عينة كافية.`;
}


module.exports = {
  FEATURES,
  FEATURE_LABELS,

  getAdaptiveModel,
  adaptiveScore,
  adaptiveReport,

  buildWeights,
  featureEdge
};
