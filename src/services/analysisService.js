const marketService = require('./marketService');
const analyzeIndicators = require('../indicators/analyzer');
const { askOpenAI } = require('../ai/openaiService');

async function analyzePair(pair) {
    console.log('⏱️ START GET CANDLES:', new Date().toLocaleTimeString());
    const candles = await marketService.getCandles(pair);
    console.log('⏱️ END GET CANDLES:', new Date().toLocaleTimeString());

    if (!candles || !candles.length) {
        return { pair: pair.toUpperCase(), indicators: null, signal: null };
    }

    const indicators = analyzeIndicators(candles);
    if (!indicators) {
        return { pair: pair.toUpperCase(), indicators: null, signal: null };
    }

    // Display freshness only: keep all indicator/strategy calculations candle-based,
    // but replace the user-facing lastPrice with a fresh live quote.
    // This does NOT change EMA/RSI/MACD/ADX, score, direction, SL or TP logic.
    try {
        const livePrice = Number(await marketService.getPrice(pair));
        if (Number.isFinite(livePrice) && livePrice > 0) {
            indicators.lastPrice = livePrice;
            console.log(`⚡ ANALYSIS LIVE PRICE ${String(pair).toUpperCase()}=${livePrice}`);
        }
    } catch (error) {
        console.log(`⚠️ Analysis live-price refresh failed ${pair}: ${error.message}`);
    }

    const { ema20, ema50, rsi, macd, adx } = indicators;
    let buyScore = 0;
    let sellScore = 0;

    if (Number.isFinite(Number(ema20)) && Number.isFinite(Number(ema50))) {
        if (Number(ema20) > Number(ema50)) buyScore++;
        if (Number(ema20) < Number(ema50)) sellScore++;
    }
    if (Number.isFinite(Number(rsi))) {
        if (Number(rsi) > 50) buyScore++;
        if (Number(rsi) < 50) sellScore++;
    }
    if (macd && Number.isFinite(Number(macd.macd)) && Number.isFinite(Number(macd.signal))) {
        if (Number(macd.macd) > Number(macd.signal)) buyScore++;
        if (Number(macd.macd) < Number(macd.signal)) sellScore++;
    }
    if (Number.isFinite(Number(adx)) && Number(adx) >= 20) {
        if (buyScore > sellScore) buyScore++;
        else if (sellScore > buyScore) sellScore++;
    }

    console.log(`📊 ${pair} | BUY: ${buyScore}/4 | SELL: ${sellScore}/4`);
    let direction = null;
    if (buyScore >= 3 && buyScore > sellScore) direction = 'BUY';
    else if (sellScore >= 3 && sellScore > buyScore) direction = 'SELL';

    if (!direction) {
        return { pair: pair.toUpperCase(), indicators, signal: null, technicalDirection: null, buyScore, sellScore };
    }

    console.log(`🤖 AI FILTER STARTED: ${pair} ${direction}`);
    console.log('⏱️ START AI:', new Date().toLocaleTimeString());
    let signal = null;
    try {
        signal = await askOpenAI(pair, { ...indicators, direction, buyScore, sellScore });
    } catch (error) {
        console.log(`❌ AI ERROR ${pair}:`, error.message);
        return { pair: pair.toUpperCase(), indicators, signal: null, technicalDirection: direction, buyScore, sellScore };
    }
    console.log('⏱️ END AI:', new Date().toLocaleTimeString());

    if (!signal) return { pair: pair.toUpperCase(), indicators, signal: null, technicalDirection: direction, buyScore, sellScore };
    const aiAction = String(signal.action || '').toUpperCase();
    const aiConfidence = Number(signal.confidence);
    signal = {
        ...signal,
        action: aiAction === 'BUY' || aiAction === 'SELL' ? aiAction : null,
        confidence: Number.isFinite(aiConfidence) ? Math.max(0, Math.min(100, Math.round(aiConfidence))) : 0
    };

    if (signal.action !== 'BUY' && signal.action !== 'SELL') {
        console.log(`⚠️ AI returned invalid action for ${pair}:`, signal.action);
        return { pair: pair.toUpperCase(), indicators, signal: null, technicalDirection: direction, buyScore, sellScore };
    }
    if (signal.action !== direction) {
        console.log(`⚠️ AI direction mismatch: ${signal.action} vs ${direction}`);
        return { pair: pair.toUpperCase(), indicators, signal, technicalDirection: direction, aiDirectionMismatch: true, buyScore, sellScore };
    }
    if (signal.confidence < 60) {
        console.log(`⚠️ Low AI confidence: ${signal.confidence}`);
        return { pair: pair.toUpperCase(), indicators, signal, technicalDirection: direction, lowAIConfidence: true, buyScore, sellScore };
    }

    console.log(`✅ Valid signal: ${pair} ${signal.action} ${signal.confidence}%`);
    return { pair: pair.toUpperCase(), indicators, signal, technicalDirection: direction, lowAIConfidence: false, aiDirectionMismatch: false, buyScore, sellScore };
}

module.exports = { analyzePair };
