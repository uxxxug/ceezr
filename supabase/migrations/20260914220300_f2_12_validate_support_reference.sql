-- migration-phase: validate
-- `F2-12` · `ADR 0114` — تصديقُ قيدِ حضورِ المرجعِ بعدَ ملئِه.
--
-- القيدُ أُضيفَ `not valid` في طورِ `expand` فلم يفحصْ صفّاً قائماً ولم يحجبْ
-- كتابةً؛ وطورُ `backfill` ملأَ القديمَ؛ فههنا يُصدَّقُ. **و`validate
-- constraint` يأخذُ قفلاً مُشارَكاً لا حاجزاً**: القراءةُ والكتابةُ تمضيانِ.
--
-- وبعدَ التصديقِ يصيرُ «كلُّ تذكرةٍ لها مرجعٌ» **حكماً مُنفَذاً في القاعدةِ**
-- لا وعداً في شِفرةٍ — وهذا موضعُ الإنفاذِ الأقوى (المعيارُ الثالثُ).
--
-- مسارُ العودةِ: `alter table support_tickets drop constraint support_tickets_reference_present;`

alter table support_tickets validate constraint support_tickets_reference_present;
