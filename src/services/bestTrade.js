const { scanMarkets } = require('./smartScanner');
const { analyzePair } = require('./analysisService');
const { runSignalLab } = require('./signalLab');
const { getCandles } = require('./marketService');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');
const {
  calculateTradeLevels,
  technicalScoreFromAnalysis,
  calculateFinalScore,
  getStrength
} = require('./tradeEngine');

const MIN_FINAL_SCORE = 60;
const MIN_SMART_SCORE = 55;
const MIN_AI_CONFIDENCE = 60;

// =====================================================
// أفضل صفقة
// =====================================================

let lastRejectedCandidates = [];

function rememberRejected(candidate, direction, aiConfidence, reason) {
    if (!candidate || !candidate.pair) return;

    lastRejectedCandidates.push({
        pair: candidate.pair,
        action: direction || candidate.action || 'WAIT',
        smartScore: Number(candidate.score ?? candidate.smartScore ?? 0) || 0,
        aiConfidence: Number(aiConfidence) || 0,
        reason
    });
}

function getLastRejectedCandidates(limit = 2) {
    return [...lastRejectedCandidates]
        .sort((a, b) => {
            if (b.aiConfidence !== a.aiConfidence) {
                return b.aiConfidence - a.aiConfidence;
            }

            return b.smartScore - a.smartScore;
        })
        .slice(0, Math.max(1, Number(limit) || 2));
}

