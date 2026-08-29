const { Markup } = require('telegraf');

const adminKeyboard = () => Markup.inlineKeyboard([

    [
        Markup.button.callback('🎛️ مركز قيادة التداول', 'admin_command_center'),
    ],

    [
        Markup.button.callback('📊 الإحصائيات', 'admin_stats'),
    ],

    [
        Markup.button.callback('💎 إدارة VIP', 'admin_vip'),
        Markup.button.callback('🎁 النقاط', 'admin_points')
    ],

    [
        Markup.button.callback('📣 رسالة للجميع', 'admin_broadcast_help'),
    ],

    [
        Markup.button.callback('🚀 إرسال إشارة VIP', 'admin_signal_help'),
    ],

    [
        Markup.button.callback('🔄 تحديث اللوحة', 'admin_refresh')
    ]

]);

module.exports = adminKeyboard;
