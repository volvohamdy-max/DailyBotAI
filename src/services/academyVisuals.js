const visuals = {
  structure: {
    title: '🧠 BOS / CHoCH — هيكل السوق',
    art: `اتجاه صاعد:\n\n        HH ●──────● HH\n          ╱      ╱\n     HL ●      ● HL\n       ╱\n  ● Low\n\nBOS ↑ = كسر القمة السابقة مع استمرار الهيكل\nCHoCH ↓ = كسر آخر HL مهم بعد الصعود`,
    note: 'لا تعتبر كل كسر BOS أو CHoCH. لازم تحدد Swing واضح وإغلاق/اندفاع له معنى.'
  },
  liquidity: {
    title: '💧 Liquidity Sweep — سحب السيولة',
    art: `      Stops / Buy Liquidity\n  ───────────────  قمة واضحة\n          ▲\n          │ Sweep\n          ●\n         ╱ ╲\n────────●───●──────── مستوى القمة\n             ╲\n              ▼ رجوع تحت المستوى`,
    note: 'اختراق القمة ثم الرجوع لا يعني SELL تلقائيًا. انتظر رفضًا وتغير هيكل/تأكيد.'
  },
  fvg: {
    title: '⚡ FVG — عدم التوازن',
    art: `شمعة 1        شمعة 2 قوية        شمعة 3\n  ││              │████│              ││\n  ││              │████│              ││\n  └┘              │████│              ┌┐\n        ← منطقة لم يحدث فيها تداول متوازن →\n                [   FVG   ]`,
    note: 'FVG منطقة اهتمام وليست مغناطيسًا مضمونًا. قوتها تزيد مع الاتجاه والسيولة والهيكل.'
  },
  orderblock: {
    title: '🏦 Order Block — منطقة اهتمام',
    art: `              اندفاع قوي ↑\n                    │\n                  ████\n                ████\n       ┌──────────────┐\n       │ ORDER BLOCK  │ ← آخر منطقة قبل الاندفاع\n───────┴──────────────┴──────\n             ↘ Retest`,
    note: 'مش كل آخر شمعة عكسية Order Block صالح. نحتاج displacement وهيكل وسيولة وسياق.'
  },
  support: {
    title: '🧱 Support & Resistance',
    art: `مقاومة  ═════════════════\n          ╱╲      ╱╲\n         ╱  ╲    ╱  ╲\n        ╱    ╲──╱    ╲\n       ╱              ╲\nدعم     ═════════════════\n          ↑ رد فعل سعري ↑`,
    note: 'تعامل مع الدعم والمقاومة كمنطقة سعرية، وليس خطًا دقيقًا بنقطة واحدة.'
  },
  candles: {
    title: '🕯️ Rejection / Engulfing',
    art: `شمعة رفض صاعدة       Bullish Engulfing\n      │                    ┌────┐\n      │ ذيل طويل           │████│\n    ┌─┴─┐                  │████│\n    │███│              ┌─┐ │████│\n    └───┘              └─┘ └────┘\n رفض أسعار أقل       شمعة قوية تبتلع السابقة`,
    note: 'شكل الشمعة وحده مش دخول. المكان والسياق والسيولة أهم.'
  },
  fibonacci: {
    title: '📏 Fibonacci Retracement',
    art: `High ●──────────────── 0%\n      ╲\n       ╲─────────────── 38.2%\n        ╲────────────── 50%\n         ●───────────── 61.8%\n          ╲\n           ╲\nLow  ●──────────────── 100%`,
    note: '50% و61.8% مناطق مراقبة؛ ابحث عن توافقها مع مستوى أو هيكل أو Price Action.'
  },
  goldflow: {
    title: '🥇 Workflow تحليل الذهب',
    art: `D1 / H4  →  الاتجاه العام\n    ↓\nH1       →  المناطق المهمة\n    ↓\nM15      →  الهيكل والسيولة\n    ↓\nM5       →  تأكيد الدخول\n    ↓\nNEWS     →  هل يوجد خبر خطر؟\n    ↓\nRISK     →  SL + TP + حجم مخاطرة`,
    note: 'الفكرة إن القرار يبقى نتيجة سلسلة تأكيدات، مش إشارة منفردة من فريم صغير.'
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
  return `${v.title}\n━━━━━━━━━━━━━━━━━━\n\n${v.art}\n\n💡 ${v.note}\n\n⚠️ الرسم مبسط للتعليم وفهم الفكرة.`;
}

module.exports = { getVisualKeys, getVisual, formatVisual };
