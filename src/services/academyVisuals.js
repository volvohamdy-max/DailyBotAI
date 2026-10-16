const visuals = {
  structure: {
    title: '🧠 BOS / CHoCH — هيكل السوق',
    art: `📈 السيناريو:\nالسعر يصنع HH ثم HL ثم HH جديد.\n\n1️⃣ HH = قمة أعلى\n2️⃣ HL = قاع أعلى\n3️⃣ كسر HH السابق بإغلاق قوي = BOS صاعد\n4️⃣ بعد ذلك لو السعر كسر آخر HL لأسفل = CHoCH محتمل\n\n🔎 تخيل الشارت:\nLow ↗ HL ↗ HH ↘ HL ↗ [BOS فوق HH]\n                         ↓\n                  كسر HL = CHoCH`,
    note: 'BOS يؤكد استمرار الهيكل غالبًا، وCHoCH إنذار مبكر بتغيره. لا تعتمد على مجرد لمس المستوى.',
    how: 'حدد آخر Swing High وSwing Low واضحين، ثم راقب الإغلاق والاندفاع بعد الكسر.',
    avoid: '❌ كسر بذيـل فقط أو داخل حركة جانبية ضيقة.'
  },
  liquidity: {
    title: '💧 Liquidity Sweep — سحب السيولة',
    art: `📉 مثال SELL:\n\n1️⃣ السعر يصنع قمتين واضحتين قريبين من بعض = Equal Highs\n2️⃣ فوق القمم توجد أوامر وقف مشترين وسيولة شراء\n3️⃣ السعر يطلع فوق القمم للحظات ← SWEEP\n4️⃣ يرجع ويغلق تحت المنطقة\n5️⃣ ننتظر كسر قاع/CHoCH لأسفل للتأكيد\n\nEqual Highs ───────── 💧 Liquidity\n                    ↑ Sweep\n                    ↘ رجوع تحت المستوى\n                      ↓ CHoCH\n                      🔴 SELL confirmation`,
    note: 'الـSweep نفسه ليس أمر بيع. التأكيد يأتي من رفض واضح وتغير هيكل بعد أخذ السيولة.',
    how: 'ابحث عن قمم/قيعان واضحة يراها أغلب المتداولين، ثم راقب ماذا يفعل السعر بعد اختراقها.',
    avoid: '❌ الدخول فور لمس السيولة قبل رجوع السعر وتأكيد الاتجاه.'
  },
  fvg: {
    title: '⚡ FVG — Fair Value Gap',
    art: `📈 مثال Bullish FVG:\n\nشمعة 1        شمعة 2 قوية جدًا        شمعة 3\n   🟩              🟩🟩🟩               🟩\n                    ↑ اندفاع\n\nبين High الشمعة 1 وLow الشمعة 3 توجد منطقة لم يحصل فيها تداول متوازن:\n\n        ┌──────────────┐\n        │   ⚡ FVG      │ ← منطقة انتظار Retest\n        └──────────────┘\n               ↘ السعر يرجع لها\n                 🟢 نبحث عن تأكيد شراء`,
    note: 'FVG نتيجة اندفاع سريع وعدم توازن. ليست كل فجوة فرصة دخول.',
    how: 'حدد 3 شموع: لو Low الثالثة أعلى من High الأولى بعد اندفاع صاعد، المنطقة بينهما Bullish FVG.',
    avoid: '❌ شراء أي FVG ضد اتجاه قوي أو بدون منطقة/سيولة داعمة.'
  },
  orderblock: {
    title: '🏦 Order Block — منطقة اهتمام',
    art: `📈 مثال Bullish Order Block:\n\nهبوط صغير → 🟥 آخر شمعة/منطقة هابطة\n              ┌────────────┐\n              │ ORDER BLOCK│\n              └────────────┘\n                    │\n                    └──→ 🟩🟩🟩 اندفاع قوي صاعد\n                              ↑ يكسر Structure\n\nبعد الاندفاع:\nالسعر ↘ يرجع للـOB → يظهر رفض/تأكيد → 🟢 فرصة محتملة`,
    note: 'الـOrder Block القوي مرتبط باندفاع واضح وكسر هيكل، وليس مجرد آخر شمعة عكسية.',
    how: 'ابحث أولًا عن Displacement وكسر Structure، وبعدها ارجع للمنطقة التي بدأ منها الاندفاع.',
    avoid: '❌ تعليم كل شمعة حمراء قبل صعود على أنها Order Block.'
  },
  support: {
    title: '🧱 Support & Resistance',
    art: `📊 الفكرة على الشارت:\n\n🔴 RESISTANCE ZONE\n════════════════════\n   السعر ↑ يصل للمنطقة\n          ↘ رفض وهبوط\n\n        حركة السعر\n      ↗      ↘      ↗\n\n════════════════════\n🟢 SUPPORT ZONE\n   السعر ↓ يصل للمنطقة\n          ↗ رفض وصعود\n\nلو المقاومة اتكسرت بإغلاق قوي ثم Retest من فوق، قد تتحول لدعم والعكس صحيح.`,
    note: 'الدعم والمقاومة مناطق وليست أرقامًا دقيقة. قوة المنطقة تزيد مع ردود الفعل والسياق.',
    how: 'ابدأ من H4/H1 وحدد المناطق التي خرج منها تحرك قوي أو تكرر منها الرفض.',
    avoid: '❌ رسم عشرات الخطوط حتى يصبح كل سعر دعمًا أو مقاومة.'
  },
  candles: {
    title: '🕯️ Rejection / Engulfing — شرح عملي',
    art: `🟢 أولًا: Bullish Rejection عند دعم\n\nالسعر يهبط ↓\n        │\n        │  ذيل سفلي طويل = محاولة هبوط مرفوضة\n        ▼\n🟢 SUPPORT ═════════════\n        ↑ إغلاق الشمعة فوق المنطقة\n        ↑ الشمعة التالية تؤكد الصعود\n\nالمعنى: البائعون دفعوا السعر لأسفل لكن المشترين رجعوه وأغلقوه أعلى.\n\n━━━━━━━━━━━━━━━━━━\n🟢 ثانيًا: Bullish Engulfing\n\nشمعة 1: 🟥 هابطة صغيرة\nشمعة 2: 🟩 صاعدة قوية جسمها يبتلع جسم الشمعة السابقة\n\n      🟥  →  🟩🟩\n              🟩🟩  ← سيطرة مشترين\n\nالأقوى عندما يحدث بعد هبوط + عند Support/OB/FVG + بعد Sweep للسيولة.`,
    note: 'الشمعة تخبرك برد فعل السعر، لكن مكان ظهورها هو الذي يعطيها القيمة.',
    how: 'مثال دخول تعليمي: Support → Sweep/رفض → Engulfing → كسر High شمعة التأكيد → Entry، والـSL أسفل منطقة الإبطال.',
    avoid: '❌ Bullish Engulfing في منتصف السوق بدون دعم أو سياق ليس سببًا كافيًا للشراء.'
  },
  fibonacci: {
    title: '📏 Fibonacci Retracement',
    art: `📈 في اتجاه صاعد:\n\nSwing Low ●\n          ╲\n           ╲ حركة صاعدة قوية\n            ╲____________ ● Swing High\n                           ↘ تصحيح\n\nراقب أثناء التصحيح:\n38.2% ───────── تصحيح خفيف\n50.0% ───────── منتصف الحركة\n61.8% ───────── منطقة مراقبة مهمة\n\nلو 61.8% متوافقة مع Support/OB ثم ظهر تأكيد صاعد → السيناريو أقوى.`,
    note: 'الفيبوناتشي أداة توافق Confluence، وليس زر شراء أو بيع.',
    how: 'في الصعود اسحب من Swing Low إلى Swing High، وفي الهبوط من High إلى Low.',
    avoid: '❌ استخدام 61.8% وحده بدون اتجاه أو مستوى أو تأكيد.'
  },
  goldflow: {
    title: '🥇 Workflow تحليل الذهب',
    art: `1️⃣ D1 / H4\nحدد: BUY bias / SELL bias / Range\n        ↓\n2️⃣ H1\nحدد: Support + Resistance + OB/FVG المهمة\n        ↓\n3️⃣ M15\nراقب: Structure + Liquidity + BOS/CHoCH\n        ↓\n4️⃣ M5\nانتظر: Rejection / Engulfing / Retest للتوقيت\n        ↓\n5️⃣ NEWS\nهل يوجد CPI / NFP / FOMC / خبر USD قوي قريب؟\n        ↓\n6️⃣ TRADE PLAN\nEntry + SL عند إبطال الفكرة + TP عند المستوى التالي + R:R مناسب`,
    note: 'كل فريم له وظيفة. لا تجعل M5 يقرر اتجاه اليوم بالكامل.',
    how: 'ابدأ من الكبير للصغير، ولا تنزل لفريم الدخول قبل تحديد اتجاهك ومناطقك.',
    avoid: '❌ فتح الصفقة لأن M5 أعطى شمعة جميلة بينما H1/H4 ضدها.'
  }
};

const schoolVisuals = {
  basics: ['support', 'goldflow'],
  price: ['candles', 'support'],
  smc: ['structure', 'liquidity', 'fvg', 'orderblock'],
  ict: ['liquidity', 'fvg', 'structure'],
  classic: ['support'],
  fib: ['fibonacci'],
  fundamental: ['goldflow'],
  gold: ['goldflow', 'support', 'liquidity', 'candles']
};

function getVisualKeys(schoolKey) { return schoolVisuals[schoolKey] || ['goldflow']; }
function getVisual(key) { return visuals[key] || null; }
function formatVisual(key) {
  const v = getVisual(key);
  if (!v) return null;
  return `${v.title}\n━━━━━━━━━━━━━━━━━━\n\n${v.art}\n\n💡 الفكرة الأساسية:\n${v.note}\n\n🔍 إزاي تكتشفها؟\n${v.how}\n\n${v.avoid}\n\n⚠️ مثال تعليمي لفهم قراءة الشارت، وليس توصية تداول.`;
}

module.exports = { getVisualKeys, getVisual, formatVisual };