async function getBestTrade() {
    lastRejectedCandidates = [];

    console.log('🎯 BEST TRADE SCAN STARTED');

    let markets;

    try {
        markets = await scanMarkets();
    } catch (error) {

        console.log(
            '❌ Smart Scanner error:',
            error.message
        );

        return null;
    }

    if (
        !Array.isArray(markets) ||
        markets.length === 0
    ) {

        console.log(
            '🟡 Smart Scanner returned no candidates'
        );

        return null;
    }


    // =================================================
    // المرشحون BUY / SELL فقط
    // =================================================

    const candidates = markets
        .filter(item =>
            item &&
            (
                item.action === 'BUY' ||
                item.action === 'SELL'
            )
        )
        .sort(
            (a, b) =>
                Number(b.score || 0) -
                Number(a.score || 0)
        );


    if (candidates.length === 0) {

        console.log(
            '🟡 No BUY/SELL candidates'
        );

        return null;
    }


    const results = [];


    // =================================================
    // تحليل كل مرشح
    // =================================================

    for (const candidate of candidates) {

        // =============================================
        // SCALPING 5M SAFETY
        // Best Trade requires a real 5M ENTRY_READY
        // =============================================

        if (
            candidate.action !== 'BUY' &&
            candidate.action !== 'SELL'
        ) {
            console.log(
                `🟡 SCALP WAIT candidate skipped: ${candidate.pair}`
            );
            continue;
        }

        let scalpEntry = null;

        try {
            const preAnalysis =
                await analyzePair(candidate.pair);

            scalpEntry =
                await evaluateScalpEntry(
                    candidate.pair,
                    candidate.action,
                    preAnalysis?.indicators || {}
                );

            candidate.scalpEntry = scalpEntry;

            console.log(
                `⏱️ 5M ENTRY CHECK ${candidate.pair}: ${scalpEntry?.status || 'ERROR'}`
            );

        } catch (error) {

            console.log(
                `⚠️ 5M entry check failed ${candidate.pair}:`,
                error.message
            );

            scalpEntry = {
                status: 'ERROR',
                reason: error.message
            };

            candidate.scalpEntry = scalpEntry;
        }

        if (
            !scalpEntry ||
            scalpEntry.status !== 'ENTRY_READY'
        ) {
            console.log(
                `🟡 5M entry not ready: ${candidate.pair} / ${scalpEntry?.status || 'ERROR'}`
            );

            lastRejectedCandidates.push({
                pair: candidate.pair,
                action: candidate.action || 'WAIT',
                smartScore: Number(candidate.score || 0),
                aiConfidence: Number(candidate.confidence || 0),
                reason: 'SCALP_NOT_READY',
                scalpStatus: scalpEntry?.status || 'ERROR'
            });

            continue;
        }

        try {

            console.log(
                `🎯 BEST TRADE CHECK: ${candidate.pair} ${candidate.action}`
            );


            // =============================================
            // التحليل الكامل
            // =============================================

            const analysis =
                await analyzePair(candidate.pair);


            if (
                !analysis ||
                !analysis.indicators
            ) {

                console.log(
                    `⚠️ No indicators for ${candidate.pair}`
                );

                continue;
            }


            const indicators =
                analysis.indicators;


            const scannerDirection =
                candidate.action;


            // =============================================
            // Smart Score
            // =============================================

            const smartScore =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Number(candidate.score) || 0
                    )
                );


            if (
                smartScore <
                MIN_SMART_SCORE
            ) {

                console.log(
                    `🟡 Smart Score too low: ${candidate.pair} ${smartScore}`
                );

                continue;
            }


            // =============================================
            // AI
            // =============================================

            let aiConfidence = 0;
            let aiDirection = null;


            if (
                analysis.signal &&
                (
                    analysis.signal.action === 'BUY' ||
                    analysis.signal.action === 'SELL'
                )
            ) {

                aiDirection =
                    analysis.signal.action;


                const confidence =
                    Number(
                        analysis.signal.confidence
                    );


                if (
                    Number.isFinite(confidence)
                ) {

                    aiConfidence =
                        Math.max(
                            0,
                            Math.min(
                                100,
                                Math.round(confidence)
                            )
                        );
                }
            }


            console.log(
                `🤖 ${candidate.pair} Scanner=${scannerDirection} AI=${aiDirection || 'NONE'} Confidence=${aiConfidence}%`
            );


            // =============================================
            // AI confirmation is mandatory
            // =============================================

            if (!aiDirection) {
                console.log(
                    `❌ AI confirmation missing: ${candidate.pair}`
                );

                rememberRejected(
                    candidate,
                    scannerDirection,
                    aiConfidence,
                    'AI_MISSING'
                );

                continue;
            }


            // =============================================
            // AI direction must match scanner direction
            // =============================================

            if (
                aiDirection !== scannerDirection
            ) {
                console.log(
                    `❌ AI direction mismatch: ${candidate.pair}`
                );

                rememberRejected(
                    candidate,
                    scannerDirection,
                    aiConfidence,
                    'AI_MISMATCH'
                );

                continue;
            }


            // =============================================
            // Minimum AI confidence
            // =============================================

            if (
                aiConfidence < 60
            ) {
                console.log(
                    `⚠️ Low AI confidence: ${candidate.pair} ${aiConfidence}%`
                );

                rememberRejected(
                    candidate,
                    scannerDirection,
                    aiConfidence,
                    'AI_LOW_CONFIDENCE'
                );

                continue;
            }


            // =============================================
            // TECHNICAL SCORE
            // =============================================

            const direction = scannerDirection;

            const technicalScore =
                technicalScoreFromAnalysis(
                    analysis,
                    direction
                );

            // =============================================
            // SIGNAL LAB / HISTORICAL PERFORMANCE
            // =============================================

            let historicalScore = 0;
            let similarSetups = 0;
            let tp1Rate = 0;
            let tp2Rate = 0;
            let slRate = 0;
            let labApproved = false;

            try {
                const lab =
                    await runSignalLab(
                        candidate.pair,
                        direction
                    );

                if (lab) {
                    historicalScore =
                        Number(
                            lab.historicalScore ??
                            lab.score ??
                            0
                        ) || 0;

                    similarSetups =
                        Number(
                            lab.similarSetups ??
                            lab.total ??
                            0
                        ) || 0;

                    tp1Rate =
                        Number(
                            lab.tp1Rate ??
                            lab.tp1SuccessRate ??
                            0
                        ) || 0;

                    tp2Rate =
                        Number(
                            lab.tp2Rate ??
                            lab.tp2SuccessRate ??
                            0
                        ) || 0;

                    slRate =
                        Number(
                            lab.slRate ??
                            lab.stopLossRate ??
                            0
                        ) || 0;

                    labApproved =
                        Boolean(
                            lab.approved ??
                            lab.labApproved ??
                            false
                        );
                }

            } catch (labError) {

                console.log(
                    `⚠️ Signal Lab unavailable ${candidate.pair}:`,
                    labError.message
                );
            }

            // =============================================
            // SMART TP / SL
            // =============================================

            const candles =
                await getCandles(
                    candidate.pair,
                    '15min'
                );

            const levels =
                calculateTradeLevels(
                    candles,
                    direction,
                    candidate.pair
                );

            if (!levels) {

                console.log(
                    `❌ Invalid trade levels: ${candidate.pair}`
                );

                continue;
            }

            // =============================================
            // FINAL SCORE
            // =============================================

            const finalScore =
                calculateFinalScore({
                    smartScore,
                    aiConfidence,
                    technicalScore,
                    historicalScore,
                    similarSetups,
                    tp1Rate,
                    slRate,
                    labApproved
                });

            // =============================================
            // قوة الصفقة
            // =============================================

            const strength =
                getStrength(
                    finalScore
                );


            // =============================================
            // النتيجة
            // =============================================

            results.push({

                pair:
                    candidate.pair,

                action:
                    direction,

                smartScore,

                technicalScore,

                confidence:
                    aiConfidence,

                historicalScore,

                similarSetups,

                tp1Rate,

                tp2Rate,

                slRate,

                approved:
                    labApproved,

                finalScore,

                strength,

                entry:
                    levels.entry,

                tp1:
                    levels.tp1,

                tp2:
                    levels.tp2,

                sl:
                    levels.sl,

                atr:
                    levels.atr,

                riskDistance:
                    levels.riskDistance,

                rrTp1:
                    levels.rrTp1,

                rrTp2:
                    levels.rrTp2,

                indicators
            });


            console.log(
                `✅ BEST TRADE CANDIDATE ${candidate.pair}:`,
                {
                    direction,
                    smartScore,
                    aiConfidence,
                    historicalScore,
                    similarSetups,
                    finalScore,
                    entry: levels.entry,
                    tp1: levels.tp1,
                    tp2: levels.tp2,
                    sl: levels.sl
                }
            );


        } catch (error) {

            console.log(
                `❌ Best Trade error ${candidate.pair}:`,
                error.message
            );
        }
    }


    // =====================================================
    // لا توجد نتائج
    // =====================================================

    if (
        results.length === 0
    ) {

        console.log(
            '🟡 No analyzable candidates'
        );

        return null;
    }


    // =====================================================
    // ترتيب الصفقات
    //
    // الأولوية:
    // 1- Final Score
    // 2- AI Confidence
    // 3- Historical Score
    // =====================================================

    results.sort(
        (a, b) => {

            if (
                b.finalScore !==
                a.finalScore
            ) {

                return (
                    b.finalScore -
                    a.finalScore
                );
            }


            if (
                b.confidence !==
                a.confidence
            ) {

                return (
                    b.confidence -
                    a.confidence
                );
            }


            return (
                b.historicalScore -
                a.historicalScore
            );
        }
    );


    // =====================================================
    // أفضل صفقة
    // =====================================================

    const best =
        results[0];


    console.log(
        '🏆 BEST TRADE SELECTED:',
        {
            pair: best.pair,
            action: best.action,
            finalScore: best.finalScore,
            smartScore: best.smartScore,
            aiConfidence: best.confidence,
            historicalScore: best.historicalScore
        }
    );


    // =====================================================
    // فلتر نهائي
    // =====================================================

    if (
        best.finalScore <
        MIN_FINAL_SCORE
    ) {

        console.log(
            `🟡 Market too weak: ${best.pair}`,
            {
                smartScore:
                    best.smartScore,

                aiConfidence:
                    best.confidence,

                historicalScore:
                    best.historicalScore,

                similarSetups:
                    best.similarSetups,

                finalScore:
                    best.finalScore
            }
        );


        return null;
    }


    return best;
}


module.exports = {
    getBestTrade,
    getLastRejectedCandidates
};
