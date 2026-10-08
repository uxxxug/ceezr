# PRD-001 — Redis سليمٌ في الإنتاج — دليلٌ حيّ (2026-10-08)

**البند:** PRD-001 · **الحالة:** Open — أُعيدَ فتحُه 2026-10-08 ~11:10 UTC (§8): مستهلكٌ دوريٌّ ثانٍ مقيسٌ يتجاوزُ الحصّةَ المجانيّة؛ الإصلاحُ في PR منفصل، ويعودُ Verified بقياسٍ حيٍّ بعدَ نشرِه.
**المصدر:** طلباتٌ حيّةٌ إلى `waslah-gateway.onrender.com` + Render API (deploys، services، app logs) — 2026-10-08 10:45–10:49 UTC.
**ما لا يحتويه:** لا قيمَ `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`، ولا مضيفَ القاعدة. لم يطّلع الوكيلُ على القيمِ أصلًا.
**السابق:** `PRD-001-redis-diagnosis-20261008.md` (السبب: حصّةُ Upstash مستنفدةٌ بماسحِ `XREAD` غيرِ المشروط).

## 1. المعالجة

| الخطوة | مَن | الدليل |
|---|---|---|
| إيقافُ الاستنزاف: لا `XREAD` بلا مشتركٍ محليّ | الوكيل — #435 (`e5282587`) | اختباران يفشلان على الكودِ القديم |
| قاعدةُ Upstash جديدة + إعادةُ تعيينِ المتغيّرَين في Render | المالك (القيمُ لم تمرَّ بالوكيل) | نشرُ Render `dep-db3n623ncjis73b36peg`، `trigger: service_updated` |

## 2. النشرُ الحيّ (Render API)

