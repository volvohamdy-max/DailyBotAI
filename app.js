// Termux-friendly root entry point.
// The application source lives in src/app.js; keep this file so `node app.js`
// works for users who start the bot from the project root manually.
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'src', 'app.js');
const requiredPackages = ['telegraf', 'sql.js', 'dotenv', 'axios', 'node-cron'];

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
  console.error('   pkg install nodejs python make clang');
  console.error('   npm install');
  console.error('   npm start');
  process.exit(1);
}

// Install provider routing BEFORE src/app.js loads scheduler/scanners/strategies.
// Yahoo is used for no-key forex candles; XAU calls are serialized to avoid
// burst-rate 429s. Massive and Dukascopy remain optional fallbacks.
require('./src/services/installYahooForexFallback');
require('./src/services/installGoldRequestQueue');
require('./src/services/installMassiveMarketFallback');
require('./src/services/installDukascopyFallback');

console.log('Loading Telegram Forex AI bot source...');
require(appPath);
