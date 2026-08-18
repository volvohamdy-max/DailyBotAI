const fs = require('fs');
const path = require('path');

const requiredPackages = ['telegraf', 'sql.js', 'dotenv', 'axios', 'node-cron'];

function hasPackage(packageName) {
  try {
    require.resolve(packageName, { paths: [process.cwd(), __dirname] });
    return true;
  } catch (error) {
    return false;
  }
}

function runPreflight() {
  const missingPackages = requiredPackages.filter((packageName) => !hasPackage(packageName));
  const envPath = path.join(process.cwd(), '.env');

  if (missingPackages.length > 0) {
    console.error('❌ مكتبات Node.js ناقصة:');
    console.error(`   ${missingPackages.join(', ')}`);
    console.error('');
    console.error('✅ الحل على Termux من داخل مجلد المشروع:');
    console.error('   pkg update && pkg upgrade');
    console.error('   pkg install nodejs python make clang');
    console.error('   npm install');
    console.error('   npm start');
    process.exit(1);
  }

  if (!fs.existsSync(envPath)) {
    console.warn('⚠️ ملف .env غير موجود. انسخ .env.example ثم املأ BOT_TOKEN و ADMIN_IDS:');
    console.warn('   cp .env.example .env');
    console.warn('   nano .env');
  }
}

module.exports = runPreflight;
