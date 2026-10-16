const visuals={
trend:{title:'📈 Trend & Multi-Timeframe',art:'D1/H4 Bias → H1 Structure → M15 Setup → M5 Trigger.',note:'الفريم الكبير يحدد السياق والصغير يحسن التوقيت.',how:'حدد HH/HL أو LH/LL من الكبير ثم انزل تدريجيًا.',avoid:'❌ لا تجعل إشارة M5 وحدها تعكس اتجاه H4 قوي.'},
support:{title:'🧱 Support & Resistance',art:'Resistance → rejection | Support → bounce | Break + Retest → role reversal.',note:'الدعم والمقاومة مناطق وليست أرقامًا دقيقة.',how:'حدد المناطق التي خرج منها تحرك واضح أو تكرر عندها الرفض.',avoid:'❌ لا تملأ الشارت بخطوط.'},
structure:{title:'🧠 BOS / CHoCH — Market Structure',art:'HH + HL → BOS | كسر Protected Low → CHoCH محتمل.',note:'الكسر الحقيقي يحتاج إغلاق واندفاع.',how:'حدد Swing High/Low واضحين وراقب الإغلاق.',avoid:'❌ لا تعتمد على Wick فقط.'},
liquidity:{title:'💧 Liquidity Sweep',art:'Equal Highs/Lows → Sweep → رجوع → Displacement/CHoCH.',note:'الـSweep ليس دخولًا وحده.',how:'راقب القمم والقيعان الواضحة ورد الفعل بعد اختراقها.',avoid:'❌ لا تدخل قبل التأكيد.'},
fvg:{title:'⚡ Fair Value Gap',art:'Candle 1 → Displacement → Candle 3 يترك Imbalance → Retest.',note:'FVG منطقة اهتمام وليست إشارة منفردة.',how:'حدد عدم التوازن الناتج عن اندفاع قوي.',avoid:'❌ لا تستخدم FVG ضد السياق.'},
orderblock:{title:'🏦 Order Block',art:'Base/last opposite candle → Displacement → BOS → Retest.',note:'القوة تأتي من الاندفاع وكسر الهيكل.',how:'ارجع لبداية الحركة التي سببت كسرًا واضحًا.',avoid:'❌ ليست كل شمعة عكسية Order Block.'},
candles:{title:'🕯️ Rejection / Engulfing',art:'Key Zone → Rejection → Engulfing → confirmation break.',note:'مكان الشمعة أهم من شكلها وحده.',how:'راقبها عند منطقة قوية وبعد سياق واضح.',avoid:'❌ لا تدخل من شمعة في منتصف السوق.'},
fakebreak:{title:'🎣 Fake Breakout',art:'Resistance → Break above → Close back below → rejection.',note:'الكسر الكاذب قد يكشف اصطياد سيولة لكنه يحتاج تأكيد.',how:'راقب العودة والإغلاق داخل النطاق بعد الاختراق.',avoid:'❌ لا تعتبر كل Wick خارج المستوى Fakeout.'},
trendline:{title:'📐 Trendline & Channel',art:'Higher Lows → Trendline | Parallel upper line → Channel.',note:'الترندلاين أداة سياقية وليس حاجزًا مضمونًا.',how:'اربط Swing points واضحة ومتناسقة.',avoid:'❌ لا تجبر الخط ليلمس السعر.'},
patterns:{title:'🔺 Classical Patterns',art:'Compression → Triangle/Flag → Break → Retest → continuation or failure.',note:'اكتمال النموذج والتأكيد أهم من مجرد الشكل.',how:'راقب انكماش الحركة ثم كسر الحد بوضوح.',avoid:'❌ لا تتوقع الهدف قبل تأكيد الكسر.'},
fibonacci:{title:'📏 Fibonacci Retracement',art:'Impulse → 38.2 → 50 → 61.8 → Confluence → confirmation.',note:'الفيبوناتشي أداة توافق وليست زر دخول.',how:'اسحب على موجة واضحة في اتجاه الحركة.',avoid:'❌ لا تعتمد على 61.8 وحده.'},
fibextension:{title:'🎯 Fibonacci Extension',art:'Impulse A→B + Retracement C → 127.2 / 161.8 potential targets.',note:'الامتدادات تساعد في تقدير أهداف محتملة لا مضمونة.',how:'استخدمها مع Structure وLiquidity ومناطق مقابلة.',avoid:'❌ لا تجعل الامتداد يلغي مقاومة قوية قبله.'},
premiumdiscount:{title:'⚖️ Premium / Discount',art:'Range High = Premium | EQ 50% | Range Low = Discount.',note:'المكان داخل النطاق فلتر وليس إشارة مستقلة.',how:'حدد Range واضح ثم نقطة المنتصف.',avoid:'❌ لا تشتري Discount بدون سياق وتأكيد.'},
killzones:{title:'⏰ Kill Zones & Sessions',art:'Asia Range → London activity → New York activity → liquidity events.',note:'الجلسات تحدد فترات نشاط محتمل وليس اتجاهًا مضمونًا.',how:'راقب سيولة آسيا وتفاعل لندن/نيويورك معها.',avoid:'❌ لا تدخل لمجرد بدء الجلسة.'},
supplydemand:{title:'🏦 Supply & Demand Zones',art:'Demand Base → strong rally | Supply Base → strong drop → Retest.',note:'المنطقة الأقوى خرج منها اختلال واندفاع واضح.',how:'حدد Base صغير قبل الحركة القوية.',avoid:'❌ لا تعتبر كل قاع Demand وكل قمة Supply.'},
freshzone:{title:'✨ Fresh Zone + Retest',art:'Zone → Departure → First Retest → Reaction; repeated tests consume orders.',note:'المنطقة غير المختبرة غالبًا تستحق اهتمامًا أكبر.',how:'عد مرات رجوع السعر للمنطقة.',avoid:'❌ كثرة اللمسات لا تعني قوة أكبر.'},
invalidation:{title:'🚫 Entry & Invalidation',art:'Zone → confirmation → Entry | SL beyond invalidation | TP at opposing structure.',note:'الوقف يجب أن يكون حيث تصبح الفكرة نفسها غير صحيحة.',how:'حدد الإبطال قبل الدخول ثم احسب المخاطرة.',avoid:'❌ لا تضع SL عشوائيًا لمجرد تصغيره.'},
risklot:{title:'🛡️ Risk & Position Size',art:'Account Risk → SL Distance → Position Size.',note:'اللوت نتيجة للمخاطرة وليس قرارًا منفصلًا.',how:'حدد نقطة الإبطال وقيمة المخاطرة ثم الحجم.',avoid:'❌ لا تكبر اللوت ثم تحرك الوقف.'},
rr:{title:'⚖️ Risk / Reward',art:'SL=-1R | Entry=0 | TP1=+1R | TP2=+2R.',note:'R:R جزء من الخطة ولا يصلح Setup ضعيفًا.',how:'قارن الهدف الواقعي بمسافة الوقف.',avoid:'❌ لا تختر هدفًا غير منطقي لرفع R:R.'},
dailylimit:{title:'🛑 Daily Loss Limit',art:'Start → -1R → -2R → STOP.',note:'حد الخسارة يمنع Revenge Trading.',how:'حدد الحد قبل الجلسة والتزم به.',avoid:'❌ لا تضاعف بعد الوصول للحد.'},
drawdown:{title:'📉 Drawdown & Martingale',art:'1x → 2x → 4x → 8x → 16x exposure.',note:'المضاعفات تضخم أثر سلسلة الخسائر بسرعة.',how:'راقب إجمالي التعرض والسحب لا الصفقة الحالية فقط.',avoid:'❌ الصفقة التالية ليست مضمونة بعد الخسائر.'},
news:{title:'📰 High Impact News',art:'Normal volatility → Event time → volatility spike → spread/slippage → stabilization.',note:'CPI/NFP/FOMC والفائدة قد تغير سرعة السوق ومخاطر التنفيذ.',how:'راجع توقيت الخبر ودرجة تأثيره قبل الصفقة.',avoid:'❌ لا تتعامل مع لحظة الخبر كظروف سوق عادية.'},
goldmacro:{title:'🥇 Gold vs USD / Yields',art:'USD/Yields expectations ↔ Gold pressure; Risk events → safe-haven flows.',note:'العلاقات الأساسية سياق وليست معادلة ثابتة كل دقيقة.',how:'ادمج الخبر والعوائد والدولار مع الهيكل الفني.',avoid:'❌ لا تستخدم علاقة واحدة كإشارة دخول مباشرة.'},
goldflow:{title:'🥇 Gold Top-Down Workflow',art:'D1/H4 Bias → H1 Zones → M15 Structure/Liquidity → M5 Trigger → News → Risk.',note:'كل فريم له وظيفة.',how:'ابدأ من الكبير للصغير.',avoid:'❌ لا تجعل M5 يحدد اتجاه اليوم كله.'},
goldsetup:{title:'🎯 Complete Gold Setup',art:'Bias + Zone + Liquidity + Structure + Trigger + News Check + SL/TP/R:R.',note:'قوة الصفقة تأتي من توافق عوامل مستقلة.',how:'لو عنصر أساسي ناقص، WAIT قد يكون أفضل قرار.',avoid:'❌ لا تجبر صفقة لمجرد وجود إشارة واحدة.'}
};
const schoolVisuals={
basics:['trend','support','risklot'],
price:['candles','fakebreak','support'],
supply:['supplydemand','freshzone','invalidation','orderblock','candles'],
smc:['structure','liquidity','fvg','orderblock','premiumdiscount'],
ict:['liquidity','fvg','premiumdiscount','killzones','structure'],
classic:['trendline','patterns','support'],
fib:['fibonacci','fibextension'],
risk:['risklot','rr','dailylimit','drawdown'],
fundamental:['news','goldmacro','goldflow'],
gold:['goldflow','goldsetup','support','liquidity','candles','news']};
function getVisualKeys(k){return schoolVisuals[k]||['goldflow'];}
function getVisual(k){return visuals[k]||null;}
function formatVisual(k){const v=getVisual(k);if(!v)return null;return `${v.title}\n━━━━━━━━━━━━━━━━━━\n\n${v.art}\n\n💡 الفكرة الأساسية:\n${v.note}\n\n🔍 إزاي تطبقها؟\n${v.how}\n\n${v.avoid}\n\n⚠️ مثال تعليمي وليس توصية تداول.`;}
module.exports={getVisualKeys,getVisual,formatVisual};