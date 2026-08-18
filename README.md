# Telegram Forex AI Bot

بوت Telegram Forex AI منظم وخفيف للعمل على Termux باستخدام Node.js وTelegraf وSQLite.

> تنبيه: هذا المشروع تعليمي ولا يقدم نصائح مالية. يجب اختبار أي استراتيجية على حساب تجريبي قبل استخدامها.

## المميزات

- تسجيل المستخدمين تلقائيا عند `/start`.
- نظام إحالات ونقاط ومكافآت.
- خطط VIP شهرية وثلاثية وسنوية مع طلب اشتراك وإرسال إثبات دفع للأدمن.
- لوحة أدمن: إحصائيات، إضافة/حذف VIP، رسالة جماعية، إرسال إشارة.
- تحليل فوركس عبر مؤشرات RSI وMACD وEMA وATR وADX والدعم/المقاومة.
- خدمة جاهزة للتكامل مع OpenAI API لإنتاج BUY / SELL / WAIT مع دخول ووقف وأهداف وثقة وسبب.
- مهام مجدولة عبر node-cron لإنهاء VIP تلقائيا.

## الفرق بين `app.js` و `src/app.js`

المشروع يحتوي على ملفين باسم `app.js`، ولازم تنقل الاثنين معًا لأن لكل واحد وظيفة مختلفة:

- `app.js` في جذر المشروع: ملف تشغيل صغير فقط. هذا هو الذي تشغله من Termux بأمر `node app.js` أو `npm start`.
- `src/app.js` داخل مجلد `src`: ملف البوت الحقيقي الذي يحتوي على Telegraf وتسجيل الأوامر وتشغيل قاعدة البيانات والجدولة.

لا تختار واحدًا منهم فقط. انسخ المشروع كاملًا بهذا الشكل:

```text
ForexAIBot/
├── app.js
├── package.json
├── .env
└── src/
    ├── app.js
    ├── config.js
    ├── database/
    ├── commands/
    ├── services/
    └── utils/
```

إذا ظهر لك `ملف src/app.js موجود لكنه ناقص أو فاضي` فهذا يعني أن `src/app.js` عندك ليس النسخة الصحيحة. استبدله من ملفات المشروع الأصلية أو أعد فك ضغط المشروع كاملًا بدل نقل ملفات منفردة.

## التشغيل على Termux

```bash
pkg update && pkg upgrade
pkg install nodejs git python make clang
npm install
cp .env.example .env
nano .env
npm run doctor
npm run db:init
npm start
```

لو شغلت البوت يدويًا، استخدم أحد الأمرين من داخل مجلد المشروع:

```bash
npm start
# أو
node app.js
```

لا تنسخ ملف `src/app.js` إلى جذر المشروع؛ ملف `app.js` الموجود في الجذر يقوم بتشغيل `src/app.js` تلقائيًا حتى لا تظهر مشكلة `Cannot find module './database/init'`.

## لو البوت مش راضي يشتغل

نفذ الأمر التالي من داخل مجلد المشروع لمعرفة النواقص بسرعة:

```bash
npm run doctor
```

لو ظهرت رسالة `مكتبات Node.js ناقصة` فهذا يعني أن `npm install` لم يكتمل أو أنك لست داخل مجلد المشروع الصحيح. نفذ:

```bash
pkg install nodejs python make clang
npm install
npm start
```

لو ظهرت رسالة `BOT_TOKEN is required` افتح ملف `.env` وضع توكن البوت من BotFather في `BOT_TOKEN`.

### حل خطأ `Cannot find module './database/init'`

هذا الخطأ يعني أن ملف `app.js` الذي يعمل عندك ليس نسخة الجذر الصحيحة، أو أنك نسخت محتوى `src/app.js` إلى ملف `app.js` في جذر المشروع. الحل الأسرع:

