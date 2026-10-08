# بوابة جاهزية الإنتاج — WASLA

> **المرجعُ التنفيذيُّ لما تبقى حتى: Production Verified → UI-10 Closed → Production Ready**
> ثم بوابات الإطلاق التجاري.

**تاريخ الإنشاء:** 2026-10-08
**الأساس:** `main` عند `c01e3ddbf1890eec9317a2f65f0b2f804ef0613f`
**الحوكمة:** ADR 0246 (مراحل دورة حياة الإنتاج)
**القاعدة الحاكمة:** هذه البوابة كلٌّ لا يتجزّأ — لا يُعلنُ «Production Ready» ما دامَ أيُّ بندٍ فيها `Open` أو `Blocked` أو `Ready`. الحارسُ `check-production-readiness-gate.ts` يُفشلُ CI (exit 1) عند وجودها.

### خمسُ حالاتٍ للبنود (ADR 0246)

| الحالة | المعنى | مانعة؟ | شرطُ القبول |
|---|---|---|---|
| `Open` | عملٌ مطلوبٌ لم يُبدَأ | نعم | — |
| `Ready` | جاهزٌ للتنفيذ، لم يُغلَق | نعم | — |
| `Blocked` | محجوبٌ — ينتظرُ قرارًا أو موردًا | نعم | — |
| `Verified` | أُنجزَ وتُحقّقَ منه بدليلٍ إنتاجي | لا | مسارُ دليلٍ في `docs/evidence/production/` |
| `ADR-Closed` | أُغلقَ بقرارِ مالكٍ موثَّقٍ في ADR | لا | مسارُ ADR في `docs/adr/NNNN-*.md` |

**قاعدةُ الانتقال:** البندُ `Blocked` لا يُغلقُ آليًّا بقرارٍ في وثيقة. ينتقلُ صراحةً إلى `ADR-Closed` مع مسار ADR صالح، أو إلى `Verified` مع مسار دليلٍ إنتاجي.

---

## مراحلُ دورة الحياة (ADR 0246)

| المرحلة | المعنى | الشرطُ للانتقال | الدليل |
|---|---|---|---|
| Implemented | الكودُ مكتوبٌ ويُترجَم ويعمل | CI أخضر على فرع العمل | commit + CI |
| Merged | PR مُدمَجٌ في `main` | CI أخضر على `main` بعد الدمج | merge commit + CI run |
| Deployed | منشورٌ على Render | بصمةُ أصولٍ تطابقُ `main` أو successor | `last-modified` + بصمة |
| Production-Verified | مُختبَرٌ على الإنتاج الحقيقي | smoke test من المصدر الحقيقي | `docs/evidence/production/` |
| Production Ready | كلُّ بنود هذه البوابة مُغلَقة | شهادةُ إغلاق + مرجع البوابة | المالك |

---

## الحالة الراهنة (لقطة 2026-10-08)

| البعد | القيمة | المرحلة |
|---|---|---|
| الكود على `main` | `c01e3dd` — UI-0…UI-10 مُدمجة | Merged |
| الإنتاج (gateway) | بناء 2026-10-03، بصمة `shell-BUjDbL5E` ≠ `shell-C_v6rMFZ` | **غير Deployed** |
| الإنتاج (miniapp) | بناء 2026-10-03، بصمة `shell-BUjDbL5E` ≠ `main` | **غير Deployed** |
| هجرات الإنتاج | آخرها `20261003121359`؛ `20261006200000` و`20261007120000` غير مطبَّقتين | **غير Deployed** |
| `/health` | 200 `ok` | — |
| `/ready` | 200 `degraded` — `degradedChecks: ["redis"]` | **غير Production-Verified** |
| Telegram حقيقي | لم يُختبَر (محاكاة `window.Telegram.WebApp` فقط) | **غير Production-Verified** |
| Screen reader | لم يُختبَر (axe آليٌّ فقط) | **غير Production-Verified** |
| UI-10 | مُدمجة، غير مُغلَقة | Merged |
| Production Ready | لا | — |

---

