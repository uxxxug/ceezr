# دليلُ صوابِ توحيدِ إشعاراتِ الاشتراكِ في صندوقِ الصادرِ الموحَّدِ (F6-03، المرحلةُ الثانية)

> البندُ `n` في `docs/ROADMAP-MASTER.md` — «Outbox معاملاتي موحّد (BUG-004)».
> المرحلةُ الأولى (safety) في `F6-03-safety-unification-20260908.md`.
> هذه المرحلةُ توحِّدُ صندوقَ إشعاراتِ دورةِ حياةِ الاشتراكِ في `notification_outbox`.

## ما تغيّر

### الهجراتُ المضافة

| الملف | الغرض |
| --- | --- |
| `20260908020000_unified_outbox_subscription_notice.sql` | توحيدُ subscription_notices في notification_outbox: إضافةُ نوعِ `subscription_notice`، وحالةِ `failed`، وأعمدةِ `chat_id`/`language_code`/`error_code`، وقيدِ شكلٍ جزئيٍّ يُلزمُ chat_id+language_code+notice_kind ضمن الأنواعِ الأربعةِ. إعادةُ تعريفِ `enqueue_subscription_notice` و`claim_subscription_notices` و`finish_subscription_notice` كأغلفةٍ على notification_outbox. |
| `20260908021000_unified_outbox_ride_cycle_claim_scope.sql` | تحديدُ `claim_notification_delivery` (عاملُ دورةِ الرحلةِ) بأنواعِ دورةِ الرحلةِ الثمانيةِ وحدَها، فلا يلتقطُ صفوفَ subscription_notice/safety_incident التي لها عوّالُها الخاصّةُ. حفظُ كلِّ فروعِ الإغناءِ كما كانت. |
| `20260908020500_unified_outbox_subscription_backfill.sql` | ترحيلُ صفوفِ subscription_notices القديمةِ إلى notification_outbox: sent→delivered (مع message_id وdelivered_at)، failed→failed (مع error_code)، pending/sending كما هي (مع claim_token/claimed_at). Idempotent عبر ON CONFLICT. |

### القراراتُ التصميميّة

- **النوعُ الفرعيُّ في الحمولةِ لا في kind**: خُزِّنَ `notice_kind` (activated/trial_expired/expired/cancelled) في `payload` بدلاً من نوعٍ منفصلٍ في `kind`. التفريدُ يعملُ عبر `dedup_key='subscription:'||subscription_id||':'||notice_kind`. هذا يُبقي `kind` تصنيفاً تشغيلياً موحَّداً، ويُمكِّنُ `claim_subscription_notices` من إرجاعِ النوعِ الفرعيِّ كما كان.
- **الحالةُ الموحَّدةُ `delivered`**: داخلياً يُخزَّنُ `delivered` لا `sent`. الأغلفةُ تُرجِعُ واجهتَها القديمةَ (status:'sent') في JSON لتبقى واجهةُ RPC محفوظةً، لكنّ القاعدةَ تقولُ `delivered`.
- **تحديدُ مطالبةِ العاملِ الأساسيِّ**: بدلَ إضافةِ معالجِ subscription لعاملِ دورةِ الرحلةِ (وهو خطأٌ لأنّ subscription يلتقطُ chat_id/language_code لحظةَ الإدراجِ لا حيًّا)، حُدِّدَت `claim_notification_delivery` بأنواعِ دورةِ الرحلةِ وحدَها. كلُّ نوعٍ موحَّدٍ له عاملُهُ ومطالِبُهُ الخاصُّ.

### سجلُ الرجوع (rollback-registry)

أُضيفَ 4 إدخالاتٍ في `scripts/lib/rollback-registry.ts`:
- `20260908020000::revoke_function:enqueue_subscription_notice(3)` — criticalPath: المهامُّ الدوريةُ والقفلُ الموزَّع
- `20260908020000::revoke_function:claim_subscription_notices(1)` — criticalPath: المهامُّ الدوريةُ والقفلُ الموزَّع
- `20260908020000::revoke_function:finish_subscription_notice(6)` — criticalPath: المهامُّ الدوريةُ والقفلُ الموزَّع
- `20260908021000::revoke_function:claim_notification_delivery(0)` — criticalPath: دورةُ الرحلةِ والإسناد

