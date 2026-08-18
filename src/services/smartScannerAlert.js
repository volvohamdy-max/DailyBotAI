const { scanMarkets } = require('./smartScanner');
const { allUsers } = require('../database/users');

const lastAlerts = new Map();

const MIN_ALERT_SCORE = 85;
const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 دقيقة

async function runSmartScannerAlert(bot) {
    try {
        console.log('🚨 SMART SCANNER AUTO ALERT STARTED');

        const results = await scanMarkets();

        if (!results || results.length === 0) {
            console.log('⚠️ Smart Scanner returned no results');
            return;
        }

        // أفضل فرصة فقط
        const opportunity = results.find(
            item =>
                item.action === 'BUY' ||
                item.action === 'SELL'
        );

        if (!opportunity) {
            console.log('🟡 No valid opportunity');
            return;
        }

        if (Number(opportunity.score) < MIN_ALERT_SCORE) {
            console.log(
                `🟡 Best score ${opportunity.score} is below ${MIN_ALERT_SCORE}`
            );
            return;
        }

        const alertKey =
            `${opportunity.pair}_${opportunity.action}`;

        const lastTime = lastAlerts.get(alertKey) || 0;

        if (Date.now() - lastTime < ALERT_COOLDOWN) {
            console.log(
                `⏳ Alert cooldown active: ${alertKey}`
            );
            return;
        }

        lastAlerts.set(alertKey, Date.now());

        const directionEmoji =
            opportunity.action === 'BUY'
                ? '🟢'
                : '🔴';

        const message =
`🚨 SMART OPPORTUNITY
━━━━━━━━━━━━━━━━━━

🥇 ${opportunity.pair}

${directionEmoji} الاتجاه:
${opportunity.action}

⭐ قوة الفرصة:
${opportunity.score}/100

🔥 تم رصد فرصة قوية بواسطة
Smart Market Scanner

━━━━━━━━━━━━━━━━━━
⚠️ التحليل آلي ويعكس حالة السوق الحالية.
لا يمثل ضمانًا للربح.`;

        const users = allUsers({
            vipOnly: true
        });

        console.log(
            `📢 Sending Smart Alert to ${users.length} VIP users`
        );

        for (const user of users) {
            try {
                await bot.telegram.sendMessage(
                    user.telegram_id,
                    message
                );
            } catch (err) {
                console.log(
                    `❌ Smart alert failed ${user.telegram_id}:`,
                    err.message
                );
            }
        }

        console.log(
            `✅ SMART ALERT SENT: ${opportunity.pair} ${opportunity.action} ${opportunity.score}/100`
        );

    } catch (err) {
        console.log(
            '❌ Smart Scanner Alert error:',
            err.message
        );
    }
}

module.exports = {
    runSmartScannerAlert
};
