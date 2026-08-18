const { getCandles } = require('./marketService');
const analyzeIndicators = require('../indicators/analyzer');
const { askOpenAI } = require('../ai/openaiService');

async function analyzePair(pair) {
    console.log(
        '⏱️ START GET CANDLES:',
        new Date().toLocaleTimeString()
    );

    const candles = await getCandles(pair);

    console.log(
        '⏱️ END GET CANDLES:',
        new Date().toLocaleTimeString()
    );

    if (!candles || !candles.length) {
        return {
            pair: pair.toUpperCase(),
            indicators: null,
            signal: null
        };
    }

    const indicators = analyzeIndicators(candles);

    if (!indicators) {
        return {
            pair: pair.toUpperCase(),
            indicators: null,
            signal: null
        };
    }

    const {
        ema20,
        ema50,
        rsi,
        macd,
        adx
    } = indicators;

    let buyScore = 0;
    let sellScore = 0;

    // =========================
    // EMA TREND
    // =========================

    if (
        Number.isFinite(Number(ema20)) &&
        Number.isFinite(Number(ema50))
    ) {
        if (Number(ema20) > Number(ema50)) {
            buyScore++;
        }

        if (Number(ema20) < Number(ema50)) {
            sellScore++;
        }
    }

    // =========================
    // RSI
    // =========================

    if (Number.isFinite(Number(rsi))) {
        if (Number(rsi) > 50) {
            buyScore++;
        }

        if (Number(rsi) < 50) {
            sellScore++;
        }
    }

    // =========================
    // MACD
    // =========================

    if (
        macd &&
        Number.isFinite(Number(macd.macd)) &&
        Number.isFinite(Number(macd.signal))
    ) {
        if (
            Number(macd.macd) >
            Number(macd.signal)
        ) {
            buyScore++;
        }

        if (
            Number(macd.macd) <
            Number(macd.signal)
        ) {
            sellScore++;
        }
    }

    // =========================
    // ADX
    // =========================

    if (Number.isFinite(Number(adx))) {
        if (Number(adx) >= 20) {
            if (buyScore > sellScore) {
                buyScore++;
            } else if (sellScore > buyScore) {
                sellScore++;
            }
        }
    }

    console.log(
        `📊 ${pair} | BUY: ${buyScore}/4 | SELL: ${sellScore}/4`
    );

    // =========================
    // TECHNICAL DIRECTION
    // =========================

    let direction = null;

    if (
        buyScore >= 3 &&
        buyScore > sellScore
    ) {
        direction = 'BUY';
    } else if (
        sellScore >= 3 &&
        sellScore > buyScore
    ) {
        direction = 'SELL';
    }

    // لا يوجد توافق فني كافي
    if (!direction) {
        return {
            pair: pair.toUpperCase(),
            indicators,
            signal: null,
            technicalDirection: null,
            buyScore,
            sellScore
        };
    }

    console.log(
        `🤖 AI FILTER STARTED: ${pair} ${direction}`
    );

    console.log(
        '⏱️ START AI:',
        new Date().toLocaleTimeString()
    );

    let signal = null;

    try {
        signal = await askOpenAI(
            pair,
            {
                ...indicators,
                direction,
                buyScore,
                sellScore
            }
        );
    } catch (error) {
        console.log(
            `❌ AI ERROR ${pair}:`,
            error.message
        );

        return {
            pair: pair.toUpperCase(),
            indicators,
            signal: null,
            technicalDirection: direction,
            buyScore,
            sellScore
        };
    }

    console.log(
        '⏱️ END AI:',
        new Date().toLocaleTimeString()
    );

    // =========================
    // AI RESULT VALIDATION
    // =========================

    if (!signal) {
        return {
            pair: pair.toUpperCase(),
            indicators,
            signal: null,
            technicalDirection: direction,
            buyScore,
            sellScore
        };
    }

    const aiAction =
        String(signal.action || '')
            .toUpperCase();

    const aiConfidence =
        Number(signal.confidence);

    // =========================
    // NORMALIZE AI RESULT
    // =========================

    signal = {
        ...signal,
        action:
            aiAction === 'BUY' ||
            aiAction === 'SELL'
                ? aiAction
                : null,

        confidence:
            Number.isFinite(aiConfidence)
                ? Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(aiConfidence)
                    )
                )
                : 0
    };

    // =========================
    // INVALID AI ACTION
    // =========================

    if (
        signal.action !== 'BUY' &&
        signal.action !== 'SELL'
    ) {
        console.log(
            `⚠️ AI returned invalid action for ${pair}:`,
            signal.action
        );

        return {
            pair: pair.toUpperCase(),
            indicators,
            signal: null,
            technicalDirection: direction,
            buyScore,
            sellScore
        };
    }

    // =========================
    // AI DIRECTION
    // =========================

    if (signal.action !== direction) {
        console.log(
            `⚠️ AI direction mismatch: ${signal.action} vs ${direction}`
        );

        /*
         * لا نمسح نتيجة AI بالكامل.
         * نحتفظ بها حتى يستطيع Best Trade
         * معرفة أن AI اختلف مع التحليل الفني.
         */

        return {
            pair: pair.toUpperCase(),
            indicators,
            signal,
            technicalDirection: direction,
            aiDirectionMismatch: true,
            buyScore,
            sellScore
        };
    }

    // =========================
    // LOW AI CONFIDENCE
    // =========================

    if (signal.confidence < 60) {
        console.log(
            `⚠️ Low AI confidence: ${signal.confidence}`
        );

        /*
         * مهم:
         * لا نرجع signal:null
         *
         * نرجع الـsignal الحقيقي
         * حتى لا يتحول Confidence إلى 0.
         */

        return {
            pair: pair.toUpperCase(),
            indicators,
            signal,
            technicalDirection: direction,
            lowAIConfidence: true,
            buyScore,
            sellScore
        };
    }

    // =========================
    // VALID AI SIGNAL
    // =========================

    console.log(
        `✅ Valid signal: ${pair} ${signal.action} ${signal.confidence}%`
    );

    return {
        pair: pair.toUpperCase(),
        indicators,
        signal,
        technicalDirection: direction,
        lowAIConfidence: false,
        aiDirectionMismatch: false,
        buyScore,
        sellScore
    };
}

module.exports = {
    analyzePair
};
