
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

            // =========================
            // BUY
            // =========================

            if (trade.action === 'BUY') {

                // TP2
                if (
                    trade.target2 != null &&
                    price >= Number(trade.target2)
                ) {
                    message = `🏆 تم تحقيق الهدف الثاني

🥇 الزوج: XAUUSD
📈 الاتجاه: BUY

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🎯 TP1:
${trade.target1}

🏆 TP2:
${trade.target2}

✅ الصفقة حققت الهدف الثاني بنجاح 🎉`;

                    newStatus = 'closed';
                    resultType = 'TP2';
                }

                // TP1
                else if (
                    (trade.status === 'open' || trade.status === 'secured') &&
                    trade.target1 != null &&
                    price >= Number(trade.target1)
                ) {
                    message = `🎯 تم تحقيق الهدف الأول

🥇 الزوج: XAUUSD
📈 الاتجاه: BUY

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🎯 TP1:
${trade.target1}

⏳ في انتظار الهدف الثاني:
${trade.target2 || '-'}

✅ الصفقة في ربح 🎉`;

                    newStatus = 'target1';
                    resultType = 'TP1';
                }

                // =========================
                // SECURE ENTRY - BUY
                // =========================
                else if (
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
                    message = `🛡️ تم تأمين صفقة الذهب

🥇 الزوج: XAUUSD
📈 الاتجاه: BUY

🎯 الدخول:
${trade.entry}

💰 السعر الحالي:
${price}

🎯 TP1:
${trade.target1}

✅ تم تفعيل تأمين الدخول.

إذا عاد السعر إلى سعر الدخول قبل TP1 سيتم إغلاق الصفقة على نقطة التعادل.`;

                    newStatus = 'secured';
                    resultType = 'SECURED';
                }

                // =========================
                // BREAKEVEN - BUY
                // =========================
                else if (
                    trade.status === 'secured' &&
                    Number.isFinite(Number(trade.entry)) &&
                    price <= Number(trade.entry)
                ) {
                    message = `🛡️ تم إغلاق صفقة الذهب على تأمين الدخول

🥇 الزوج: XAUUSD
📈 الاتجاه: BUY

🎯 الدخول:
${trade.entry}

💰 سعر الإغلاق:
${price}

✅ الصفقة عادت إلى نقطة الدخول بعد تفعيل الحماية.
تم الإغلاق على نقطة التعادل.`;

                    newStatus = 'closed';
                    resultType = 'BREAKEVEN';
                }

                // SL
                else if (
                    trade.stop_loss != null &&
                    price <= Number(trade.stop_loss)
                ) {
                    message = `❌ تم ضرب وقف الخسارة

🥇 الزوج: XAUUSD
📈 الاتجاه: BUY

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🛑 وقف الخسارة:
${trade.stop_loss}

❌ انتهت الصفقة عند وقف الخسارة.`;

                    newStatus = 'closed';
                    resultType = 'SL';
                }
            }

            // =========================
            // SELL
            // =========================

            else if (trade.action === 'SELL') {

                // TP2
                if (
                    trade.target2 != null &&
                    price <= Number(trade.target2)
                ) {
                    message = `🏆 تم تحقيق الهدف الثاني

🥇 الزوج: XAUUSD
📉 الاتجاه: SELL

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🎯 TP1:
${trade.target1}

🏆 TP2:
${trade.target2}

✅ الصفقة حققت الهدف الثاني بنجاح 🎉`;

                    newStatus = 'closed';
                    resultType = 'TP2';
                }

                // TP1
                else if (
                    (trade.status === 'open' || trade.status === 'secured') &&
                    trade.target1 != null &&
                    price <= Number(trade.target1)
                ) {
                    message = `🎯 تم تحقيق الهدف الأول

🥇 الزوج: XAUUSD
📉 الاتجاه: SELL

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🎯 TP1:
${trade.target1}

⏳ في انتظار الهدف الثاني:
${trade.target2 || '-'}

✅ الصفقة في ربح 🎉`;

                    newStatus = 'target1';
                    resultType = 'TP1';
                }

                // =========================
                // SECURE ENTRY - SELL
                // =========================
                else if (
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
                    message = `🛡️ تم تأمين صفقة الذهب

🥇 الزوج: XAUUSD
📉 الاتجاه: SELL

🎯 الدخول:
${trade.entry}

💰 السعر الحالي:
${price}

🎯 TP1:
${trade.target1}

✅ تم تفعيل تأمين الدخول.

إذا عاد السعر إلى سعر الدخول قبل TP1 سيتم إغلاق الصفقة على نقطة التعادل.`;

                    newStatus = 'secured';
                    resultType = 'SECURED';
                }

                // =========================
                // BREAKEVEN - SELL
                // =========================
                else if (
                    trade.status === 'secured' &&
                    Number.isFinite(Number(trade.entry)) &&
                    price >= Number(trade.entry)
                ) {
                    message = `🛡️ تم إغلاق صفقة الذهب على تأمين الدخول

🥇 الزوج: XAUUSD
📉 الاتجاه: SELL

🎯 الدخول:
${trade.entry}

💰 سعر الإغلاق:
${price}

✅ الصفقة عادت إلى نقطة الدخول بعد تفعيل الحماية.
تم الإغلاق على نقطة التعادل.`;

                    newStatus = 'closed';
                    resultType = 'BREAKEVEN';
                }

                // SL
                else if (
                    trade.stop_loss != null &&
                    price >= Number(trade.stop_loss)
                ) {
                    message = `❌ تم ضرب وقف الخسارة

🥇 الزوج: XAUUSD
📉 الاتجاه: SELL

💰 السعر الحالي:
${price}

🎯 الدخول:
${trade.entry}

🛑 وقف الخسارة:
${trade.stop_loss}

❌ انتهت الصفقة عند وقف الخسارة.`;

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

                const tradeSource = String(trade.telegram_id || '').toUpperCase();
                const strategyLabel = tradeSource === 'VIP_REGIME'
                    ? '🧭 GOLD REGIME'
                    : tradeSource === 'VIP_POWER'
                        ? '🏆 GOLD POWER'
                        : '⚡ GOLD SCALP V3';

                message = `${strategyLabel}
━━━━━━━━━━━━━━━━━━

${message}`;

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

