# PRD-001 — Redis سليمٌ في الإنتاج — دليلٌ حيّ (2026-10-08)

**البند:** PRD-001 · **الحالة:** Verified
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

## 5. السجلّات (Render app logs، منذ 10:40:00 UTC)

| البحث | النتيجة |
|---|---|
| `session.redis_failed` | لا شيء |
| `rate_limit.redis_failed` | لا شيء |
| `exceeded` | سطورُ مهمّةِ `detect-ceiling-exceeded` فقط (`exceeded=0`). لا `max requests limit exceeded` |
| `session.store_selected` | `store: redis` (10:40:23، النسخة `wfqrp`) |

## 6. الحدودُ المعلَنة — ما لم يُقَس

1. **مخزنُ جلساتِ البوت (`GET`/`SET EX` لحالةِ الحوار) لم يُستدعَ بتحديثٍ حقيقيّ.** مسارُ webhook Telegram يرفضُ أيَّ طلبٍ بلا سرِّه، فلا يُصنَعُ تحديثٌ اصطناعيّ. ولم يظهر في السجلِّ نشاطُ بوتٍ منذ 10:40. وهو العميلُ نفسُه (`config.redisUrl`/`config.redisToken`) والمسارُ نفسُه (Upstash REST)، ولا يختلفُ إلا في الأمر. وأوّلُ رسالةٍ حقيقيّةٍ للبوت تُغلقُ هذا: يُبحَثُ بعدَها عن `session.redis_failed` (المتوقَّع: لا شيء).
2. **انخفاضُ الاستهلاكِ لم يُقَس مباشرةً.** لا وصولَ للوكيل إلى عدّادِ Upstash. والقائمُ: النشرُ الحيُّ `e5282587` يحوي الإصلاح، وماسحُ `XREAD` هو الدوريُّ الوحيدُ على Redis في الـgateway (`setInterval` + `redis`). والتحقّقُ المباشرُ من لوحةِ Upstash: الاستهلاكُ اليوميُّ يجبُ أن يكونَ بالآلاف لا مئاتِ الآلاف.
3. **سجلّاتُ الطلبات (request logs) غيرُ متاحةٍ من Render لهذه الخدمة** (طلباتُ القياسِ نفسُها لا تظهر فيها). فالاستدلالُ من app logs وحدَها.

## 7. النتيجة

Redis سليمٌ في الإنتاج: شرطُ قبولِ PRD-001 محقَّقٌ حيًّا، وعمليّةُ Redis حقيقيّةٌ في تدفّقِ WASLA (حدُّ المعدّل) ناجحةٌ ومُثبَتةٌ بسلوكٍ لا يحدثُ إلا مع Redis سليم. ولا أخطاءَ Redis في السجلِّ منذ النشر.
