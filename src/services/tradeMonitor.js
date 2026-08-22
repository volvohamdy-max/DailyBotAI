
const { getPrice } = require('./marketService');
const { getOpenTrades, updateTradeStatus } = require('../database/trades');
const {
    ensureTradeTracked,
    recordTp1,
    recordTp2,
    recordSl,
  recordBreakeven,} = require('../database/performance');
const { allUsers } = require('../database/users');
const { getCachedPrice, setPrice } = require('./priceCache');
const config = require('../config');
const {
  handleHiddenResult
} = require('./hiddenSignalService');
const { isPairMarketOpen } = require('../utils/marketHours');
const { getGoldCandlesResilient } = require('./goldCandleRecovery');
const proStrategy = require('./scalpStrategies/proStrategy');

async function getProRsi5() {
    const raw = await getGoldCandlesResilient('5min');
    const closed = Array.isArray(raw) && raw.length > 1 ? raw.slice(0, -1) : [];
    const closes = closed
        .map(x => Number(x.close))
        .filter(Number.isFinite);

    if (closes.length < 16) return null;

    const series = proStrategy.rsiSeries(closes, 14);
    const value = Number(series.at(-1));
    return Number.isFinite(value) ? value : null;
}

function isFridayExitWindow(date = new Date()) {
    return date.getUTCDay() === 5 && (
        date.getUTCHours() > 21 ||
        (date.getUTCHours() === 21 && date.getUTCMinutes() >= 45)
    );
}