## P0 — قبل أي إطلاق (استعادة صحة الإنتاج)

### PRD-001: إصلاح Redis المتدهور

| الحقل | القيمة |
|---|---|
| المالك | Owner (يحتاج صلاحية Render + Upstash) |
| المتطلبات المسبقة | وصول إلى console.upstash.com وdashboard.render.com |
| الإجراء المطلوب | تحديث `UPSTASH_REDIS_REST_URL` و`UPSTASH_REDIS_REST_TOKEN` في Render Environment بقيم صالحة من Upstash. تفاصيل كاملة في `docs/evidence/production/PRD-001-redis-owner-action.md` |
| شرط القبول | `GET /ready` يرجع `{"status":"ok","degradedChecks":[]}` + اختبار جلسة حقيقية ناجح |
| الدليل | `docs/evidence/production/PRD-001-redis-healthy-YYYYMMDD.md` يحتوي: قبل/بعد `/ready`، سجلُّ المعالجة، اختبارُ جلسةٍ حقيقي |
| الحالة | **Blocked** — Owner Action: تحديث بيانات اعتماد Upstash في Render (القيم مضبوطة لكن PING يفشل) |

### PRD-002: نشر آخر `main` للـgateway وminiapp

| الحقل | القيمة |
|---|---|
| المالك | Owner (صلاحية Render — `autoDeploy: false`) |
| المتطلبات المسبقة | PRD-001 (Redis) أو قرارٌ موثَّقٌ بالنشرِ رغمَ التدهور |
| الإجراء المطلوب | نشرُ `waslah-gateway` و`waslah-miniapp` من `main` `c01e3dd` |
| شرط القبول | بصمةُ أصولٍ في الإنتاج تطابقُ `main` (`shell-C_v6rMFZ`)؛ `last-modified` يُحدَّث |
| الدليل | `docs/evidence/production/PRD-002-deploy-YYYYMMDD.md` يحتوي: commit، بصمة الأصول قبل/بعد، `last-modified` |
| الحالة | **Blocked** (يحتاج صلاحية إنتاج) |

### PRD-003: تطبيق هجرات UI-8 وUI-10

| الحقل | القيمة |
|---|---|
| المالك | Owner (صلاحية قاعدة الإنتاج) |
| المتطلبات المسبقة | PRD-002 (النشر) — gateway يحتاج الهجرات |
| الإجراء المطلوب | تطبيق `20261006200000` (ETA band) و`20261007120000` (emergency contact) على قاعدة الإنتاج |
| شرط القبول | آخرُ هجرةٍ في الإنتاج = `20261007120000`؛ `read_emergency_contact` تُعيدُ 200 بقيمٍ فارغةٍ لمستخدمٍ بلا جهة |
| الدليل | `docs/evidence/production/PRD-003-migrations-YYYYMMDD.md` يحتوي: ناتجُ `migrate.ts`، استعلامُ آخر هجرة، اختبارُ `read_emergency_contact` |
| الحالة | **Blocked** (يحتاج صلاحية DB إنتاج) |

### PRD-004: تثبيت `/v1` rewrite كمصدر حقيقة

| الحقل | القيمة |
|---|---|
| المالك | Owner (صلاحية Render dashboard) |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | إما كتابة `/v1/*` rewrite في `render.yaml` صراحةً، أو توثيقٌ رسميٌّ محروسٌ بأنَّ الإعداد يدويٌّ في Render dashboard |
| شرط القبول | `render.yaml` يحتوي rewrite لـ`/v1/*`، أو ADR يوثِّقُ القرارَ ويربطه بـ`check-staging-blueprint` |
| الدليل | `render.yaml` diff أو `docs/adr/NNNN-v1-rewrite-source-of-truth.md` |
| الحالة | **Blocked** (يحتاج قرار مالك + معرفة عنوان البوابة لكل بيئة) |

