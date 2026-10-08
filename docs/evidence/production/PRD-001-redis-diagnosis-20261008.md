# PRD-001 — تشخيصُ Redis المتدهور — دليلٌ مقيس (2026-10-08)

**البند:** PRD-001 · **الحالة بعد هذا الدليل:** Blocked (السببُ مقيسٌ ومُصلَحٌ في الكود؛ الحصّةُ قرارُ مالك)
**ما لا يحتويه:** لا أسرار، لا عناوين قواعد، لا رموز.

## 1. قبل — العرضُ بلا سبب

`GET https://waslah-gateway.onrender.com/ready` (2026-10-08، قبل النشر):

```json
{"status":"degraded","missingEnv":[],"failedChecks":[],"degradedChecks":["redis"],"checkDetails":{}}
```

سجلّاتُ Render للـgateway منذ نشر 2026-10-07: `session.redis_failed kind=http detail="HTTP 400" operation=load` متكرّرًا. أي أنَّ Upstash **يردُّ** (المضيفُ والاعتمادُ يصلان) لكنه يرفض — والمحوّلُ كان يُسقِطُ جسمَ الرفض.

## 2. أداةُ التشخيص — PR #434 (`da5c516`)

نقلُ رسالةِ Upstash مُعقَّمةً إلى التفصيل وإلى `checkDetails.redis`. نُشرَ على Render (`dep-db3hblegekts73eq1cu0`، commit `da5c516`).

## 3. بعد النشر — السببُ مقروء

```json
{"status":"degraded","missingEnv":[],"failedChecks":[],"degradedChecks":["redis"],
 "checkDetails":{"redis":"http: HTTP 400: ERR max requests limit exceeded. Limit: 500000, Usage: 500000. See [url] for details"}}
```

**السببُ الجذريُّ للعَرَض:** حصّةُ الطلباتِ الشهريّةُ لقاعدةِ Upstash (500,000) مستنفدةٌ بالكامل. ليست قيمةُ URL/Token خاطئةً، وليست الشبكة.

## 4. من استنفدَ الحصّة — من الكود لا تخمينًا

- `apps/gateway/src/container.ts`: متى وُجدَ Redis يُبنى `createRedisStreamTrackingEventBus({ pollMs: DEFAULT_POLL_MS })` ويُستدعى `start()`.
- `packages/infrastructure/tracking/redis-stream-event-bus.ts`: `DEFAULT_POLL_MS = 250`، و`setInterval` يطلبُ `XREAD` **في كلِّ دورةٍ بلا شرط**.
- الحساب: 4 طلباتٍ/ثانية × 86,400 = 345,600/يوم ≈ **10.4 مليون/شهر** للنسخةِ الواحدة — أي الحصّةُ كلُّها في أقلَّ من يومَين.
- الماسحُ الدوريُّ الوحيدُ على Redis في `apps/gateway` و`packages` (`setInterval` + `redis` ⇒ هذا الملفُّ وحدَه). وبقيّةُ الاستعمال (جلساتٌ، حدُّ معدّل، `PING` للجهوزيّة) لكلِّ طلبٍ أو حدثٍ لا لكلِّ ربعِ ثانية.

## 5. الإصلاح

الناقلُ المحليُّ لا يُعيدُ حدثًا لمشتركٍ لاحق (`packages/infrastructure/tracking/event-bus.ts`)، فدورةٌ بلا مشتركٍ محليٍّ تُسلِّمُ إلى لا أحد. فـ:

- دورةٌ بلا مشتركٍ محليٍّ تُتخطّى **بلا طلب**.
- أوّلُ دورةٍ بعدَ خمولٍ تستأنفُ المؤشّرَ من `الآن − 2000ms` لا من `$` — فلا يفوتُ حدثٌ نُشرَ حولَ لحظةِ الاشتراك؛ والتكرارُ المحتملُ يمتصُّه حدُّ «مرّةً على الأقلّ» المعلَنُ في الملفّ.

الاختبار: `tests/unit/redis-stream-event-bus.test.ts` — «لا يطلبُ XREAD بلا مشتركٍ» و«يستأنفُ ويُسلِّمُ عبرَ نسختَين»؛ **كلاهُما يفشلُ على الكودِ القديم** (قِيسَ بإرجاعِ الملفّ) ويمرُّ على الجديد.

## 6. ما بقيَ — قرارُ مالك

الإصلاحُ يوقفُ الاستنزاف، لكنّه لا يُعيدُ حصّةً مستنفدة. فاستعادةُ `/ready = ready` تحتاجُ أحدَ:

1. ترقيةَ خطّةِ قاعدةِ Upstash (Pay-as-you-go أو ثابتة) من لوحةِ Upstash؛ أو
2. قاعدةَ Upstash جديدةً وتحديثَ `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` في Render؛ أو
3. انتظارَ تجدُّدِ الحصّةِ الشهريّة.

وكلُّها خارجَ ما يستطيعُه الوكيل: لا مفتاحَ لإدارةِ Upstash، ومُوصِّلُ Render يتطلّبُ القيمَ نصًّا صريحًا.

## 7. التحقّقُ بعدَ القرار

`/ready` → `{"status":"ready","failedChecks":[],"degradedChecks":[]}` + غيابُ `session.redis_failed` في سجلِّ Render + اختبارُ جلسةٍ حقيقيٌّ عبرَ البوت — في `PRD-001-redis-healthy-YYYYMMDD.md`.