| الخدمة | النشر | commit | الحالة | الانتهاء (UTC) |
|---|---|---|---|---|
| `waslah-gateway` (`srv-dat37gou01pc739pgnc0`) | `dep-db3n623ncjis73b36peg` | `e5282587` (يحوي إصلاحَ #435؛ ما بعدَه على `main` وثائقُ فقط) | `live` | 2026-10-08 10:40:43 |

**الخدماتُ التي تعتمدُ على Redis:** `waslah-gateway` وحدَه. والعاملُ مُضمَّنٌ فيه (`embedded_worker.started`، 71 مهمّة، 10:40:28 على النسخة الجديدة `wfqrp`). والخدماتُ الأخرى في مساحةِ Render: `waslah-miniapp` (موقعٌ ثابت) و`waslah-miniapp-staging` (ثابتٌ وموقوف). لا خدمةَ workers ولا admin منفصلة.

**وجودُ المتغيّرَين دون عرضِهما:** في النسخةِ الجديدة `session.store_selected store=redis` (10:40:23)، و`/ready` يُرجعُ `missingEnv: []`. ومع `SESSION_STORE=redis` يبني الكودُ عميلَ Upstash من `config.redisUrl`/`config.redisToken` (`apps/gateway/src/index.ts`، `apps/gateway/src/container.ts`)، ويُسجِّلُ فحصَ `redis` في `/ready`. فالفحصُ جرى ونجح.

## 3. قبل / بعد — `/ready` و`/health`

| | `/ready` | `/health` |
|---|---|---|
| قبل (04:03 UTC) | `{"status":"degraded",...,"degradedChecks":["redis"],"checkDetails":{"redis":"http: HTTP 400: ERR max requests limit exceeded. Limit: 500000, Usage: 500000. ..."}}` | `{"status":"ok"}` |
| بعد (10:45:27 UTC) | HTTP 200 `{"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[],"checkDetails":{}}` | HTTP 200 `{"status":"ok","uptimeSeconds":305}` |
| إعادة (10:48:39 UTC) | HTTP 200 `{"status":"ready",...,"degradedChecks":[]}` | HTTP 200 `{"status":"ok","uptimeSeconds":497}` |

شرطُ القبولِ (`ready` + `failedChecks: []` + `degradedChecks: []`) **محقَّق**.

## 4. عمليّةٌ حقيقيّةٌ في تدفّقِ WASLA — لا `PING`

**حدُّ المعدّلِ الموزَّع.** `GET /v1/policy` محدودٌ بـ30 طلبًا في 60 ثانية (`apps/gateway/src/rate-limit/policy.ts`). والمحدِّدُ مع Redis هو `createRedisRateLimiter`، وهو سكربتُ `EVAL` يكتبُ ويقرأ: `ZREMRANGEBYSCORE` ثم `ZCARD` ثم `ZADD` ثم `PEXPIRE` ثم `ZRANGE`. **وعندَ فشلِ Redis يفشلُ مفتوحًا** (`allowOnFailure`)، أي لا 429 أبدًا. فظهورُ 429 بعدَ الحدِّ تمامًا لا يحدثُ إلا إذا نفّذَ Redis السكربتَ وحفظَ الحالةَ بين الطلبات.

34 طلبًا متتاليًا (10:46:52 إلى 10:47:03 UTC):

```
400 ×30  (السماح — 400 لغيابِ معاملٍ مطلوب، بعدَ المحدِّد)
429 ×4   retry-after: 51 … 50
```

النتيجة: Redis الجديدُ يستقبلُ الطلبات، وينفّذُ `EVAL`، ويحفظُ الحالةَ عبرَ الطلبات. والقطعُ عندَ 30 بالضبط.

## 4ب. مخزنُ جلساتِ البوت — رسالةُ Telegram حقيقيّة (11:02–11:03 UTC)

أرسلَ المالكُ رسالتَين حقيقيّتَين (أمرَين `/…`) من عميلِ Telegram: واحدةً لبوتِ السائق وواحدةً لبوتِ الراكب. لم يُصنَع تحديثٌ اصطناعيّ.

**وصولُ التحديثِ إلى webhook** — جدولُ `telegram_update_jobs` في قاعدةِ الإنتاج (أعمدةُ الحالةِ فقط؛ لا نصَّ ولا مُعرِّف):

| bot | created_at (UTC) | completed_at | status | attempts | error_code | النوع |
|---|---|---|---|---|---|---|
| `driver` | 11:02:36.456 | 11:02:43.007 | `done` | 1 | — | `message`، أمر |
| `rider` | 11:03:20.864 | 11:03:25.119 | `done` | 1 | — | `message`، أمر |

صفُّ المهمّةِ لا يُكتبُ إلا من مسارِ webhook بعدَ تحقّقِ السرّ (`claimAndEnqueue` في `apps/gateway/src/routes/telegram-webhook.ts`)، و`done` بعدَ معالجةٍ كاملة.

**`GET` ثمّ `SET EX` على Redis** — Render app logs، النسخة `wfqrp`:

```
11:02:38.552Z language.hydrated actor=523169d6d14b language=ar from=absent_session
11:03:22.279Z language.hydrated actor=3a91aa4a535a language=ar from=absent_session
```

(`actor` مُجزَّأٌ بـ`pseudonymise`، لا مُعرِّفَ Telegram.) هذا السطرُ في `apps/gateway/src/bots/shared/language-middleware.ts` لا يُكتبُ إلا بعدَ:
1. `sessions.load` ناجحٍ (`ok`) — وإلّا `language.hydrate_session_unreadable`. ونتيجتُه «لا جلسة» (`absent_session`) متوقَّعةٌ على قاعدةٍ جديدةٍ فارغة: هذا `GET` نُفِّذَ وأعادَ `nil`.
2. `sessions.save` ناجحٍ — وإلّا `language.hydrate_save_failed`. والحفظُ في `createRedisSessionStore` هو `SET key value EX ttl`.

ومع `SESSION_STORE=redis` (`session.store_selected store=redis`) فـ`sessions` هو مخزنُ Redis لا الذاكرة. وكلُّ فشلٍ في `load`/`save` يمرُّ بـ`onFailure` فيُكتبُ `session.redis_failed`.

**البحث في السجلّ:**

| البحث | من 10:40:00 إلى ~11:05 UTC | النتيجة |
|---|---|---|
| `redis_failed` (`session.`/`rate_limit.`) | قبلَ الرسالةِ وبعدَها | لا شيء |
| `language.hydrate_session_unreadable` / `hydrate_save_failed` | | لا شيء |
| `max requests limit exceeded` | | لا شيء |
| `level=error\|warn` على النسخة الجديدة `wfqrp` | | سطرٌ واحد: `move_event_outbox.shipper_not_configured` (غيابُ `CORE_EVENTS_*` — لا علاقةَ له بـRedis، بندٌ مستقلّ) |
| `level=error` على النسخة القديمة `mw9d5` | 10:40:08–10:40:47 فقط | `driver_location.hot_state_failed … ENOTFOUND` — النسخةُ القديمةُ أثناءَ التبديل تتّصلُ بمضيفِ القاعدةِ القديمةِ المحذوفة؛ توقّفَت مع إيقافِها |

النتيجة: **مخزنُ جلساتِ Telegram مُختبَرٌ حيًّا** — تحديثٌ حقيقيٌّ وصلَ، و`GET` ثمّ `SET EX` نجحا على Redis الجديد، لكلٍّ من البوتَين.

## 5. السجلّات (Render app logs، منذ 10:40:00 UTC)

| البحث | النتيجة |
|---|---|
| `session.redis_failed` | لا شيء |
| `rate_limit.redis_failed` | لا شيء |
| `exceeded` | سطورُ مهمّةِ `detect-ceiling-exceeded` فقط (`exceeded=0`). لا `max requests limit exceeded` |
| `session.store_selected` | `store: redis` (10:40:23، النسخة `wfqrp`) |

## 6. الحدودُ المعلَنة — ما لم يُقَس

1. ~~مخزنُ جلساتِ البوت لم يُستدعَ بتحديثٍ حقيقيّ.~~ **أُغلِقَ في §4ب** (11:02–11:03 UTC).
2. **انخفاضُ الاستهلاكِ لم يُقَس من عدّادِ Upstash** (لا وصولَ للوكيل). **وتصحيحٌ للادّعاءِ السابقِ هنا:** قيلَ إنَّ ماسحَ `XREAD` هو الدوريُّ الوحيد — **وهذا خطأ** (بحثٌ عن `setInterval` وحدَه). المُجدوِلُ (`apps/workers/src/runner.ts`) يُشغِّلُ `flush-driver-locations` لكلِّ مدينة، وكلُّ دورةٍ `EVAL` على Redis ولو كانت القائمةُ فارغة. التفصيلُ والإصلاحُ في §8.
3. **سجلّاتُ الطلبات (request logs) غيرُ متاحةٍ من Render لهذه الخدمة** (طلباتُ القياسِ نفسُها لا تظهر فيها). فالاستدلالُ من app logs وحدَها.

## 8. إعادةُ الفتح — مستهلكٌ دوريٌّ ثانٍ (مقيسٌ 2026-10-08 ~11:05 UTC)

**القياس (Render app logs، النسخة `wfqrp`، 10:55:00–11:00:00 UTC):** 75 سطرَ `job.ran` لـ`flush-driver-locations` = **15 لكلٍّ من المدنِ الخمس** (دورةٌ ~كلَّ 20ث)، وكلُّها `drained=0` (لا سائقَ نشطاً). وكلُّ دورةٍ `EVAL DRAIN_SCRIPT` واحدٌ (`packages/infrastructure/geo/redis-driver-location-hot-state.ts`؛ الحدودُ من `platform_settings` مُخزَّنةٌ في الذاكرة).

| | أوامر/يوم | أوامر/شهر |
|---|---|---|
| `flush-driver-locations` خاملاً (5 مدن × 3/دقيقة) | ~21,600 | **~648,000** |
| حصّةُ Upstash المجانيّة ([upstash.com/pricing/redis](https://upstash.com/pricing/redis)) | | 500,000 |

والقاعدةُ السابقةُ استُنفِدَت عندَ `Limit: 500000` بالضبط (§3)، فهيَ على الخطّةِ المجانيّة. **فإن كانت الجديدةُ مجانيّةً أيضًا** فهذه المهمّةُ وحدَها، بلا أيِّ مستخدم، تستنفدُ الحصّةَ في ~23 يومًا، ويعودُ `ERR max requests limit exceeded`. خطّةُ القاعدةِ الجديدةِ غيرُ معروفةٍ للوكيل، فلا يُفترَضُ أنّها مدفوعة.

**الإصلاح (PR منفصل، `prd-001-idle-flush-gate`):** بوّابةُ سحبٍ خاملٍ اختياريّةٌ في المحوّل (`idleDrainCeilingMs`)، مُفعَّلةٌ في العاملِ بسقفِ 120ث. لا `EVAL` إلّا إذا: أوّلُ سحبٍ في العمليّة، أو نبضةٌ `queued` أو إعادةُ إصلاحاتٍ منذ آخرِ سحب (من أيِّ محوّلٍ في العمليّة — البوّابةُ والعاملُ المضمَّنُ عمليّةٌ واحدة)، أو آخرُ سحبٍ غيرُ فارغ، أو فشلَ، أو بلغَ السقف. الخاملُ بعدَه: 5 × 720 = ~3,600/يوم (~108K/شهر). والحدُّ المعلَن: نبضاتُ **نسخةٍ أخرى** (لا يوجدُ اليوم — نسخةٌ واحدة) تصلُ القاعدةَ خلالَ ≤120ث بدلَ ~20ث؛ والحالةُ الساخنةُ في Redis تُقرأُ فوراً كما كانت.

**شرطُ العودةِ إلى Verified:** نشرُ الإصلاح، ثمّ في السجلِّ الحيّ: دوراتُ `flush-driver-locations` الخاملةُ بـ`durationMs` ~0 (لا رحلةَ شبكة) بدلَ ~1,300ms، ودورةٌ برحلةٍ كاملةٍ مرّةً كلَّ ~120ث لكلِّ مدينة؛ و`/ready` = `ready`.

## 7. النتيجة

Redis سليمٌ في الإنتاج **الآن**: شرطُ قبولِ PRD-001 محقَّقٌ حيًّا، وعمليّةُ Redis حقيقيّةٌ في تدفّقِ WASLA (حدُّ المعدّل) ناجحةٌ ومُثبَتةٌ بسلوكٍ لا يحدثُ إلا مع Redis سليم. ولا أخطاءَ Redis في السجلِّ منذ النشر.

**وبعدَ §4ب و§8:** مخزنُ جلساتِ Telegram مُختبَرٌ حيًّا وناجح. لكنَّ السببَ الجذريَّ (استنزافُ الحصّة) **لم يُغلَق كاملاً**: مستهلكٌ دوريٌّ ثانٍ مقيسٌ بـ~648K أمرٍ/شهر خاملاً. فالبندُ **Open** حتّى يُنشَرَ إصلاحُ §8 ويُقاسَ حيًّا.