### PRD-005: حسم source maps العامة

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | قرارٌ موثَّق: (أ) إبقاؤها عامة (مع توثيقِ السبب)، أو (ب) `sourcemap: false` في build الإنتاج، أو (ج) رفعُها إلى خدمة أخطاءٍ لا الأصل العام |
| شرط القبول | ADR يوثِّقُ القرارَ؛ `render.yaml` أو `vite.config.ts` يطابقُه |
| الدليل | `docs/adr/NNNN-source-maps-decision.md` |
| الحالة | **Blocked** (قرار مالك — يحتاج ADR) |

### PRD-006: حسم HSTS للـgateway

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد (منصّة Render توفّر HSTS ولكن ليست سياسةً مملوكةً) |
| الإجراء المطلوب | قرارٌ موثَّق: كتابةُ `Strict-Transport-Security` صريحٍ في gateway، أو الاكتفاءُ بسياسة المنصّة مع توثيقِ القرار |
| شرط القبول | ADR يوثِّقُ القرارَ؛ `check-security-headers` لا يُسقط |
| الدليل | `docs/adr/NNNN-hsts-gateway-decision.md` |
| الحالة | **Blocked** (قرار مالك — يحتاج ADR) |

### PRD-007: حسم ألوان Telegram theme

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | قرارٌ موثَّق: (أ) معالجةٌ متوافقةٌ لـ4 مواضع (`#999999`، `#2481cc`، `#708499`/`#5288c1`)، أو (ب) قبولُها كما هي مع توثيقِ الاستثناء |
| شرط القبول | ADR يوثِّقُ القرارَ؛ `check-ui-contrast` لا يُسقط |
| الدليل | `docs/adr/NNNN-telegram-theme-contrast-decision.md` |
| الحالة | **Blocked** (قرار مالك — يحتاج ADR) |

### PRD-008: Smoke test من Telegram حقيقي

| الحقل | القيمة |
|---|---|
| المالك | Owner (يحتاج أجهزة iOS/Android/Desktop) |
| المتطلبات المسبقة | PRD-002 (النشر) + PRD-003 (الهجرات) |
| الإجراء المطلوب | اختبارُ رحلةٍ كاملةٍ من عميل Telegram حقيقي: launch → auth → consent → rider → driver → tracking → SOS → emergency contact، على iOS وAndroid وDesktop |
| شرط القبول | كلُّ مسارٍ يعملُ بلا خطأ؛ `initData` يُوقَّعُ حقيقيًّا؛ BackButton وHaptics وthemeChanged تُختبَر |
| الدليل | `docs/evidence/production/PRD-008-telegram-smoke-YYYYMMDD.md` يحتوي: لقطةُ شاشةٍ لكل خطوة، نسخةُ العميل، نتيجةُ كل مسار |
| الحالة | **Blocked** (يحتاج نشر + أجهزة) |

### PRD-009: إعادة قياس الأداء على الإنتاج

| الحقل | القيمة |
|---|---|
| المالك | Owner (أو Agent بإذن) |
| المتطلبات المسبقة | PRD-002 (النشر) |
| الإجراء المطلوب | إعادةُ تشغيل `measure-tti` و`measure-first-paint` و`check-performance-budget` على الإنتاج الحقيقي بعد النشر |
| شرط القبول | LCP ≤ 2500ms؛ سطحٌ مرسوم ≤ 2000ms؛ الهامشُ لا يقلُّ عن 100ms (UI-10 كان 16ms فقط) |
| الدليل | `docs/evidence/production/PRD-009-perf-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج نشر) |

### PRD-010: تجميد features جديدة

| الحفل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | عدمُ بدء City Pulse / Haptic Seal / Visual Weather / chat / payment للراكب / map / polling / مكتبة UI / إعادة بناء architecture حتى إغلاق هذه البوابة |
| شرط القبول | لا PR جديد لـfeatures يُفتَح حتى تُغلقَ كلُّ بنود P0 |
| الدليل | — (قرارٌ موثَّق في ADR 0246) |
| الحالة | **Ready** (يُفعَّل فورًا) |

---

## P1 — قبول الإنتاج

### PRD-101: Screen reader field testing

| الحقل | القيمة |
|---|---|
| المالك | Owner (يحتاج VoiceOver/TalkBack/NVDA) |
| المتطلبات المسبقة | PRD-008 (Telegram smoke) |
| الإجراء المطلوب | اختبارُ قارئ شاشةٍ حقيقي (VoiceOver على iOS، TalkBack على Android، NVDA على Desktop) على المسارات الحرجة |
| شرط القبول | كلُّ مسارٍ قابلٌ للتنقّل بالقارئ؛ focus order صحيح؛ announcements مفهومة |
| الدليل | `docs/evidence/production/PRD-101-screen-reader-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج نشر + أجهزة) |

