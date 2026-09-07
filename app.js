// Termux-friendly root entry point.
// The application source lives in src/app.js; keep this file so `node app.js`
// works for users who start the bot from the project root manually.
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'src', 'app.js');
const requiredPackages = ['telegraf', 'sql.js', 'dotenv', 'axios', 'node-cron', 'dukascopy-node'];

function packageExists(packageName) {
  try {
    require.resolve(packageName, { paths: [__dirname] });
    return true;
  } catch (error) {
    return false;
  }
}

if (!fs.existsSync(appPath)) {
  console.error('❌ مجلد src غير موجود أو ناقص.');
  console.error('✅ الحل: انقل المشروع كاملًا إلى Termux وليس ملف app.js فقط.');
  console.error('   تأكد أن هذا الملف موجود: src/app.js');
  process.exit(1);
}

const appSize = fs.statSync(appPath).size;
if (appSize < 200) {
  console.error('❌ ملف src/app.js موجود لكنه ناقص أو فاضي.');
  console.error('✅ الحل: أعد نقل المشروع كاملًا أو استبدل src/app.js بالنسخة الصحيحة.');
  process.exit(1);
}

const missingPackages = requiredPackages.filter((packageName) => !packageExists(packageName));
if (missingPackages.length > 0) {
  console.error('❌ مكتبات Node.js ناقصة:');
  console.error(`   ${missingPackages.join(', ')}`);
  console.error('');
  console.error('✅ الحل على Termux من داخل مجلد المشروع:');
  console.error('   npm install');
  console.error('   npm start');
  process.exit(1);
}

// Base market routing. Strategy logic is unchanged.
require('./src/services/installFinalMarketPriority');

// XAU execution/live display price comes directly from Binance-backed gold
// proxies (PAXGUSDT, then XAUTUSDT). This removes GoldAPI/Sifting from the
// live-price critical path while preserving the rest of the market routing.
require('./src/services/installBinanceGoldLivePrice');

// Operational provider-pressure guards only.
require('./src/services/installProviderPressureGuards');

console.log('Loading Telegram Forex AI bot source...');
require(appPath);