async function monitorTrades(bot) {
    const trades = getOpenTrades();

    console.log(
        "📋 OPEN TRADES:",
        JSON.stringify(trades, null, 2)
    );

    if (!trades || trades.length === 0) {
        console.log('🔎 No open trades.');
        return;
    }

    for (const trade of trades) {
        const marketPair =
            String(trade.pair || '').toUpperCase();

        if (!isPairMarketOpen(marketPair)) {
            console.log(
                `🌙 Market closed — trade monitor skipped ${marketPair}`
            );
            continue;
        }

        if (String(trade.pair).toUpperCase() !== 'XAUUSD') {
            continue;
        }

        try {
            ensureTradeTracked(trade);

            let price = getCachedPrice('XAUUSD');

            if (price === null || price === undefined) {
                price = await getPrice('XAUUSD');
                setPrice('XAUUSD', price);
            }

            price = Number(price);

            if (!Number.isFinite(price)) {
                throw new Error('Invalid XAUUSD price');
            }

            console.log(
                `💰 Monitoring XAUUSD | Trade ${trade.id} | Price: ${price}`
            );

            let message = null;
            let newStatus = null;
            let resultType = null;

            const tradeSource = String(trade.telegram_id || '').toUpperCase();
            const isProTrade = tradeSource === 'VIP_SCALP_PRO_STRATEGY';
            const isGrok92Trade = tradeSource === 'VIP_SCALP_GROK_GOLD_92';

            // ==================================================
            // PRO STRATEGY — dedicated exit management
            // Fixed $10 SL + RSI exit exactly as backtested.
            // Generic TP/BE logic below is intentionally bypassed.
            // ==================================================
            if (isProTrade) {
                const rsi5 = await getProRsi5();
                const entry = Number(trade.entry);
                const stop = Number(trade.stop_loss);

                if (trade.action === 'BUY' && Number.isFinite(stop) && price <= stop) {
                    message = `❌ تم ضرب وقف الخسارة\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n⭐ الاستراتيجية: Pro Strategy\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🛑 وقف الخسارة:\n${trade.stop_loss}\n\n❌ انتهت الصفقة عند وقف الخسارة.`;
                    newStatus = 'closed';
                    resultType = 'SL';
                } else if (trade.action === 'SELL' && Number.isFinite(stop) && price >= stop) {
                    message = `❌ تم ضرب وقف الخسارة\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n⭐ الاستراتيجية: Pro Strategy\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🛑 وقف الخسارة:\n${trade.stop_loss}\n\n❌ انتهت الصفقة عند وقف الخسارة.`;
                    newStatus = 'closed';
                    resultType = 'SL';
                } else if (trade.action === 'BUY' && Number.isFinite(rsi5) && rsi5 >= 63) {
                    const won = Number.isFinite(entry) && price >= entry;
                    message = `⭐ Pro Strategy — خروج RSI\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n💰 سعر الإغلاق:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n📊 RSI(14):\n${rsi5.toFixed(1)}\n\n✅ تحقق شرط الخروج RSI >= 63.\nتم إغلاق الصفقة بالكامل.`;
                    newStatus = 'closed';
                    resultType = won ? 'TP1' : 'SL';
                } else if (trade.action === 'SELL' && Number.isFinite(rsi5) && rsi5 <= 37) {
                    const won = Number.isFinite(entry) && price <= entry;
                    message = `⭐ Pro Strategy — خروج RSI\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n💰 سعر الإغلاق:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n📊 RSI(14):\n${rsi5.toFixed(1)}\n\n✅ تحقق شرط الخروج RSI <= 37.\nتم إغلاق الصفقة بالكامل.`;
                    newStatus = 'closed';
                    resultType = won ? 'TP1' : 'SL';
                } else if (isFridayExitWindow()) {
                    const won = trade.action === 'BUY' ? price >= entry : price <= entry;
                    message = `⭐ Pro Strategy — إغلاق نهاية الأسبوع\n\n🥇 الزوج: XAUUSD\n${trade.action === 'BUY' ? '📈' : '📉'} الاتجاه: ${trade.action}\n\n💰 سعر الإغلاق:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n✅ تم إغلاق الصفقة قبل نهاية تداول الجمعة.`;
                    newStatus = 'closed';
                    resultType = won ? 'TP1' : 'SL';
                }
            }

            // =========================
            // BUY
            // =========================

            if (!isProTrade && trade.action === 'BUY') {

                // TP2 (legacy safety: only reachable if price jumps directly beyond TP2 before TP1 is processed)
                if (
                    trade.target2 != null &&
                    price >= Number(trade.target2)
                ) {
                    message = `🏆 تم تحقيق الهدف الثاني\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🎯 TP1:\n${trade.target1}\n\n🏆 TP2:\n${trade.target2}\n\n✅ الصفقة حققت الهدف الثاني بنجاح 🎉`;

                    newStatus = 'closed';
                    resultType = 'TP2';
                }

                // TP1 = FULL WIN / FULL CLOSE
                else if (
                    (trade.status === 'open' || trade.status === 'secured') &&
                    trade.target1 != null &&
                    price >= Number(trade.target1)
                ) {
                    message = `🎯 تم تحقيق الهدف الأول\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🎯 TP1:\n${trade.target1}\n\n✅ تم إغلاق الصفقة بالكامل على الهدف الأول 🎉\n🏆 الصفقة محسوبة WIN كاملة.\n🛡️ لا يوجد وقف خسارة بعد تحقيق TP1.`;

                    newStatus = 'closed';
                    resultType = 'TP1';
                }

                // =========================
                // SECURE ENTRY - BUY
                // GROK_GOLD_92 is intentionally NO-BE to match validated backtest.
                // =========================
                else if (
                    !isGrok92Trade &&
                    trade.status === 'open' &&
                    trade.target1 != null &&
                    Number.isFinite(Number(trade.entry)) &&
                    Number.isFinite(Number(trade.target1)) &&
                    price > Number(trade.entry) &&
                    price < Number(trade.target1) &&
                    (
                        price >= Number(trade.target1) - 2 ||
                        (
                            (
                                price - Number(trade.entry)
                            ) /
                            (
                                Number(trade.target1) -
                                Number(trade.entry)
                            )
                        ) >= 0.80
                    )
                ) {
                    message = `🛡️ تم تأمين صفقة الذهب\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n🎯 الدخول:\n${trade.entry}\n\n💰 السعر الحالي:\n${price}\n\n🎯 TP1:\n${trade.target1}\n\n✅ تم تفعيل تأمين الدخول.\n\nإذا عاد السعر إلى سعر الدخول قبل TP1 سيتم إغلاق الصفقة على نقطة التعادل.`;

                    newStatus = 'secured';
                    resultType = 'SECURED';
                }

                // =========================
                // BREAKEVEN - BUY
                // =========================
                else if (
                    !isGrok92Trade &&
                    trade.status === 'secured' &&
                    Number.isFinite(Number(trade.entry)) &&
                    price <= Number(trade.entry)
                ) {
                    message = `🛡️ تم إغلاق صفقة الذهب على تأمين الدخول\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n🎯 الدخول:\n${trade.entry}\n\n💰 سعر الإغلاق:\n${price}\n\n✅ الصفقة عادت إلى نقطة الدخول بعد تفعيل الحماية.\nتم الإغلاق على نقطة التعادل.`;

                    newStatus = 'closed';
                    resultType = 'BREAKEVEN';
                }

                // SL
                else if (
                    trade.stop_loss != null &&
                    price <= Number(trade.stop_loss)
                ) {
                    message = `❌ تم ضرب وقف الخسارة\n\n🥇 الزوج: XAUUSD\n📈 الاتجاه: BUY\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🛑 وقف الخسارة:\n${trade.stop_loss}\n\n❌ انتهت الصفقة عند وقف الخسارة.`;

                    newStatus = 'closed';
                    resultType = 'SL';
                }
            }

            // =========================
            // SELL
            // =========================

            else if (!isProTrade && trade.action === 'SELL') {

                // TP2 (legacy safety: only reachable if price jumps directly beyond TP2 before TP1 is processed)
                if (
                    trade.target2 != null &&
                    price <= Number(trade.target2)
                ) {
                    message = `🏆 تم تحقيق الهدف الثاني\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🎯 TP1:\n${trade.target1}\n\n🏆 TP2:\n${trade.target2}\n\n✅ الصفقة حققت الهدف الثاني بنجاح 🎉`;

                    newStatus = 'closed';
                    resultType = 'TP2';
                }

                // TP1 = FULL WIN / FULL CLOSE
                else if (
                    (trade.status === 'open' || trade.status === 'secured') &&
                    trade.target1 != null &&
                    price <= Number(trade.target1)
                ) {
                    message = `🎯 تم تحقيق الهدف الأول\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🎯 TP1:\n${trade.target1}\n\n✅ تم إغلاق الصفقة بالكامل على الهدف الأول 🎉\n🏆 الصفقة محسوبة WIN كاملة.\n🛡️ لا يوجد وقف خسارة بعد تحقيق TP1.`;

                    newStatus = 'closed';
                    resultType = 'TP1';
                }

                // =========================
                // SECURE ENTRY - SELL
                // GROK_GOLD_92 is intentionally NO-BE to match validated backtest.
                // =========================
                else if (
                    !isGrok92Trade &&
                    trade.status === 'open' &&
                    trade.target1 != null &&
                    Number.isFinite(Number(trade.entry)) &&
                    Number.isFinite(Number(trade.target1)) &&
                    price < Number(trade.entry) &&
                    price > Number(trade.target1) &&
                    (
                        price <= Number(trade.target1) + 2 ||
                        (
                            (
                                Number(trade.entry) - price
                            ) /
                            (
                                Number(trade.entry) -
                                Number(trade.target1)
                            )
                        ) >= 0.80
                    )
                ) {
                    message = `🛡️ تم تأمين صفقة الذهب\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n🎯 الدخول:\n${trade.entry}\n\n💰 السعر الحالي:\n${price}\n\n🎯 TP1:\n${trade.target1}\n\n✅ تم تفعيل تأمين الدخول.\n\nإذا عاد السعر إلى سعر الدخول قبل TP1 سيتم إغلاق الصفقة على نقطة التعادل.`;

                    newStatus = 'secured';
                    resultType = 'SECURED';
                }

                // =========================
                // BREAKEVEN - SELL
                // =========================
                else if (
                    !isGrok92Trade &&
                    trade.status === 'secured' &&
                    Number.isFinite(Number(trade.entry)) &&
                    price >= Number(trade.entry)
                ) {
                    message = `🛡️ تم إغلاق صفقة الذهب على تأمين الدخول\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n🎯 الدخول:\n${trade.entry}\n\n💰 سعر الإغلاق:\n${price}\n\n✅ الصفقة عادت إلى نقطة الدخول بعد تفعيل الحماية.\nتم الإغلاق على نقطة التعادل.`;

                    newStatus = 'closed';
                    resultType = 'BREAKEVEN';
                }

                // SL
                else if (
                    trade.stop_loss != null &&
                    price >= Number(trade.stop_loss)
                ) {
                    message = `❌ تم ضرب وقف الخسارة\n\n🥇 الزوج: XAUUSD\n📉 الاتجاه: SELL\n\n💰 السعر الحالي:\n${price}\n\n🎯 الدخول:\n${trade.entry}\n\n🛑 وقف الخسارة:\n${trade.stop_loss}\n\n❌ انتهت الصفقة عند وقف الخسارة.`;

                    newStatus = 'closed';
                    resultType = 'SL';
                }
            }

            console.log("🎯 TRADE CHECK:", {
                tradeId: trade.id,
                status: trade.status,
                action: trade.action,
                currentPrice: price,
                newStatus,
                hasMessage: !!message
            });

            // =========================
            // إرسال النتيجة
            // =========================

            if (message && newStatus) {

                const strategyLabel = tradeSource === 'VIP_REGIME'
                    ? '🧭 GOLD REGIME'
                    : tradeSource === 'VIP_POWER'
                        ? '🏆 GOLD POWER'
                        : tradeSource === 'VIP_SCALP_GROK_GOLD_92'
                            ? '⚡ GROK GOLD 92'
                            : tradeSource === 'VIP_SCALP_NEW_YORK'
                                ? '🗽 NEW YORK SCALP'
                                : tradeSource === 'VIP_SCALP_PRO_STRATEGY'
                                    ? '⭐ PRO STRATEGY'
                                    : '⚡ GOLD SCALP';

                message = `${strategyLabel}\n━━━━━━━━━━━━━━━━━━\n\n${message}`;

                // Fallback detection protects older formatting branches.
                if (!resultType) {
                    if (message.includes('الهدف الثاني')) {
                        resultType = 'TP2';
                    } else if (message.includes('الهدف الأول')) {
                        resultType = 'TP1';
                    } else if (message.includes('وقف الخسارة')) {
                        resultType = 'SL';
                    }
                }

                if (resultType === 'TP1') {
                    recordTp1(trade, price);
                } else if (resultType === 'TP2') {
                    recordTp2(trade, price);
                } else if (
                    resultType === 'SL' ||
                    resultType === 'TP1_THEN_SL'
                ) {
                    recordSl(trade, price);
                } else if (resultType === 'BREAKEVEN') {
                    recordBreakeven(trade, price);
                }

                if (isProTrade && newStatus === 'closed') {
                    proStrategy.recordResult(resultType === 'TP1', Date.now());
                }

                // ==========================================
                // TRADE RESULT ROUTING
                // VIP GROUP ONLY
                // ==========================================

                updateTradeStatus(
                    trade.id,
                    newStatus
                );

                if (!config.vipChannelId) {
                    console.log(
                        `❌ VIP group ID missing — result not sent for trade ${trade.id}`
                    );
                } else {
                    try {
                        await bot.telegram.sendMessage(
                            config.vipChannelId,
                            message
                        );

                        console.log(
                            `💎 VIP RESULT SENT | Trade ${trade.id} | ${resultType || newStatus}`
                        );

                    } catch (e) {
                        console.log(
                            `❌ VIP group result send failed ${trade.id}:`,
                            e.message
                        );
                    }
                }

                console.log(
                    `✅ Result processed for trade ${trade.id}`
                );
            }

        } catch (err) {
            console.log(
                `❌ Trade monitor error: ${trade.pair}`,
                err.stack || err
            );
        }
    }
}

module.exports = {
    monitorTrades
};