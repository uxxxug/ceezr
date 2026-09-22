# SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ وسجلِّ قرارٍ كاملٍ

**التاريخ:** 2026-09-23
**البند:** `SEC-20` (`docs/ROADMAP-MASTER.md:765`)، الحالةُ `[ ]`
**الحاكم:** `ADR 0080` (سجلُّ أفعالِ التدقيقِ) · `ح-7` · `ح-8`
**الفرع:** `feat/sec-20-account-recovery`

---

## ١. الفجوةُ المُسمّاةُ

لا مسارَ استردادٍ إن فُقِدَ حسابُ تيليجرام — المستخدمُ يفقدُ سجلَّه ورحلاتِه بلا بابٍ، والسائقُ يفقدُ اعتمادَه. وطلبُ `pdpl_data_subject_requests` يُربَطُ بـ`requester_telegram_id` لا بـ`users.id`، فمن زالَ ربطُه بتيليجرامَ لا يصلُ إلى طلبه.

## ٢. العلاجُ

جدولُ `account_recovery_requests` يربطُ الطلبَ بـ`users.id` الداخليِّ لا بـ`telegram_id`. المسؤولُ يحدِّدُ `target_user_id` صراحةً، والقرارُ (approve/reject) يلزمُ سببًا من معجمٍ مغلقٍ. ولا يُربَطُ الحسابُ تلقائيًّا — القرارُ يُسجَّلُ في `audit_log` (مَن راجعَ · السببُ · الوقتُ · المستخدمُ المستهدَفُ). وإن قُدِّمَ `claimant_telegram_id` جديدٌ يُستعمَلُ بعدَ الموافقةِ فقط.

## ٣. المكوّناتُ

### ٣-١. الهجرةُ `20260923000000_sec_20_account_recovery.sql`

- **معجمانِ:** `account_recovery_status` (submitted/approved/rejected) و`account_recovery_decision_reason` (٧ أسبابٍ)
- **جدولٌ:** `account_recovery_requests` — يربطُ بـ`users.id` الداخليِّ، RLS مفعّلةٌ
- **دالّةٌ:**
  - `submit_account_recovery_request()` — حراسُ: وجودُ المستهدَفِ · تطابقُ المدينةِ · ملخّصُ غيرِ فارغٍ · `telegram_id` غيرُ مستعمَلٍ لحسابٍ آخرَ
  - `review_account_recovery_request()` — حراسُ: المسؤولُ غيرُ محجوبٍ · القرارُ approve/reject · السببُ من معجمٍ مغلقٍ · الطلبُ في حالةِ submitted · المستهدَفُ موجودٌ. الموافقةُ مع `claimant_telegram_id` تُحدِّثُ `users.telegram_id`
  - `list_pending_account_recovery_requests()` — حراسُ: المسؤولُ غيرُ محجوبٍ. تُعيدُ الطلباتِ المعلَّقةَ مع بياناتِ المستهدَفِ
- **سلبُ التنفيذِ** من `public, anon, authenticated` (SEC-10 · ADR 0140)

### ٣-٢. واجهةُ الإدارةِ

- `GET /admin/recovery` — قائمةُ الطلباتِ المعلَّقةِ
- `POST /admin/users/:id/recovery` — تقديمُ طلبِ استردادٍ
- `POST /admin/recovery/:requestId/review` — مراجعةُ طلبٍ (approve/reject + سببٌ إلزاميٌّ)
- `renderRecoveryPage()` في `apps/admin-dashboard/src/pages/recovery.ts`
- عنصرُ تنقّلٍ «استرداد الحسابات» في `NAV_ITEMS`

### ٣-٣. التسجيلُ في الحواجزِ

- `schema-contract.ts` — ٣ دوالٍ جديدةٍ مُسجَّلةٌ
- `audit-actions-registry.ts` — `review_account_recovery_request` مُسجَّلةٌ بفعلَينِ تدقيقيَّينِ
- `object-authorization-contract.ts` — مسارانِ كتابيّانِ مُسجَّلانِ كـ`admin-guard`
- `rate-limit/policy.ts` — ٣ مساراتٍ مُسجَّلةٌ
- `skip-registry.ts` — اختبارُ التكاملِ مُسجَّلٌ بـ`TEST_DATABASE_URL`

## ٤. الحواجزُ

| الحاجزُ | الحكمُ |
|---|---|
| ملخّصُ أدلّةٍ فارغٌ | `EMPTY_EVIDENCE_SUMMARY` |
| `telegram_id` مستعمَلٌ لحسابٍ آخرَ | `TELEGRAM_ID_IN_USE` |
| قرارٌ مكرَّرٌ | `ALREADY_REVIEWED` |
| مستهدَفٌ غيرُ موجودٍ | `USER_NOT_FOUND` / `TARGET_USER_NOT_FOUND` |
| غيرُ مسؤولٍ | `NOT_ADMIN` |
| سببٌ خارجَ المعجمِ | `INVALID_REASON` (في SQL وTypeScript) |
| قرارٌ غيرُ صحيحٍ | `INVALID_DECISION` |
| لا تسجيلِ أدلّةٍ حسّاسةٍ كنصٍّ خامٍّ | ملخّصُ الأدلّةِ حقلٌ نصّيٌّ واحدٌ |

## ٥. الاختباراتُ

### ٥-١. اختبارُ تكاملٍ على PostgreSQL حقيقيٍّ

`tests/integration/account-recovery.test.ts` — ٨ حالاتٍ:
1. رفضُ ملخّصٍ فارغٍ
2. رفضُ `telegram_id` مستعمَلٍ
3. قبولُ طلبٍ صحيحٍ
4. رفضُ غيرِ مسؤولٍ
5. رفضُ قرارٍ مكرَّرٍ
6. الموافقةُ تُحدِّثُ `telegram_id`
7. الرفضُ لا يُحدِّثُ `telegram_id`
8. `audit_log` يكتبُ الفاعلَ والسببَ والوقتَ

### ٥-٢. اختبارُ وحدةٍ

`tests/unit/sec-20-recovery-reason-guard.test.ts` — `isRecoveryDecisionReason` يقبلُ السببَ الصحيحَ ويرفضُ غيرَه.

## ٦. ما لا يُدَّعى

- لا يُدَّعى أنَّ الاستردادَ آمنٌ تمامًا — المراجعةُ الإداريّةُ قرارٌ بشريٌّ
- لا يُدَّعى أنَّ `telegram_id` الجديدَ آمنٌ — التحققُ من التفرّدِ شرطٌ لا ضمانٌ
- لا يُدَّعى أنَّ `ARCH-014` استُوفي — هذا البابُ يفتحُ مسارًا لا يلغي تيليجرام
- لا يُدَّعى قياسٌ أمامَ `telegram_id = null` حيٍّ في `users` — العمودُ `not null` قبلَ `SEC-19` بندَ ٤

## ٧. رجوعٌ آمنٌ

إضافةٌ محضةٌ — جدولٌ ودوالٌ جديدةٌ ولا عمودَ يُحذَفُ ولا قيدَ يُشدَّدُ ولا دالّةَ قائمةً تُبدَّلُ. وإسقاطُها يُعيدُ الحالَ كما كان.
