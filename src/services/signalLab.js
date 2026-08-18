const { getCandles } = require('./marketService');
const analyzeIndicators = require('../indicators/analyzer');

const MIN_SIMILAR = 3;
const FUTURE_CANDLES = 4;
const MIN_SIMILARITY = 25;
const MAX_HISTORICAL = 50;

// =========================
// HISTORICAL DIRECTION
// =========================

function directionFromIndicators(indicators) {
    if (!indicators) return 'WAIT';

    const ema20 = Number(indicators.ema20);
    const ema50 = Number(indicators.ema50);
    const rsi = Number(indicators.rsi);

    const macdBuy =
        indicators.macd &&
        Number(indicators.macd.macd) >
        Number(indicators.macd.signal);

    const macdSell =
        indicators.macd &&
        Number(indicators.macd.macd) <
        Number(indicators.macd.signal);

    let buy = 0;
    let sell = 0;

    if (
        Number.isFinite(ema20) &&
        Number.isFinite(ema50)
    ) {
        if (ema20 > ema50) buy++;
        if (ema20 < ema50) sell++;
    }

    if (Number.isFinite(rsi)) {
        if (rsi > 50) buy++;
        if (rsi < 50) sell++;
    }

    if (macdBuy) buy++;
    if (macdSell) sell++;

    if (buy > sell && buy >= 2) {
        return 'BUY';
    }

    if (sell > buy && sell >= 2) {
        return 'SELL';
    }

    return 'WAIT';
}

// =========================
// SIMILARITY SCORE
// =========================

function similarityScore(current, historical) {
    if (!current || !historical) {
        return 0;
    }

    let score = 0;

    // =========================
    // EMA TREND
    // =========================

    const currentEma =
        Number(current.ema20) -
        Number(current.ema50);

    const historicalEma =
        Number(historical.ema20) -
        Number(historical.ema50);

    if (
        Number.isFinite(currentEma) &&
        Number.isFinite(historicalEma)
    ) {
        if (
            Math.sign(currentEma) ===
            Math.sign(historicalEma)
        ) {
            score += 30;
        }
    }

    // =========================
    // RSI
    // =========================

    const currentRsi =
        Number(current.rsi);

    const historicalRsi =
        Number(historical.rsi);

    if (
        Number.isFinite(currentRsi) &&
        Number.isFinite(historicalRsi)
    ) {
        const difference =
            Math.abs(
                currentRsi -
                historicalRsi
            );

        if (difference <= 5) {
            score += 25;
        } else if (difference <= 10) {
            score += 15;
        } else if (difference <= 15) {
            score += 8;
        }
    }

    // =========================
    // ADX
    // =========================

    const currentAdx =
        Number(current.adx);

    const historicalAdx =
        Number(historical.adx);

    if (
        Number.isFinite(currentAdx) &&
        Number.isFinite(historicalAdx)
    ) {
        const difference =
            Math.abs(
                currentAdx -
                historicalAdx
            );

        if (difference <= 5) {
            score += 20;
        } else if (difference <= 10) {
            score += 10;
        }
    }

    // =========================
    // MACD DIRECTION
    // =========================

    if (
        current.macd &&
        historical.macd
    ) {
        const currentMacd =
            Number(current.macd.macd) >
            Number(current.macd.signal);

        const historicalMacd =
            Number(historical.macd.macd) >
            Number(historical.macd.signal);

        if (
            currentMacd ===
            historicalMacd
        ) {
            score += 25;
        }
    }

    return Math.min(
        100,
        Math.max(0, score)
    );
}

// =========================
// SIMULATE HISTORICAL TRADE
// =========================

function simulateOutcome(
    candles,
    index,
    direction
) {
    const entry =
        Number(candles[index].close);

    if (!Number.isFinite(entry)) {
        return null;
    }

    const future =
        candles.slice(
            index + 1,
            index + 1 + FUTURE_CANDLES
        );

    if (
        future.length <
        FUTURE_CANDLES
    ) {
        return null;
    }

    const previous =
        candles.slice(
            Math.max(0, index - 10),
            index
        );

    if (previous.length < 5) {
        return null;
    }

    const ranges =
        previous
            .map(
                (candle) =>
                    Number(candle.high) -
                    Number(candle.low)
            )
            .filter(
                Number.isFinite
            );

    if (!ranges.length) {
        return null;
    }

    const avgRange =
        ranges.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / ranges.length;

    if (
        !Number.isFinite(avgRange) ||
        avgRange <= 0
    ) {
        return null;
    }

    const tp1Distance =
        avgRange * 1.0;

    const tp2Distance =
        avgRange * 1.8;

    const slDistance =
        avgRange * 1.0;

    const tp1 =
        direction === 'BUY'
            ? entry + tp1Distance
            : entry - tp1Distance;

    const tp2 =
        direction === 'BUY'
            ? entry + tp2Distance
            : entry - tp2Distance;

    const sl =
        direction === 'BUY'
            ? entry - slDistance
            : entry + slDistance;

    let tp1Hit = false;
    let tp2Hit = false;
    let slHit = false;

    for (const candle of future) {
        const high =
            Number(candle.high);

        const low =
            Number(candle.low);

        if (
            !Number.isFinite(high) ||
            !Number.isFinite(low)
        ) {
            continue;
        }

        // =========================
        // BUY
        // =========================

        if (direction === 'BUY') {
            if (low <= sl) {
                slHit = true;
                break;
            }

            if (high >= tp1) {
                tp1Hit = true;
            }

            if (high >= tp2) {
                tp2Hit = true;
                break;
            }
        }

        // =========================
        // SELL
        // =========================

        else {
            if (high >= sl) {
                slHit = true;
                break;
            }

            if (low <= tp1) {
                tp1Hit = true;
            }

            if (low <= tp2) {
                tp2Hit = true;
                break;
            }
        }
    }

    return {
        tp1Hit,
        tp2Hit,
        slHit
    };
}