### PRD-102: اختبار Redis للجلسات والحدود والـjobs

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | PRD-001 (Redis healthy) |
| الإجراء المطلوب | اختبارُ الجلسات، rate limiting، Socket.IO، jobs المجدولة، lazy jobs بعد إصلاح Redis |
| شرط القبول | جلسةٌ تُنشَأ وتُستهلك؛ rate limit يعمل؛ Socket.IO يتصل؛ jobs تعمل وفق الجدول |
| الدليل | `docs/evidence/production/PRD-102-redis-functional-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج Redis healthy) |

### PRD-103: Runbooks ومراقبة وتنبيهات

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | PRD-001 (Redis) |
| الإجراء المطلوب | إنشاءُ runbooks للعمليات الحرجة، تنبيهات على `/ready` و`/health`، SLO وRTO/RPO، مناوبة |
| شرط القبول | runbook لكل عملية حرجة؛ تنبيهٌ يعمل؛ RTO/RPO موثَّق |
| الدليل | `docs/runbook.md` + `docs/evidence/production/PRD-103-ops-YYYYMMDD.md` |
| الحالة | **Open** |

### PRD-104: تدريب استعادة احتياطي دوري

| الحفل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | تدريبُ استعادةٍ احتياطيٍّ من `uxxxug/ceezr-backups` بزمنٍ موثَّق (OPS-008) |
| شرط القبول | استعادةٌ ناجحةٌ في زمنٍ أقلَّ من RTO المعلَن |
| الدليل | `docs/evidence/production/PRD-104-backup-restore-YYYYMMDD.md` |
| الحالة | **Open** |

### PRD-105: فجوات العقود — تسجيل السائق

| الحقل | القيمة |
|---|---|
| المالك | Owner (قرار نطاق) → Agent (تنفيذ إن قُرِّر) |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | قرارٌ موثَّق: (أ) بناء `POST /v1/onboarding/driver` (D14)، أو (ب) توثيقُ «غير متاحٍ» الصادق، أو (ج) إبقاؤه خارج النطاق |
| شرط القبول | ADR يوثِّقُ القرارَ؛ `SYSTEM_STATE` يطابق |
| الدليل | `docs/adr/NNNN-driver-onboarding-scope.md` |
| الحالة | **Blocked** (قرار مالك — يحتاج ADR) |

### PRD-106: تقييم PRs الاعتماديات (#405–#407)

| الحقل | القيمة |
|---|---|
| المالك | Agent (rebase + CI) → Owner (مراجعة + دمج) |
| المتطلبات المسبقة | لا يوجد |
| الإجراء المطلوب | rebase كل PR على `main` الحالي، تشغيل CI كامل، مراجعة changelog/security advisory، التحقق من `bun.lock` |
| شرط القبول | CI أخضر؛ `bun install --frozen-lockfile` ينجح؛ لا انحدار في الأداء |
| الدليل | نتيجة CI على كل PR |
| الحالة | **Open** (يحتاج rebase أولاً) |

---

## P2 — بوابات الإطلاق التجاري

### PRD-201: بيئة staging شبيهة بالإنتاج (F9)

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | كلُّ P0 مُغلَقة |
| الإجراء المطلوب | إنشاءُ بيئة staging شبيهة بالإنتاج (render.staging.yaml موجود جزئيًا) |
| شرط القبول | staging يعمل بنفس بنية الإنتاج |
| الدليل | `docs/evidence/staging/F9-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج P0) |