```bash
cat > app.js <<'EOF'
const fs = require('fs');
const path = require('path');

const preflightPath = path.join(__dirname, 'src', 'utils', 'preflight.js');
const appPath = path.join(__dirname, 'src', 'app.js');

if (!fs.existsSync(appPath)) {
  console.error('❌ مجلد src غير موجود أو ناقص.');
  console.error('✅ الحل: انقل المشروع كاملًا إلى Termux وليس ملف app.js فقط.');
  console.error('   تأكد أن هذا الملف موجود: src/app.js');
  process.exit(1);
}

const requiredPackages = ['telegraf', 'better-sqlite3', 'dotenv', 'axios', 'node-cron'];
const missingPackages = requiredPackages.filter((packageName) => {
  try {
    require.resolve(packageName, { paths: [__dirname] });
    return false;
  } catch (error) {
    return true;
  }
});

if (missingPackages.length > 0) {
  console.error('❌ مكتبات Node.js ناقصة:');
  console.error(`   ${missingPackages.join(', ')}`);
  console.error('✅ الحل: npm install');
  process.exit(1);
}

console.log('Loading Telegram Forex AI bot source...');
require(appPath);
EOF
node app.js
```

وأضفنا ملفات توافق في الجذر مثل `database/init.js` و`commands/start.js` حتى تعمل النسخ القديمة التي تستدعي المسارات بدون `src/`.

لو ظهر خطأ `Cannot find module './src/utils/preflight'` فهذا يعني أنك عدلت `app.js` فقط ولم تنقل مجلد `src` كاملًا. لازم يكون عندك هذه الملفات داخل المشروع:

```bash
ls src/app.js src/utils/preflight.js
```

إذا لم تظهر الملفات، انسخ مجلد `src` كاملًا من المشروع إلى Termux أو أعد فك ضغط المشروع كاملًا.


### لو `npm start` يرجع للسطر بدون أي رسالة

إذا ظهر عندك:

```bash
> node src/app.js
```

ثم رجع Termux للسطر مباشرة، فهذا غالبًا يعني أن `package.json` أو `src/app.js` عندك نسخة قديمة/ناقصة. تأكد أن أمر التشغيل في `package.json` هو:

```json
"start": "node app.js"
```

وتأكد أن `src/app.js` ليس فارغًا أو ناقصًا. النسخة الصحيحة تطبع رسائل مثل `Starting Telegram Forex AI bot...` و`Database is ready.` عند التشغيل.

### لو ظهر فقط تحذير `preflight.js غير موجود`

هذا التحذير كان من نسخة قديمة من `app.js`. النسخة الجديدة لا تعتمد على `src/utils/preflight.js` أثناء تشغيل `node app.js`، وتفحص المكتبات مباشرة من ملف الجذر. استبدل `app.js` بالنسخة الموجودة في هذا الملف أو أعد نقل المشروع كاملًا، ثم شغّل:

```bash
npm install
npm start
```

إذا لم تظهر بعدها رسالة `Starting Telegram Forex AI bot...` فهذا يعني أن `src/app.js` عندك قديم أو ناقص ويجب استبداله بالنسخة الجديدة.

## المتغيرات

راجع `.env.example` واضبط:

- `BOT_TOKEN`: توكن Telegram من BotFather.
- `ADMIN_IDS`: أرقام Telegram ID للأدمن مفصولة بفواصل.
- `BOT_USERNAME`: اسم البوت بدون @ لإنشاء روابط الإحالة.
- `OPENAI_API_KEY`: مفتاح OpenAI اختياري، وعند تركه فارغا يعمل تحليل محلي احتياطي.
- `DATABASE_PATH`: مسار قاعدة SQLite.
- `PAYMENT_INFO`: تعليمات الدفع التي تظهر للمستخدم.

## أوامر المستخدم

- `/start` بدء وتسجيل المستخدم.
- `/menu` القائمة الرئيسية.
- `/vip` عرض خطط VIP.
- `/ref` رابط الإحالة.
- `/analyze EURUSD` تحليل زوج عملات.

## أوامر الأدمن

- `/admin` لوحة الأدمن.
- `/addvip <telegram_id> <days>` تفعيل VIP.
- `/removevip <telegram_id>` حذف VIP.
- `/broadcast <message>` رسالة جماعية.
- `/signal <message>` إرسال إشارة لمستخدمي VIP.
