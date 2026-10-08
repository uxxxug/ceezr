# PRD-001 — Redis Healthy — Owner Action Required

**التاريخ:** 2026-10-08
**البند:** PRD-001 (Production Readiness Gate)
**الحالة:** Blocked — Owner Action مطلوب

---

## التشخيص الحالي

### ما يحدث في الإنتاج الآن

```
GET /ready → 200 {"status":"degraded","missingEnv":[],"failedChecks":[],"degradedChecks":["redis"],"checkDetails":{}}
GET /health → 200 {"status":"ok"}
```

### ما يعنيه هذا

| المؤشر | القيمة | التفسير |
|---|---|---|
| `missingEnv` | `[]` | متغيرات البيئة `UPSTASH_REDIS_REST_URL` و`UPSTASH_REDIS_REST_TOKEN` **مضبوطة** في Render |
| `failedChecks` | `[]` | لا توجد فحوص حرجة فاشلة (قاعدة البيانات ومخططها يجتازان) |
| `degradedChecks` | `["redis"]` | فحص Redis PING فشل — الاتصال بـUpstash لا يعمل |
| HTTP status | `200` | الخدمة تعمل، لكنها متدهورة بسبب Redis |

### الكود الذي يُنفّذ الفحص

في `apps/gateway/src/index.ts` (السطر 1416–1427):

```typescript
...(rateRedis === null
  ? []
  : [
      {
        name: "redis",
        critical: false,
        check: async (): Promise<boolean> => {
          const result = await rateRedis.command(["PING"]);
          return result.ok;
        },
      },
    ]),
```

`rateRedis` يُنشأ عند `SESSION_STORE=redis` (وهو ما هو مضبوط في الإنتاج) من:

```typescript
createUpstashRedis({
  url: config.redisUrl,      // process.env.UPSTASH_REDIS_REST_URL
  token: config.redisToken,  // process.env.UPSTASH_REDIS_REST_TOKEN
})
```

---

## الأسباب المحتملة

بما أن المتغيرات مضبوطة لكن PING يفشل، الأسباب المحتملة هي:

1. **Upstash database محذوفة أو متوقفة** — قاعدة Redis لم تعد موجودة في حساب Upstash.
2. **REST URL غير صحيح** — القيمة في Render لا تطابق عنوان REST API الصحيح.
3. **Token منتهي أو خاطئ** — رمز REST API لم يعد صالحًا.
4. **مشكلة شبكة** — Upstash غير قابل للوصول من Render (نادر لكن ممكن).

---

## ما يجب على المالك فعله (Owner Action)

### الخطوة 1 — التحقق من Upstash

1. سجّل الدخول إلى [console.upstash.com](https://console.upstash.com).
2. تأكّد من وجود قاعدة Redis نشطة باسم المشروع (مثل `wasla` أو ما يعادله).
3. انسخ القيمتين التاليتين:
   - **REST URL** — يبدأ بـ `https://` وينتهي بـ `.upstash.io`
   - **REST Token** — رمز طويل

### الخطوة 2 — تحديث متغيرات البيئة في Render

1. سجّل الدخول إلى [dashboard.render.com](https://dashboard.render.com).
2. افتح خدمة `waslah-gateway`.
3. اذهب إلى **Environment** tab.
4. حدّث المتغيرين التاليين بالقيم من Upstash:
   - `UPSTASH_REDIS_REST_URL` — REST URL من Upstash
   - `UPSTASH_REDIS_REST_TOKEN` — REST Token من Upstash
5. **لا تُغيّر أي متغير آخر.**
6. احفظ التغييرات (Render سيعيد نشر الخدمة تلقائيًا).

### الخطوة 3 — التحقق بعد التحديث

بعد اكتمال إعادة النشر (1–2 دقيقة)، تحقّق من:

```bash
curl -s https://waslah-gateway.onrender.com/ready
```

النتيجة المتوقّعة بعد النجاح:

```json
{"status":"ok","missingEnv":[],"failedChecks":[],"degradedChecks":[]}
```

### الخطوة 4 — إخطار الوكيل

بعد تحقّقك من أن `/ready` يرجع `ok` (وليس `degraded`)، أخبر الوكيل (Agent) بذلك ليُكمل:

- اختبار جلسة حقيقية على Redis.
- إنشاء دليل PRD-001.
- تحديث حالة PRD-001 إلى `Verified`.

---

## القيود

- **لا يستطيع الوكيل** الوصول إلى لوحة Render أو Upstash لتغيير القيم.
- **لا يستطيع الوكيل** اختبار Redis ببيانات حقيقية بدون صلاحية الإنتاج.
- **لا يستطيع الوكيل** تشغيل اختبار جلسة على إنتاج بلا بيانات اعتماد صالحة.
- **يجب أن تكون** القيم في Render مطابقة تمامًا لقيم Upstash (لا مسافات زائدة، لا أقواس).

---

## العقد القائم (Contract)

المتغيرات المطلوبة من قبل الكود:

| المتغير | المصدر | القيمة المتوقّعة |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash → قاعدة Redis → REST API | `https://<database-id>.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → REST API | رمز طويل (ليس `READONLY`) |
| `SESSION_STORE` | render.yaml (مضبوط) | `redis` |

المرجع: `docs/render-deployment-vars.md` §2 — المتغيّرات الإلزامية.

---

## ما سيحدث بعد إصلاح المالك

عند تحقّق أن `/ready` يرجع `ok`:

1. الوكيل ينفّذ اختبار جلسة حقيقية على Redis:
   - إنشاء جلسة عبر `POST /v1/session/telegram`
   - التحقق من أن الجلسة مُخزَّنة في Redis
   - التحقق من انتهاء صلاحيتها بعد `SESSION_TTL_SECONDS`
2. الوكيل ينشئ الدليل: `docs/evidence/production/PRD-001-redis-healthy-YYYYMMDD.md`
3. الوكيل يحدّث PRD-001 إلى `Verified` في البوابة
4. الوكيل يفتح PR مستقل بالتغييرات