// =========================
// SIGNAL LAB
// =========================

async function runSignalLab(
    pair,
    currentIndicators,
    direction
) {
    try {
        if (
            !pair ||
            !currentIndicators ||
            !direction ||
            direction === 'WAIT'
        ) {
            return {
                approved: false,
                historicalScore: 0,
                similarSetups: 0,
                tp1Rate: 0,
                tp2Rate: 0,
                slRate: 0,
                directionMatchRate: 0,
                reason: 'Invalid setup'
            };
        }

        console.log(
            `🧪 SIGNAL LAB STARTED: ${pair} ${direction}`
        );

        const candles =
            await getCandles(pair);

        if (
            !candles ||
            candles.length < 25
        ) {
            return {
                approved: false,
                historicalScore: 0,
                similarSetups: 0,
                tp1Rate: 0,
                tp2Rate: 0,
                slRate: 0,
                directionMatchRate: 0,
                reason:
                    'Not enough historical candles'
            };
        }

        console.log(
            `📚 SIGNAL LAB candles: ${candles.length}`
        );

        const historical = [];

        // =========================
        // SEARCH HISTORY
        // =========================

        for (
            let i = 15;
            i <
            candles.length -
                FUTURE_CANDLES;
            i++
        ) {
            const window =
                candles.slice(
                    Math.max(0, i - 14),
                    i + 1
                );

            if (window.length < 10) {
                continue;
            }

            let indicators;

            try {
                indicators =
                    analyzeIndicators(
                        window
                    );
            } catch (error) {
                continue;
            }

            if (!indicators) {
                continue;
            }

            const historicalDirection =
                directionFromIndicators(
                    indicators
                );

            const similarity =
                similarityScore(
                    currentIndicators,
                    indicators
                );

            // =========================
            // SIMILARITY FILTER
            // =========================

            if (
                !Number.isFinite(similarity) ||
                similarity <
                    MIN_SIMILARITY
            ) {
                continue;
            }

            const outcome =
                simulateOutcome(
                    candles,
                    i,
                    direction
                );

            if (!outcome) {
                continue;
            }

            historical.push({
                similarity,

                directionMatch:
                    historicalDirection ===
                    direction,

                historicalDirection,

                ...outcome
            });
        }

        // =========================
        // NO HISTORY
        // =========================

        if (!historical.length) {
            console.log(
                `🟡 SIGNAL LAB: no similar setups for ${pair}`
            );

            return {
                approved: false,
                historicalScore: 0,
                similarSetups: 0,
                tp1Rate: 0,
                tp2Rate: 0,
                slRate: 0,
                directionMatchRate: 0,
                reason:
                    'No similar historical setups'
            };
        }

        // =========================
        // SORT BY SIMILARITY
        // =========================

        historical.sort(
            (a, b) =>
                b.similarity -
                a.similarity
        );

        const selected =
            historical.slice(
                0,
                MAX_HISTORICAL
            );

        const total =
            selected.length;

        // =========================
        // RESULTS
        // =========================

        const tp1Count =
            selected.filter(
                (item) =>
                    item.tp1Hit
            ).length;

        const tp2Count =
            selected.filter(
                (item) =>
                    item.tp2Hit
            ).length;

        const slCount =
            selected.filter(
                (item) =>
                    item.slHit
            ).length;

        const directionMatches =
            selected.filter(
                (item) =>
                    item.directionMatch
            ).length;

        const tp1Rate =
            Math.round(
                (tp1Count / total) *
                    100
            );

        const tp2Rate =
            Math.round(
                (tp2Count / total) *
                    100
            );

        const slRate =
            Math.round(
                (slCount / total) *
                    100
            );

        const directionMatchRate =
            Math.round(
                (directionMatches /
                    total) *
                    100
            );

        // =========================
        // HISTORICAL SCORE
        // =========================

        let historicalScore =
            tp1Rate * 0.40 +
            tp2Rate * 0.25 +
            (100 - slRate) * 0.20 +
            directionMatchRate * 0.15;

        // =========================
        // SMALL SAMPLE PENALTY
        // =========================

        /*
         * لو عندنا حالات قليلة جدًا،
         * نقلل الثقة بدل ما نخلي
         * النتيجة تبدو قوية بشكل وهمي.
         */

        if (total < 5) {
            historicalScore *= 0.75;
        } else if (total < 10) {
            historicalScore *= 0.90;
        }

        historicalScore =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        historicalScore
                    )
                )
            );

        // =========================
        // APPROVAL
        // =========================

        const approved =
            total >= MIN_SIMILAR &&
            historicalScore >= 60 &&
            tp1Rate >= 55 &&
            slRate <= 45;

        console.log(
            `🧪 SIGNAL LAB RESULT ${pair}:`,
            {
                direction,
                similarSetups: total,
                tp1Rate,
                tp2Rate,
                slRate,
                directionMatchRate,
                historicalScore,
                approved
            }
        );

        return {
            approved,

            historicalScore,

            similarSetups: total,

            tp1Rate,

            tp2Rate,

            slRate,

            directionMatchRate,

            reason: approved
                ? 'Historical validation passed'
                : 'Historical validation failed'
        };

    } catch (error) {
        console.log(
            `❌ Signal Lab error ${pair}:`,
            error.message
        );

        return {
            approved: false,
            historicalScore: 0,
            similarSetups: 0,
            tp1Rate: 0,
            tp2Rate: 0,
            slRate: 0,
            directionMatchRate: 0,
            reason: error.message
        };
    }
}

module.exports = {
    runSignalLab
};
