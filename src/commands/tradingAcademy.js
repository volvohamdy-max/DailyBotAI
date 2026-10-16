const { Markup } = require('telegraf');

const schools = {
  basics: {
    title: '📘 أساسيات التحليل الفني',
    desc: 'ابدأ من الصفر: الاتجاه، الفريمات، الدعم والمقاومة وإدارة الصفقة.',
    lessons: [
      { title: '1️⃣ الاتجاه والفريمات', body: 'السوق يتحرك في اتجاه صاعد أو هابط أو عرضي.\n\n• صاعد: قمم وقيعان أعلى.\n• هابط: قمم وقيعان أقل.\n• عرضي: السعر محصور بين دعم ومقاومة.\n\nابدأ من الفريم الكبير لفهم الاتجاه ثم استخدم الفريم الأصغر لتحسين الدخول.', q: 'ما العلامة الأساسية للاتجاه الصاعد؟', a: ['قمم وقيعان أعلى', 'قمم وقيعان أقل', 'RSI أقل من 30'], correct: 0 },
      { title: '2️⃣ الدعم والمقاومة', body: 'الدعم منطقة ظهر منها طلب وارتد السعر لأعلى، والمقاومة منطقة ظهر منها عرض ودفع السعر لأسفل.\n\nتعامل معها كمناطق وليست رقمًا دقيقًا، وكلما توافقت مع فريم أكبر ورد فعل واضح زادت أهميتها.', q: 'الأفضل التعامل مع الدعم والمقاومة كـ؟', a: ['سعر ثابت لا يتغير', 'منطقة سعرية', 'مؤشر زخم'], correct: 1 },
      { title: '3️⃣ إدارة المخاطر', body: 'قبل الدخول حدد نقطة إبطال الفكرة ثم وقف الخسارة، وبعدها الهدف وحجم المخاطرة. لا تجعل حجم اللوت هو الذي يحدد مكان الوقف.\n\nR:R = العائد المتوقع ÷ المخاطرة.', q: 'ما الذي يجب تحديده أولًا؟', a: ['حجم اللوت عشوائيًا', 'مكان إبطال الفكرة ووقف الخسارة', 'الربح المطلوب فقط'], correct: 1 }
    ]
  },
  price: {
    title: '🕯️ Price Action',
    desc: 'اقرأ حركة السعر والشموع بدل الاعتماد على المؤشرات وحدها.',
    lessons: [
      { title: '1️⃣ شمعة الرفض', body: 'شمعة الرفض لها ذيل واضح يدل على محاولة السعر التحرك في اتجاه ثم رفضه. تصبح أقوى عندما تظهر عند دعم/مقاومة أو بعد سحب سيولة.', q: 'متى تكون شمعة الرفض أقوى؟', a: ['في أي مكان عشوائي', 'عند مستوى مهم', 'وقت إغلاق السوق فقط'], correct: 1 },
      { title: '2️⃣ Engulfing', body: 'الابتلاع يظهر عندما تسيطر شمعة قوية على حركة الشمعة السابقة. لا يكفي الشكل وحده؛ السياق والمكان والاتجاه أهم.', q: 'هل شكل Engulfing وحده كافٍ للدخول؟', a: ['نعم دائمًا', 'لا، يحتاج سياقًا ومكانًا مناسبًا', 'فقط على M1'], correct: 1 },
      { title: '3️⃣ Fake Breakout', body: 'الكسر الكاذب يحدث عندما يتجاوز السعر مستوى مهمًا ثم يعود ويغلق داخله. قد يكون علامة على اصطياد السيولة، ويحتاج تأكيدًا قبل الدخول.', q: 'العودة والإغلاق داخل المستوى بعد كسره قد تعني؟', a: ['كسرًا كاذبًا', 'ترندًا مؤكدًا دائمًا', 'لا شيء إطلاقًا'], correct: 0 }
    ]
  },
  smc: {
    title: '🧠 Smart Money - SMC',
    desc: 'هيكل السوق والسيولة وBOS وCHoCH وOrder Blocks وFVG.',
    lessons: [
      { title: '1️⃣ BOS و CHoCH', body: 'BOS هو كسر هيكلي في اتجاه الحركة الحالية ويدعم الاستمرار. CHoCH هو تغير مبكر في السلوك قد يشير لتحول الاتجاه، لكنه يحتاج سياقًا وتأكيدًا.', q: 'أي مفهوم قد يشير مبكرًا لتغير الاتجاه؟', a: ['CHoCH', 'Spread', 'Take Profit'], correct: 0 },
      { title: '2️⃣ Liquidity', body: 'تتجمع السيولة غالبًا فوق القمم وتحت القيعان الواضحة وحول المستويات التي يراها أغلب المتداولين. Sweep للسيولة لا يعني انعكاسًا تلقائيًا؛ انتظر تغيرًا في الهيكل أو تأكيدًا سعريًا.', q: 'أين تتجمع السيولة كثيرًا؟', a: ['فوق القمم وتحت القيعان', 'عند منتصف كل شمعة فقط', 'لا توجد سيولة حول القمم'], correct: 0 },
      { title: '3️⃣ FVG و Order Block', body: 'FVG منطقة عدم توازن نتجت عن اندفاع سعري سريع. والـOrder Block يُستخدم كمنطقة اهتمام مرتبطة بحركة هيكلية. قوتهما تزيد مع الاتجاه والسيولة والتأكيد، وليس بمجرد وجودهما.', q: 'أفضل استخدام FVG يكون؟', a: ['منفردًا بلا سياق', 'مع الهيكل والسيولة والتأكيد', 'كهدف ثابت دائمًا'], correct: 1 }
    ]
  },
  ict: {
    title: '💧 ICT Concepts',
    desc: 'Liquidity وFVG وPremium/Discount وKill Zones بمنهج مبسط.',
    lessons: [
      { title: '1️⃣ Premium & Discount', body: 'داخل نطاق واضح، النصف الأعلى Premium والنصف الأسفل Discount. الفكرة تساعد على تقييم مكان السعر داخل النطاق، وليست إشارة شراء أو بيع مستقلة.', q: 'Discount يكون عادة في؟', a: ['النصف السفلي من النطاق', 'فوق كل القمم', 'أي سعر مرتفع'], correct: 0 },
      { title: '2️⃣ Kill Zones', body: 'بعض فترات جلسات لندن ونيويورك تشهد سيولة وتقلبًا أعلى. لا يعني ذلك أن كل حركة خلالها فرصة؛ الخبر والهيكل والمستويات ما زالت مهمة.', q: 'Kill Zone تعني؟', a: ['دخول إجباري', 'فترة نشاط محتمل تحتاج شروطًا أخرى', 'وقف تداول دائم'], correct: 1 }
    ]
  },
  classic: {
    title: '📐 التحليل الكلاسيكي',
    desc: 'ترندات وقنوات ومثلثات ونماذج سعرية.',
    lessons: [
      { title: '1️⃣ خطوط الاتجاه والقنوات', body: 'خط الاتجاه يربط نقاطًا هيكلية متناسقة، والقناة تضيف حدًا موازيًا للحركة. كثرة لمس الخط لا تجعله ضمانًا؛ راقب جودة الارتداد والكسر.', q: 'خط الاتجاه يعتبر؟', a: ['ضمانًا للارتداد', 'أداة سياقية وليست ضمانًا', 'وقف خسارة ثابت'], correct: 1 },
      { title: '2️⃣ النماذج السعرية', body: 'المثلثات والأعلام والرأس والكتفين تصف سلوكًا سعريًا محتملًا. اكتمال النموذج والتأكيد والحجم/الزخم والسياق أهم من مجرد تشابه الرسم.', q: 'متى يصبح النموذج أكثر قيمة؟', a: ['قبل اكتماله', 'مع اكتمال وتأكيد وسياق', 'بمجرد رسمه'], correct: 1 }
    ]
  },
  fib: {
    title: '📏 Fibonacci',
    desc: 'Retracement وExtension وكيفية دمجها مع المناطق.',
    lessons: [
      { title: '1️⃣ Retracement', body: 'فيبوناتشي Retracement يقيس عمق التصحيح داخل حركة واضحة. مستويات مثل 50% و61.8% مناطق مراقبة وليست أوامر دخول تلقائية. الأفضل دمجها مع دعم/مقاومة وهيكل.', q: 'مستوى 61.8% يعني؟', a: ['شراء مضمون', 'منطقة مراقبة تحتاج توافقًا', 'إلغاء وقف الخسارة'], correct: 1 }
    ]
  },
  fundamental: {
    title: '📰 التحليل الأساسي والأخبار',
    desc: 'الفائدة وCPI وNFP وFOMC والدولار وتأثيرهم على الذهب.',
    lessons: [
      { title: '1️⃣ الأخبار عالية التأثير', body: 'CPI وNFP وقرارات الفائدة وFOMC قد ترفع التقلب والانزلاق على الذهب. وقت الخبر لا تعتمد على التحليل الفني وحده، وانتبه للسبريد والحركة السريعة.', q: 'قبل خبر أمريكي عالي التأثير الأفضل؟', a: ['تجاهله تمامًا', 'مراعاة زيادة التقلب والمخاطر', 'مضاعفة اللوت تلقائيًا'], correct: 1 },
      { title: '2️⃣ الذهب والدولار والعوائد', body: 'الذهب يتأثر بالدولار والعوائد الحقيقية وتوقعات الفائدة والمخاطر العالمية. العلاقات ليست ثابتة لحظة بلحظة، لذلك نستخدمها كسياق مع حركة السعر.', q: 'العلاقات الأساسية مع الذهب؟', a: ['ثابتة 100%', 'سياق مهم لكنها ليست قاعدة لحظية مطلقة', 'غير مفيدة إطلاقًا'], correct: 1 }
    ]
  },
  gold: {
    title: '🥇 تخصص تحليل الذهب',
    desc: 'منهج عملي لفهم XAUUSD والجلسات والمناطق والسيولة.',
    lessons: [
      { title: '1️⃣ خريطة الذهب اليومية', body: 'ابدأ بالاتجاه على D1/H4، ثم حدد مناطق H1، وبعدها استخدم M15/M5 للتأكيد. لا تجعل إشارة فريم صغير تعاكس سياقًا قويًا بلا سبب واضح.', q: 'الترتيب الأفضل للتحليل؟', a: ['M1 ثم نتجاهل الكبير', 'من الكبير للصغير', 'فريم واحد فقط'], correct: 1 },
      { title: '2️⃣ سيناريو الدخول', body: 'السيناريو الجيد يجمع: اتجاه + منطقة قوية + سيولة/هيكل + تأكيد دخول + وقف منطقي + عائد مناسب + عدم وجود خبر خطر قريب.', q: 'أي سيناريو أقوى؟', a: ['مؤشر واحد فقط', 'توافق عدة عوامل مستقلة', 'دخول بلا وقف'], correct: 1 }
    ]
  }
};

