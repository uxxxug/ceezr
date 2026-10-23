# سكربتات التحقق (المُصلِح الثاني — 2026-10-23)

كلها تعمل على مختبر PostgreSQL 18.4 محلي بكل الهجرات (بذر: مدينة JED).

- `product-path-verify.ts` — النص الحقيقي (المستخرج من ملف المحول نفسه عبر regex) عبر
  postgres.js unsafe: فحص pg_prepared_statements + خطة الفرعين. (اتصاله prepare:false.)
- `adapter-prepare-true-verify.ts` — **الحاسم**: المحول الفعلي (createDriverCandidateRepository)
  عبر اتصال prepare:true، 10 تنفيذات للفرعين، ثم صفرُ عباراتٍ مسماة تلمس driver_availability.
- `gen-explain-analyze.py` — توليد EXPLAIN (ANALYZE, BUFFERS) للفرعين بالاستبدال الحرفي
  للوسائط؛ خرجه الملفان explain-analyze-7200-unsafe-*.txt في الأرشيف الأب.
- `timing-real.ts` / `timing-old.ts` — قياس وسيط زمن المسار الجديد (unsafe) والقديم
  (prepare:true) عند المقاييس (بذر مصحح: 30 متاحًا ثابتًا).
- `stability-scenario.py` — حساب شرط الاستقرار §11: p95 لـ elapsedMs من أحداث scenario.end
  في miniapp-load-events.jsonl.gz لكل نافذة 10 دقائق (دلاء بحسب زمن الحدث t منذ أول حدث؛
  الدلاء الناقصة <500 حدث تُسقط؛ p95 بالترتيب والقرص round(0.95×(n−1))؛ النسبة = آخر دلو
  كامل/أول دلو كامل). **الطريقة مجمدة** — أعادت أرقام التوثيق حرفيًا على أثر التشغيل
  الأصلي (3.93/2.31) وإعادة الجلسة السابقة (1.32/1.66) قبل تطبيقها على أي تشغيل جديد.
  المدخل الخام (miniapp-load-events.jsonl.gz) يبقى في أثر GitHub Actions (30 يومًا) وبصمته
  في ARTIFACT-SHA256SUMS.txt.

## بذر المختبر (add_wave_drivers)

النسخة المصححة (نطاق start_tg+1..start_tg+n موحد، عدد متاحين صريح لكل دفعة — ثابت عبر
المقاييس، إدخالsubscriptions/capabilities): انظر تعريف الدالة في سجل المختبر؛ أساسها
`row_number() over (order by telegram_id) <= n_available` مع التحقق العددي بعد كل بذر
(مثال: 500/30 و7,200/30). النسخة القديمة المعيبة (فقدان سائق واحد لكل دفعة) موثقة في
التحقيق §3.
