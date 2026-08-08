# القسم 2 — استجابة الأمر التدقيقي الشامل (بعد إتمام 2.6)

> هذا التقرير يُكتب على دفعات: القسم صفر (الفحص الإلزامي) أُنجز وكُتب قبل أي تعديل سطرٍ
> واحد في المستودع، إثباتاً للقراءة لا للبدء. ثم تُضاف أقسام التنفيذ (ب ← ج ← د) تباعاً.

---

## 0. الفحص الإلزامي قبل أي تعديل — ما فهمته

قرأت `MASTER_DIRECTIVE.md` كاملاً، و`roadmap.md`، و`repo-manifest.md`، وكل تقارير
`docs/phase-2.*-step-*-report.md` (12 تقريراً) و`docs/section-1-report.md` زمنياً، وكل
ملفّات `docs/adr/` الثمانية، و`docs/runbook.md` و`docs/api.md`، ثم قرأت الطبقات الثلاث
قراءة مباشرة لا استنتاجاً.

**ما فهمته في أسطر:**

المشروع «وصلة/ceezr» بوتان على تيليجرام (سائق وعميل) فوق مونوليث معياري نظيف على Bun:
اتجاه الاعتماد `infrastructure → application → domain → shared` واتجاه واحد لا يُخرَق،
و`domain` لا يعرف شبكةً ولا قاعدة. كل حالة استعمال دالّة
`verbNoun(input, deps): Promise<Result<T, XError>>` بلا `throw` للأخطاء المتوقَّعة. كل
قيمة تجارية (250/400، المهل، الأوزان) تعيش في `platform_settings` لا في الكود، وبوّابة
`check-business-constants.ts` تحرس ذلك. كل جدول يحمل `city_id`، والعمليات الحرجة تمرّ
بدوالّ RPC ذرّية في القاعدة لا بتسلسل استعلامات في التطبيق. الهويّات إنجليزية وتعليقات
الملفّات عربية.

الحالة الفعلية اليوم: **262 ملفّاً من أصل 387** في `packages` و`apps` ما زالت تحمل
`الحالة: هيكل فقط` صراحةً في تعليق رأس الملفّ. المنفَّذ فعلياً هو المسار الحيّ وحده —
`identity` جزئياً، `dispatch` (10 من 14)، `reputation` (7/7)، `i18n-translation` (6/6)،
`dispute` (7/7)، `subscription` (7/8)، `delivery` (6/8)، `scheduling` (5/7). أمّا
`analytics`، `audit`، `capability`، `documents`، `enterprise-integration`،
`feature-flags`، `financial`، `geo`، `kyc`، `marketplace`، `messaging`، `notification`،
`policy`، `safety`، `tenancy`، `transport`، `workflow` فهياكل كاملة بلا منطق.
**فهمت الشرط: يُمنع منعاً باتاً إضافة أي منطق في أي وحدة هيكل-فقط، وهذا القسم صفر ليس
أمراً يفتح أياً منها.** لن يُلمس منها ملفّ واحد في هذه الدفعة.

**البوّابات على الحالة الأساسية (قبل أي تعديل مني):**

| البوّابة | النتيجة |
|---|---|
| `scripts/check-migrations.ts` | ✅ 16 جدولاً، كلها `city_id` + RLS مفعّلة بالاسم صراحةً (16 اسماً في قائمة التفعيل) |
| `scripts/check-i18n.ts` | ✅ 3 قواميس متطابقة، 163 مفتاحاً في كلٍّ منها |
| `scripts/check-business-constants.ts` | ✅ لا قيمة تجارية مرمَّزة |
| `bun run typecheck` | ✅ نظيف |
| `bun test` | ✅ 371 ناجحاً، 86 متخطّى (تكامل بلا قاعدة)، 0 فاشلاً، 457 اختباراً في 32 ملفّاً |

**الهجرات الثماني بالترتيب الزمني** (كلها مقروءة، لا معدودة):
`20260806120000_core_schema` (الجداول الستّة عشر + RLS) →
`20260806120100_atomic_rpcs` (الدوالّ الذرّية: `claim_offer`، `create_order`…) →
`20260806120200_seed_cities_and_settings` (المدينة وإعدادات المنصّة) →
`20260807100000_unsubscribed_negotiation` →
`20260807130000_support_tickets` →
`20260807170000_mutual_ratings` (`start_ride`، `complete_ride`، `submit_rating`) →
`20260807190000_language_selection` →
`20260808040000_scheduled_jobs`.

**ملاحظة تنفيذية خرجت من القراءة وتخصّ البند ب.2 مباشرة:** دالّة `complete_ride` تُعيد
كائنَي `driver` و`rider` كاملين (`telegram_id`، `language_code`، `full_name`)، ولذلك
استطاع `handleCompleteRide` أن يُشعِر الطرف المقابل. أمّا `start_ride` فتُعيد
`{ok, order_id, started_at}` فقط — لا طرف ولا لغة. فإكمال النمط في `handleStartRide`
يستلزم توسيع ما تُعيده `start_ride` بهجرة جديدة على نمط `complete_ride` نفسه، لا التفافاً
باستعلام إضافي في التطبيق. هذا توسيعُ نمطٍ قائم في وحدة `reputation` المنفَّذة أصلاً، لا
فتحُ وحدة هيكل-فقط.

---

## 1. الأقسام المنفَّذة

_(تُملأ تباعاً مع كل دفعة تنفيذ.)_
