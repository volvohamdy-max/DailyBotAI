const { isPairMarketOpen } = require('../utils/marketHours');
const { analyzePair } = require('./analysisGate');
const { evaluateScalpEntry } = require('./scalpingEntryEngine');

const ALWAYS_SCAN = ['XAUUSD', 'BTCUSD'];
const FX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY'];
// One FX pair per cycle by default greatly reduces TwelveData/Sifting bursts.
// Override with SMART_SCANNER_FX_BATCH_SIZE if a larger batch is explicitly desired.
const FX_BATCH_SIZE = Number(process.env.SMART_SCANNER_FX_BATCH_SIZE) || 1;
const SNAPSHOT_MAX_AGE_MS = Number(process.env.SMART_SCANNER_SNAPSHOT_MAX_AGE_MS) || 20 * 60 * 1000;
const PAIR_TIMEOUT_MS = Number(process.env.SMART_SCANNER_PAIR_TIMEOUT_MS) || 20000;

const snapshots = new Map();
let fxCursor = 0;

function calculateTechnicalScore(indicators, direction = 'WAIT') {
    if (!indicators) return 0;
    const ema20 = Number(indicators.ema20);
    const ema50 = Number(indicators.ema50);
    const rsi = Number(indicators.rsi);
    const adx = Number(indicators.adx);
    let score = 0;

    if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
        if (direction === 'BUY' && ema20 > ema50) score += 30;
        if (direction === 'SELL' && ema20 < ema50) score += 30;
    }

    if (Number.isFinite(rsi)) {
        if (direction === 'BUY') {
            if (rsi >= 52 && rsi <= 68) score += 20;
            else if (rsi > 50 && rsi < 72) score += 14;
            else if (rsi >= 45 && rsi < 50) score += 6;
            else if (rsi >= 70) score -= 8;
        } else if (direction === 'SELL') {
            if (rsi <= 48 && rsi >= 32) score += 20;
            else if (rsi < 50 && rsi > 28) score += 14;
            else if (rsi > 50 && rsi <= 55) score += 6;
            else if (rsi <= 30) score -= 8;
        }
    }

    if (indicators.macd && Number.isFinite(Number(indicators.macd.macd)) && Number.isFinite(Number(indicators.macd.signal))) {
        const macd = Number(indicators.macd.macd);
        const signal = Number(indicators.macd.signal);
        if (direction === 'BUY' && macd > signal) score += 25;
        if (direction === 'SELL' && macd < signal) score += 25;
    }

    if (Number.isFinite(adx)) {
        if (adx >= 35) score += 25;
        else if (adx >= 30) score += 20;
        else if (adx >= 25) score += 15;
        else if (adx >= 20) score += 8;
        else score -= 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
}

function getTechnicalDirection(indicators) {
    if (!indicators) return 'WAIT';
    const ema20 = Number(indicators.ema20);
    const ema50 = Number(indicators.ema50);
    const rsi = Number(indicators.rsi);
    let buyScore = 0;
    let sellScore = 0;

    if (Number.isFinite(ema20) && Number.isFinite(ema50)) {
        if (ema20 > ema50) buyScore++;
        if (ema20 < ema50) sellScore++;
    }
    if (Number.isFinite(rsi)) {
        if (rsi > 50 && rsi < 70) buyScore++;
        if (rsi < 50 && rsi > 30) sellScore++;
    }
    if (indicators.macd && Number.isFinite(Number(indicators.macd.macd)) && Number.isFinite(Number(indicators.macd.signal))) {
        const macd = Number(indicators.macd.macd);
        const signal = Number(indicators.macd.signal);
        if (macd > signal) buyScore++;
        if (macd < signal) sellScore++;
    }
    if (buyScore > sellScore && buyScore >= 2) return 'BUY';
    if (sellScore > buyScore && sellScore >= 2) return 'SELL';
    return 'WAIT';
}