### PRD-202: قياس السعة بمولد حمل خارجي (F10)

| الحفل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | PRD-201 (staging) |
| الإجراء المطلوب | قياسُ السعة بمولّدِ حملٍ خارجي (ليس على نفس المضيف) |
| شرط القبول | رقمُ سعةٍ موثَّق مع عنق الزجاجة |
| الدليل | `docs/evidence/staging/F10-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج staging) |

### PRD-203: اختبارات الفوضى والصمود (F11)

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | PRD-202 (قياس السعة) |
| الإجراء المطلوب | اختباراتُ الفوضى: قتلُ مثيل، فقدانُ Redis، تأخيرُ DB |
| شرط القبول | الرحلاتُ لا تُفقد؛ الاستعادةُ تتمُّ في زمنٍ موثَّق |
| الدليل | `docs/evidence/staging/F11-YYYYMMDD.md` |
| الحالة | **Blocked** (يحتاج staging + سعة) |

### PRD-204: الاستدامة الاقتصادية (ECO-001…ECO-008)

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | لا يوجد (قرار مستقل) |
| الإجراء المطلوب | إثباتُ الاستدامة الاقتصادية لكل مدينة |
| شرط القبول | نموذجُ تشغيلٍ قابلٌ للاستمرار موثَّق |
| الدليل | `docs/evidence/commercial/ECO-YYYYMMDD.md` |
| الحالة | **Blocked** (قرارات مالك متعددة) |

### PRD-205: قرارات الإطلاق التجاري (F12)

| الحقل | القيمة |
|---|---|
| المالك | Owner |
| المتطلبات المسبقة | PRD-201…PRD-203 |
| الإجراء المطلوب | حسمُ قرارات: F12-11 (مزود دفع مرخص)، F12-15 (توطين البيانات)، F12-16 (آلية التسعير)، PD-061 (مدينة واحدة أم خمس)، PD-042 (مراجعة وثائق السائق) |
| شرط القبول | كلُّ قرارٍ موثَّق بـADR |
| الدليل | ADR لكل قرار |
| الحالة | **Blocked** (قرارات مالك متعددة) |

---

## شروط إغلاق UI-10

تُغلقُ UI-10 رسميًّا عند تحقّقِ **جميع** البنود التالية:

1. PRD-001: `/ready` = `ok` (Redis healthy)
2. PRD-002: الإنتاج يشغّلُ `c01e3dd` أو successor موثَّق
3. PRD-003: هجرات `20261006200000` و`20261007120000` مطبَّقة
4. PRD-008: Telegram smoke حقيقي موثَّق (iOS/Android/Desktop)
5. PRD-009: الأداء على الإنتاج ضمن الميزانية
6. PRD-004، PRD-005، PRD-006، PRD-007: قرارات Owner مُغلَقة بـADR

---

## شروط إعلان Production Ready

تُعلنُ جاهزيّةُ الإنتاج عند تحقّقِ **جميع** البنود التالية:

1. كلُّ بنود P0 (PRD-001…PRD-010) = `Verified` (بدليلٍ إنتاجي)
2. كلُّ بنود P1 (PRD-101…PRD-106) = `Verified` (بدليلٍ إنتاجي) أو `ADR-Closed` (بمسار ADR صالح)
3. شهادةُ إغلاقٍ في `docs/evidence/production/PRODUCTION-READY-YYYYMMDD.md` موقَّعةٌ من المالك
4. `SYSTEM_STATE.md` يُحدَّثُ ليقول: «Production Ready — <التاريخ> — <المرجع>»
5. `check-production-readiness-gate.ts` يمرُّ (exit 0 — لا بندَ مانعٍ، لا Verified بلا دليل، لا ADR-Closed بلا ADR)

بعد ذلك فقط تُفتَحُ بواباتُ الإطلاق التجاري (P2).

---

## سجلُّ التغييرات

| التاريخ | التغيير | المرجع |
|---|---|---|
| 2026-10-08 | الإنشاء — تحويلُ تقرير المراجعة إلى خارطة تنفيذية حاكمة | ADR 0246 |
