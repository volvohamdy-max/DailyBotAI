const { isPairMarketOpen } = require('../utils/marketHours');
const { analyzePair } = require('./analysisGate');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');

const SCANNER_PAIRS = [
    'XAUUSD',
    'BTCUSD',
    'EURUSD',
    'GBPUSD',
    'USDJPY',
    'EURJPY',
    'GBPJPY',
    'CHFJPY'
];

// =====================================================
// SMART TECHNICAL SCORE
// =====================================================

function calculateTechnicalScore(
    indicators,
    direction = 'WAIT'
) {
    if (!indicators) {
        return 0;
    }

    const ema20 = Number(indicators.ema20);
    const ema50 = Number(indicators.ema50);
    const rsi = Number(indicators.rsi);
    const adx = Number(indicators.adx);

    let score = 0;

    // =================================================
    // EMA TREND - 30 POINTS
    // =================================================

    if (
        Number.isFinite(ema20) &&
        Number.isFinite(ema50)
    ) {
        if (
            direction === 'BUY' &&
            ema20 > ema50
        ) {
            score += 30;
        }

        if (
            direction === 'SELL' &&
            ema20 < ema50
        ) {
            score += 30;
        }
    }

    // =================================================
    // RSI - 20 POINTS
    // =================================================

    if (Number.isFinite(rsi)) {

        if (direction === 'BUY') {

            if (rsi >= 52 && rsi <= 68) {
                score += 20;
            } else if (rsi > 50 && rsi < 72) {
                score += 14;
            } else if (rsi >= 45 && rsi < 50) {
                score += 6;
            } else if (rsi >= 70) {
                score -= 8;
            }

        } else if (direction === 'SELL') {

            if (rsi <= 48 && rsi >= 32) {
                score += 20;
            } else if (rsi < 50 && rsi > 28) {
                score += 14;
            } else if (rsi > 50 && rsi <= 55) {
                score += 6;
            } else if (rsi <= 30) {
                score -= 8;
            }
        }
    }

    // =================================================
    // MACD - 25 POINTS
    // =================================================

    if (
        indicators.macd &&
        Number.isFinite(
            Number(indicators.macd.macd)
        ) &&
        Number.isFinite(
            Number(indicators.macd.signal)
        )
    ) {

        const macd =
            Number(indicators.macd.macd);

        const signal =
            Number(indicators.macd.signal);

        if (
            direction === 'BUY' &&
            macd > signal
        ) {
            score += 25;
        }

        if (
            direction === 'SELL' &&
            macd < signal
        ) {
            score += 25;
        }
    }

    // =================================================
    // ADX - 25 POINTS
    // =================================================

    if (Number.isFinite(adx)) {

        if (adx >= 35) {
            score += 25;
        } else if (adx >= 30) {
            score += 20;
        } else if (adx >= 25) {
            score += 15;
        } else if (adx >= 20) {
            score += 8;
        } else {
            score -= 5;
        }
    }

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(score)
        )
    );
}

// =====================================================
// TECHNICAL DIRECTION
// =====================================================

function getTechnicalDirection(indicators) {

    if (!indicators) {
        return 'WAIT';
    }

    const ema20 =
        Number(indicators.ema20);

    const ema50 =
        Number(indicators.ema50);

    const rsi =
        Number(indicators.rsi);

    let buyScore = 0;
    let sellScore = 0;

    // EMA

    if (
        Number.isFinite(ema20) &&
        Number.isFinite(ema50)
    ) {

        if (ema20 > ema50) {
            buyScore++;
        }

        if (ema20 < ema50) {
            sellScore++;
        }
    }

    // RSI

    if (Number.isFinite(rsi)) {

        if (rsi > 50 && rsi < 70) {
            buyScore++;
        }

        if (rsi < 50 && rsi > 30) {
            sellScore++;
        }
    }

    // MACD

    if (
        indicators.macd &&
        Number.isFinite(
            Number(indicators.macd.macd)
        ) &&
        Number.isFinite(
            Number(indicators.macd.signal)
        )
    ) {

        const macd =
            Number(indicators.macd.macd);

        const signal =
            Number(indicators.macd.signal);

        if (macd > signal) {
            buyScore++;
        }

        if (macd < signal) {
            sellScore++;
        }
    }

    if (
        buyScore > sellScore &&
        buyScore >= 2
    ) {
        return 'BUY';
    }

    if (
        sellScore > buyScore &&
        sellScore >= 2
    ) {
        return 'SELL';
    }

    return 'WAIT';
}

// =====================================================
// AI CONFIDENCE
// =====================================================

function getAIConfidence(signal) {

    if (!signal) {
        return null;
    }

    const confidence =
        Number(signal.confidence);

    if (!Number.isFinite(confidence)) {
        return null;
    }

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(confidence)
        )
    );
}

// =====================================================
// SCAN MARKETS
// =====================================================