function getAIConfidence(signal) {
    if (!signal) return null;
    const confidence = Number(signal.confidence);
    if (!Number.isFinite(confidence)) return null;
    return Math.max(0, Math.min(100, Math.round(confidence)));
}

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SCANNER_TIMEOUT_${label}_${Math.round(ms / 1000)}S`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function nextFxBatch() {
    const count = Math.max(1, Math.min(FX_BATCH_SIZE, FX_PAIRS.length));
    const batch = [];
    for (let i = 0; i < count; i++) {
        batch.push(FX_PAIRS[(fxCursor + i) % FX_PAIRS.length]);
    }
    fxCursor = (fxCursor + count) % FX_PAIRS.length;
    return batch;
}

function buildRow(pair, result) {
    if (!result || !result.indicators) return null;
    const indicators = result.indicators;
    const validAIAction = result.signal && (result.signal.action === 'BUY' || result.signal.action === 'SELL');
    const aiWasRequired = result.technicalDirection === 'BUY' || result.technicalDirection === 'SELL';

    let action = 'WAIT';
    if (validAIAction) {
        action = result.signal.action;
    } else if (!aiWasRequired) {
        // No AI validation was required because technical analysis itself had no
        // strong direction. Keep the row descriptive only.
        action = getTechnicalDirection(indicators);
    }

    let score = calculateTechnicalScore(indicators, action);
    const confidence = getAIConfidence(result.signal);

    if (confidence !== null && (action === 'BUY' || action === 'SELL')) {
        score = Math.round(score * 0.65 + confidence * 0.35);
    }

    // Fail closed: when technical analysis triggered the AI gate but AI returned
    // no valid BUY/SELL, this scanner result must not masquerade as actionable.
    if (aiWasRequired && !validAIAction) {
        action = 'WAIT';
        score = Math.min(score, 45);
    }

    if (action === 'WAIT') score = Math.min(score, 45);

    return {
        pair: pair.toUpperCase(),
        action,
        score,
        confidence,
        aiValidated: Boolean(validAIAction),
        scalpEntry: null,
        indicators,
        analyzedAt: Date.now(),
        freshThisCycle: true
    };
}

async function analyzeOne(pair) {
    if (!isPairMarketOpen(pair)) {
        console.log(`🌙 Market closed — scanner skipped ${pair}`);
        return null;
    }

    console.log(`🔎 Smart Scanner analyzing ${pair}...`);
    const result = await withTimeout(analyzePair(pair), PAIR_TIMEOUT_MS, pair);
    const row = buildRow(pair, result);
    if (!row) {
        console.log(`⚠️ No analysis for ${pair}`);
        return null;
    }

    snapshots.set(pair, { row: { ...row, freshThisCycle: false }, time: Date.now() });
    console.log(`📊 SMART RESULT ${pair}:`, {
        action: row.action,
        score: row.score,
        confidence: row.confidence,
        aiValidated: row.aiValidated
    });
    return row;
}

function addRecentSnapshots(results, scannedSet) {
    const now = Date.now();
    for (const pair of [...ALWAYS_SCAN, ...FX_PAIRS]) {
        if (scannedSet.has(pair)) continue;
        const snap = snapshots.get(pair);
        if (!snap) continue;
        const age = now - snap.time;
        if (age > SNAPSHOT_MAX_AGE_MS) {
            snapshots.delete(pair);
            continue;
        }
        results.push({
            ...snap.row,
            freshThisCycle: false,
            snapshotAgeMs: age
        });
    }
}

async function scanMarkets() {
    const results = [];
    const fxBatch = nextFxBatch();
    const pairsThisCycle = [...ALWAYS_SCAN, ...fxBatch];
    const scannedSet = new Set(pairsThisCycle);

    console.log(`🧭 Smart Scanner FX rotation: ${fxBatch.join(', ')}`);

    for (const pair of pairsThisCycle) {
        try {
            const row = await analyzeOne(pair);
            if (row) results.push(row);
        } catch (error) {
            console.log(`❌ Scanner error ${pair}:`, error.message);
            const snap = snapshots.get(pair);
            if (snap && Date.now() - snap.time <= SNAPSHOT_MAX_AGE_MS) {
                console.log(`🛟 Scanner snapshot fallback ${pair}: ${Math.round((Date.now() - snap.time) / 60000)}m old`);
                results.push({
                    ...snap.row,
                    freshThisCycle: false,
                    snapshotAgeMs: Date.now() - snap.time
                });
            }
        }
    }

    addRecentSnapshots(results, scannedSet);

    const actionable = results
        .filter(row =>
            row.freshThisCycle === true &&
            row.aiValidated === true &&
            (row.action === 'BUY' || row.action === 'SELL') &&
            Number(row.confidence) >= 60
        )
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const selectedPairs = new Set();
    for (const row of actionable) {
        if (selectedPairs.size >= 3) break;
        selectedPairs.add(row.pair);
    }

    console.log('⚡ 5M SCALP BUDGET:', [...selectedPairs]);

    for (const row of results) {
        if (row.freshThisCycle !== true) {
            row.scalpEntry = { status: 'NOT_CHECKED', reason: '15M_SNAPSHOT' };
            continue;
        }

        if (row.action !== 'BUY' && row.action !== 'SELL') {
            row.scalpEntry = { status: 'NOT_APPLICABLE', reason: row.aiValidated ? 'NO_ACTION' : 'AI_NOT_VALIDATED' };
            continue;
        }

        if (!selectedPairs.has(row.pair)) {
            row.scalpEntry = { status: 'NOT_CHECKED', reason: '5M_BUDGET' };
            row.score = Math.min(Number(row.score || 0), 64);
            console.log(`🟦 5M skipped ${row.pair}: budget optimization`);
            continue;
        }

        try {
            const scalpEntry = await withTimeout(
                evaluateScalpEntry(row.pair, row.action, row.indicators),
                PAIR_TIMEOUT_MS,
                `${row.pair}_5M`
            );
            row.scalpEntry = scalpEntry;
            row.score = Math.max(0, Math.min(100, Number(row.score || 0) + Number(scalpEntry.scoreAdjustment || 0)));

            if (scalpEntry.status === 'REJECT') {
                console.log(`❌ SCALP ENTRY REJECTED ${row.pair}: ${scalpEntry.reason}`);
                row.action = 'WAIT';
                row.score = Math.min(row.score, 35);
            } else if (scalpEntry.status === 'WAIT_PULLBACK') {
                console.log(`🟡 WAIT PULLBACK ${row.pair}: ${scalpEntry.reason}`);
                row.action = 'WAIT';
                row.score = Math.min(row.score, 45);
            } else if (scalpEntry.status === 'WAIT') {
                console.log(`🟡 SCALP WAIT ${row.pair}: ${scalpEntry.reason}`);
                row.action = 'WAIT';
                row.score = Math.min(row.score, 55);
            } else if (scalpEntry.status === 'ENTRY_READY') {
                console.log(`✅ SCALP ENTRY READY ${row.pair} | 5M=${scalpEntry.trigger5m}`);
            }
        } catch (error) {
            row.scalpEntry = { status: 'ERROR', reason: error.message };
            row.action = 'WAIT';
            row.score = Math.min(Number(row.score || 0), 35);
            console.log(`⚠️ 5M scalp check failed ${row.pair}: ${error.message}`);
        }
    }

    return results
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 5);
}

module.exports = {
    scanMarkets,
    calculateTechnicalScore,
    getTechnicalDirection
};