const progress = new Map();
function userProgress(id) { if (!progress.has(String(id))) progress.set(String(id), new Set()); return progress.get(String(id)); }
function academyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📘 الأساسيات', 'academy_school_basics'), Markup.button.callback('🕯️ Price Action', 'academy_school_price')],
    [Markup.button.callback('🧠 SMC', 'academy_school_smc'), Markup.button.callback('💧 ICT', 'academy_school_ict')],
    [Markup.button.callback('📐 كلاسيكي', 'academy_school_classic'), Markup.button.callback('📏 Fibonacci', 'academy_school_fib')],
    [Markup.button.callback('📰 أساسي وأخبار', 'academy_school_fundamental')],
    [Markup.button.callback('🥇 تخصص الذهب', 'academy_school_gold')],
    [Markup.button.callback('📊 تقدمي', 'academy_progress')]
  ]);
}
function homeText() { return '🎓 أكاديمية Forex AI\n━━━━━━━━━━━━━━━━━━\nاتعلم التحليل خطوة بخطوة من الأساسيات حتى تحليل الذهب.\n\n📚 اختر مدرسة من الأسفل، اقرأ الدرس ثم اختبر نفسك.\n🧪 النجاح في الاختبارات يُسجل تقدمك داخل الجلسة الحالية.\n\n⚠️ المحتوى تعليمي وليس توصية استثمارية.'; }
function schoolKeyboard(key) {
  const s = schools[key];
  const rows = s.lessons.map((l, i) => [Markup.button.callback(l.title, `academy_lesson_${key}_${i}`)]);
  rows.push([Markup.button.callback('🔙 كل المدارس', 'academy_home')]);
  return Markup.inlineKeyboard(rows);
}
function lessonKeyboard(key, i) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧪 اختبرني', `academy_quiz_${key}_${i}`)],
    [Markup.button.callback('📚 دروس المدرسة', `academy_school_${key}`), Markup.button.callback('🎓 الأكاديمية', 'academy_home')]
  ]);
}
async function edit(ctx, text, keyboard) {
  try { return await ctx.editMessageText(text, keyboard); } catch (_) { return ctx.reply(text, keyboard); }
}
function registerTradingAcademy(bot) {
  bot.hears(['🎓 أكاديمية التداول', '🎓 Trading Academy'], ctx => ctx.reply(homeText(), academyKeyboard()));
  bot.action('academy_home', ctx => { ctx.answerCbQuery().catch(() => null); return edit(ctx, homeText(), academyKeyboard()); });
  bot.action(/^academy_school_(.+)$/, ctx => {
    ctx.answerCbQuery().catch(() => null); const key = ctx.match[1]; const s = schools[key]; if (!s) return;
    return edit(ctx, `${s.title}\n━━━━━━━━━━━━━━━━━━\n${s.desc}\n\n📖 اختر الدرس:`, schoolKeyboard(key));
  });
  bot.action(/^academy_lesson_([^_]+)_(\d+)$/, ctx => {
    ctx.answerCbQuery().catch(() => null); const key = ctx.match[1]; const i = Number(ctx.match[2]); const l = schools[key]?.lessons[i]; if (!l) return;
    return edit(ctx, `${schools[key].title}\n\n${l.title}\n━━━━━━━━━━━━━━━━━━\n${l.body}\n\n💡 بعد ما تفهم الدرس اضغط «اختبرني».`, lessonKeyboard(key, i));
  });
  bot.action(/^academy_quiz_([^_]+)_(\d+)$/, ctx => {
    ctx.answerCbQuery().catch(() => null); const key = ctx.match[1]; const i = Number(ctx.match[2]); const l = schools[key]?.lessons[i]; if (!l) return;
    const rows = l.a.map((answer, ai) => [Markup.button.callback(answer, `academy_answer_${key}_${i}_${ai}`)]);
    rows.push([Markup.button.callback('🔙 الدرس', `academy_lesson_${key}_${i}`)]);
    return edit(ctx, `🧪 اختبار سريع\n━━━━━━━━━━━━━━━━━━\n${l.q}`, Markup.inlineKeyboard(rows));
  });
  bot.action(/^academy_answer_([^_]+)_(\d+)_(\d+)$/, ctx => {
    const key = ctx.match[1]; const i = Number(ctx.match[2]); const ai = Number(ctx.match[3]); const l = schools[key]?.lessons[i]; if (!l) return;
    if (ai === l.correct) {
      userProgress(ctx.from.id).add(`${key}:${i}`); ctx.answerCbQuery('✅ إجابة صحيحة!').catch(() => null);
      const next = i + 1 < schools[key].lessons.length ? Markup.inlineKeyboard([[Markup.button.callback('➡️ الدرس التالي', `academy_lesson_${key}_${i + 1}`)], [Markup.button.callback('📚 المدرسة', `academy_school_${key}`)]]) : schoolKeyboard(key);
      return edit(ctx, `✅ ممتاز! إجابة صحيحة.\n\n${l.a[l.correct]}\n\n🎯 تم تسجيل إكمال الدرس.`, next);
    }
    ctx.answerCbQuery('❌ حاول مرة أخرى').catch(() => null);
    return edit(ctx, `❌ مش دي الإجابة الصحيحة.\n\nراجع الفكرة الأساسية في الدرس وجرب تاني.`, lessonKeyboard(key, i));
  });
  bot.action('academy_progress', ctx => {
    ctx.answerCbQuery().catch(() => null); const done = userProgress(ctx.from.id); const total = Object.values(schools).reduce((n, s) => n + s.lessons.length, 0); const pct = Math.round((done.size / total) * 100);
    return edit(ctx, `📊 تقدمك في أكاديمية Forex AI\n━━━━━━━━━━━━━━━━━━\n✅ الدروس المكتملة: ${done.size}/${total}\n📈 نسبة التقدم: ${pct}%\n\n${pct === 100 ? '🏆 ممتاز! أكملت النسخة الأولى من الأكاديمية.' : '🎯 كمل الدروس والاختبارات لرفع مستواك.'}`, Markup.inlineKeyboard([[Markup.button.callback('🎓 رجوع للأكاديمية', 'academy_home')]]));
  });
}
module.exports = registerTradingAcademy;
