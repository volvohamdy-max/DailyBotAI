const { Telegraf } = require('telegraf');
const config = require('./src/config');

const bot = new Telegraf(config.botToken);

const message = `
🚨 إشارة تجريبية للذهب

🥇 الزوج: XAUUSD

📈 الاتجاه: BUY

🎯 الدخول: 3350

🛑 وقف الخسارة: 3335

🎯 الهدف الأول: 3370

🎯 الهدف الثاني: 3385

🔥 الثقة: 85%

🤖 Telegram Forex AI
`;

async function test() {

    // الجروب الرئيسي
    try {
        await bot.telegram.sendMessage(
            config.mainGroupId,
            message
        );
        console.log("✅ Group message sent");
    } catch(e) {
        console.log("❌ Group error:", e.message);
    }


    // الأدمن
    for (const adminId of config.adminIds) {
        try {
            await bot.telegram.sendMessage(
                adminId,
                message
            );
            console.log("✅ Admin sent:", adminId);
        } catch(e) {
            console.log("❌ Admin error:", e.message);
        }
    }

}

test();
