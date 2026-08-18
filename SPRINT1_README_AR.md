# Sprint 1 — Arabic / English foundation

هذا الباكج معمول على نسخة GitHub الحالية من المشروع:
`volvohamdy-max/Telegram-bot`

## ماذا يضيف؟
- حفظ لغة كل مستخدم في جدول `users`.
- شاشة اختيار لغة عند أول `/start`.
- العربية والإنجليزية في القائمة الرئيسية.
- زر Settings / الإعدادات.
- تغيير اللغة في أي وقت.
- Migration آمن لقاعدة البيانات الحالية.
- إزالة تعريف جدول `signals` المكرر في `init.js`.
- Compatibility Router لكي تعمل أزرار القائمة الإنجليزية مع الـ handlers القديمة مؤقتًا.

## مهم
Sprint 1 يترجم البنية والقائمة والبداية والإعدادات.
بعض الرسائل القديمة داخل `src/commands/user.js` ما زالت عربية؛ سننقلها للـ locales في Sprint 2 بدل تعديل 1000+ سطر دفعة واحدة.

## طريقة التركيب
انسخ محتويات هذا المجلد فوق مشروعك مع الحفاظ على نفس المسارات.

ثم شغل:

```bash
npm run db:init
npm start
```

اختبر:
1. `/start`
2. اختر English.
3. تأكد أن القائمة الإنجليزية ظهرت.
4. اضغط Settings > Language.
5. ارجع للعربية.
6. جرب Trade Now / Market Analysis / Referral / Support.

## قبل الـ push
```bash
git status
git add src SPRINT1_README_AR.md
git commit -m "Add Arabic English language system"
git push origin main
```

## رجوع سريع لو حصلت مشكلة
```bash
git log --oneline -5
git revert HEAD
git push origin main
```