جميعُها `rollbackPath: code-only`، `coupledDeploy: true` — العودةُ بالكودِ وحدَه: النسخةُ السابقةُ تقرأُ من subscription_notices فلا تجدُ ما أودَعَتْه النسخةُ الجديدةُ في notification_outbox.

### تعديلاتُ الاختبارات

- `tests/integration/subscription-notices.test.ts`: `noticeRows()` تقرأُ من notification_outbox (`payload->>'notice_kind' as kind`، `delivered_message_id as message_id`)، status `sent`→`delivered`، truncate يُضيفُ notification_outbox، استعلاماتُ `next_attempt_at`/`claimed_at` تستهدفُ notification_outbox.
- `tests/integration/trial-lifecycle.test.ts`: `noticeRows()` تقرأُ من notification_outbox، status `sent`→`delivered`، truncate يُضيفُ notification_outbox.

## الأدلّةُ على الصواب

### ١. اختباراتُ التكاملِ على PostgreSQL حقيقية

```
tests/integration/subscription-notices.test.ts: 11 pass / 0 fail
tests/integration/trial-lifecycle.test.ts: 5 pass / 0 fail (دورةُ الشهرِ المجاني)
tests/integration/support-tickets.test.ts: 18 pass / 0 fail
tests/integration/notification-outbox-cancellation.test.ts: 6 pass / 0 fail
```

### ٢. المجموعةُ الكاملةُ على قاعدةٍ نظيفة

قاعدةُ بياناتٍ أُنشئتْ من الصفرِ (drop + create)، طُبِّقَتْ عليها كلُّ الهجراتِ (72 هجرةً بلا إخفاقٍ واحدٍ)، ثمّ شُغِّلَتْ المجموعةُ الكاملةُ:

```
2695 pass / 26 skip / 0 fail / 10057 expect() calls
Ran 2721 tests across 215 files.
```

الأساسُ قبلَ المرحلةِ الثانيةِ كان 2202 pass / 128 fail (Redis-dependent). بعدَ التوحيدِ: 2695 pass / 0 fail — لا إخفاقٍ جديدٍ، والصفوفُ التي كانت معطّلةً (Redis-dependent) صارتْ تمرُّ مع وجودِ قاعدةِ بياناتٍ فعليةٍ.

### ٣. الحرّاسُ (guards)

```
lint (biome): 0 errors
typecheck (tsc): 0 errors
check-schema-contract: 87 دالّة و23 جدولاً — مطابق
check-rollback-safety: ✅ (تحذيرانِ موجودانِ سلفاً لـforward-only migrations)
check-adr-numbering: 61 قراراً بأرقامٍ فريدة
check-skip-classification: ✅
check-instance-invariant: ✅
check-env-drift: ✅
check-migrations: ✅ 39 جدولاً
```

### ٤. التحققُ من الترحيلِ

أُدرجَتْ صفوفٌ قديمةٌ في subscription_notices بالحالاتِ الأربعِ (pending/sending/sent/failed)، ثمّ شُغِّلَ الترحيلُ:

| الحالةُ القديمة | الحالةُ الجديدة | delivered_message_id | delivered_at | error_code |
| --- | --- | --- | --- | --- |
| sent | delivered | 8001 | ✅ مضبوط | — |
| failed | failed | — | — | 403:block |

الترحيلُ idempotent: إعادةُ تشغيلِهِ لا تُضاعفُ الصفوفَ (ON CONFLICT DO NOTHING).

## ما لم يُفعل بعد

- **المرحلةُ 3 (broadcast)**: توحيدُ broadcast_recipients بنفسِ النمطِ، مع آثارِ إكمالِ الحملةِ في `finish_broadcast_delivery` و`cancel_broadcast`.
- **المرحلةُ 4 (التقليص)**: إسقاطُ الجداولِ الثلاثةِ القديمةِ (safety_incident_deliveries، subscription_notices، broadcast_recipients) بعدَ استقرارِ التسليمِ من المصدرِ الموحَّد.
- **3 جولاتِ CI خضراءَ متتالية** على PR #29 قبلَ قلبِ `n` إلى `[x]` (ح-4).

## روابط

- ADR-0061: `docs/adr/0061-unified-transactional-outbox.md`
- PR #29: https://github.com/noor-seez/ceezr/pull/29
- المرحلةُ 1 (safety): `docs/evidence/correctness/F6-03-safety-unification-20260908.md`