async function scanMarkets() {

    const results = [];

    for (const pair of SCANNER_PAIRS) {

        if (!isPairMarketOpen(pair)) {
            console.log(
                `🌙 Market closed — scanner skipped ${pair}`
            );
            continue;
        }

        try {

            console.log(
                `🔎 Smart Scanner analyzing ${pair}...`
            );

            const result =
                await analyzePair(pair);

            if (
                !result ||
                !result.indicators
            ) {

                console.log(
                    `⚠️ No analysis for ${pair}`
                );

                continue;
            }

            const indicators =
                result.indicators;

            // =================================================
            // AI DIRECTION
            // =================================================

            let action = 'WAIT';

            if (
                result.signal &&
                (
                    result.signal.action === 'BUY' ||
                    result.signal.action === 'SELL'
                )
            ) {

                action =
                    result.signal.action;

            } else {

                action =
                    getTechnicalDirection(
                        indicators
                    );
            }

            // =================================================
            // SMART SCORE
            // =================================================

            let score =
                calculateTechnicalScore(
                    indicators,
                    action
                );

            // =================================================
            // AI CONFIDENCE
            // =================================================

            const confidence =
                getAIConfidence(
                    result.signal
                );

            // =================================================
            // COMBINE TECHNICAL + AI
            // =================================================

            if (
                confidence !== null &&
                (
                    action === 'BUY' ||
                    action === 'SELL'
                )
            ) {

                score =
                    Math.round(
                        score * 0.65 +
                        confidence * 0.35
                    );
            }

            // =================================================
            // WAIT PROTECTION
            // =================================================

            if (action === 'WAIT') {
                score = Math.min(
                    score,
                    45
                );
            }

            // =================================================
            // RESULT
            // =================================================

            results.push({

                pair:
                    pair.toUpperCase(),

                action,

                score,

                confidence,
                scalpEntry: null,
                indicators

            });

            console.log(
                `📊 SMART RESULT ${pair}:`,
                {
                    action,
                    score,
                    confidence
                }
            );

        } catch (error) {

            console.log(
                `❌ Scanner error ${pair}:`,
                error.message
            );
        }
    }


    // =====================================================
    // TWO-STAGE SCALPING 5M SELECTION
    // Stage 1: all pairs on 15M
    // Stage 2: XAUUSD + best 2 actionable candidates on 5M
    // =====================================================

    const actionable = results
        .filter(
            (row) =>
                (row.action === 'BUY' ||
                 row.action === 'SELL') &&
                Number(row.confidence) >= 60
        )
        .sort(
            (a, b) =>
                Number(b.score || 0) -
                Number(a.score || 0)
        );

    const selectedPairs = new Set();

    for (const row of actionable) {
        if (selectedPairs.size >= 3) break;
        selectedPairs.add(row.pair);
    }

    console.log(
        '⚡ 5M SCALP BUDGET:',
        [...selectedPairs]
    );

    for (const row of results) {
        if (
            row.action !== 'BUY' &&
            row.action !== 'SELL'
        ) {
            row.scalpEntry = {
                status: 'NOT_APPLICABLE',
                reason: 'NO_ACTION'
            };
            continue;
        }

        if (!selectedPairs.has(row.pair)) {
            row.scalpEntry = {
                status: 'NOT_CHECKED',
                reason: '5M_BUDGET'
            };

            // Keep it visible in Market Map,
            // but never let an unchecked setup look premium.
            row.score = Math.min(
                Number(row.score || 0),
                64
            );

            console.log(
                `🟦 5M skipped ${row.pair}: budget optimization`
            );

            continue;
        }

        try {
            const scalpEntry =
                await evaluateScalpEntry(
                    row.pair,
                    row.action,
                    row.indicators
                );

            row.scalpEntry = scalpEntry;

            row.score = Math.max(
                0,
                Math.min(
                    100,
                    Number(row.score || 0) +
                    Number(
                        scalpEntry.scoreAdjustment || 0
                    )
                )
            );

            if (scalpEntry.status === 'REJECT') {
                console.log(
                    `❌ SCALP ENTRY REJECTED ${row.pair}: ${scalpEntry.reason}`
                );

                row.action = 'WAIT';
                row.score = Math.min(
                    row.score,
                    35
                );
            } else if (
                scalpEntry.status ===
                'WAIT_PULLBACK'
            ) {
                console.log(
                    `🟡 WAIT PULLBACK ${row.pair}: ${scalpEntry.reason}`
                );

                row.action = 'WAIT';
                row.score = Math.min(
                    row.score,
                    45
                );
            } else if (
                scalpEntry.status === 'WAIT'
            ) {
                console.log(
                    `🟡 SCALP WAIT ${row.pair}: ${scalpEntry.reason}`
                );

                row.action = 'WAIT';
                row.score = Math.min(
                    row.score,
                    55
                );
            } else if (
                scalpEntry.status ===
                'ENTRY_READY'
            ) {
                console.log(
                    `✅ SCALP ENTRY READY ${row.pair} | 5M=${scalpEntry.trigger5m}`
                );
            }
        } catch (error) {
            row.scalpEntry = {
                status: 'ERROR',
                reason: error.message
            };

            row.action = 'WAIT';
            row.score = Math.min(
                Number(row.score || 0),
                35
            );

            console.log(
                `⚠️ 5M scalp check failed ${row.pair}: ${error.message}`
            );
        }
    }

    // =====================================================
    // SORT
    // =====================================================

    return results
        .sort(
            (a, b) =>
                Number(b.score || 0) -
                Number(a.score || 0)
        )
        .slice(0, 5);
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
    scanMarkets,
    calculateTechnicalScore,
    getTechnicalDirection
};
