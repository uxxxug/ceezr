# فحص البيئات الفعلية — 2026-10-02

> **المنهج:** فحص HTTP مباشر لكل خدمة منشورة، لا اعتماد على ملفات.
> **الوقت:** 2026-10-02 10:29 UTC (13:29 +03)

## الخدمات المنشورة

### 1. waslah-gateway.onrender.com

| الفحص | النتيجة | الحكم |
|---|---|---|
| `GET /ready` | 200 — `{"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[],"checkDetails":{}}` | **منشور وجاهز** |
| `GET /health` | 200 — `{"status":"ok","uptimeSeconds":44}` | **حيّ** |
| `GET /` | 404 | متوقع (لا مسار جذر) |
| `GET /v1/me` | 401 | مسار مركب، يتطلب مصادقة |
| `GET /v1/me/places` | 401 | مسار مركب، يتطلب مصادقة |
| `POST /v1/session/refresh` | 400 | مسار مركب، يتطلب جسمًا |
| `GET /admin` | 303 | مسار مركب، يعيد توجيه للدخول |
| `GET /v1/driver/deductions` | **404** | **غير منشور** — DEC-37 في main لكنه غير منشور |
| `GET /v1/me/emergency-contact` | **404** | **غير منشور** — DEC-41 في main لكنه غير منشور |
| `GET /v1/me/notification-preferences` | **404** | **غير منشور** — DEC-42 في main لكنه غير منشور |

**الحكم:** الخدمة منشورة وتعمل، لكنها متأخرة عن main — مسارات DEC-37 و DEC-41 و DEC-42 و DEC-43 غير منشورة.

### 2. waslah-miniapp.onrender.com

| الفحص | النتيجة | الحكم |
|---|---|---|
| `GET /` | 200 | **منشور** |
| `GET /health` | 200 | **منشور** |

**الحكم:** الخدمة منشورة وتعمل.

### 3. waslah-worker.onrender.com

| الفحص | النتيجة | الحكم |
|---|---|---|
| `GET /` | 404 | متوقع (عامل خلفي بلا HTTP) |

**الحكم:** الخدمة موجودة على Render لكنها عامل خلفي بلا مسارات HTTP — غير قابل للتحقق عبر HTTP.

### 4. ceezr.onrender.com

| الفحص | النتيجة | الحكم |
|---|---|---|
| `GET /ready` | 404 | **خدمة قديمة** — كانت URL النشر القديمة قبل `render.yaml` |

**الحكم:** URL قديم لم يعد هو الخدمة الرئيسية. الخدمة الفعلية على `waslah-gateway.onrender.com`.

## الانحراف عن main

| المسار | في main | في البيئة | الحكم |
|---|---|---|---|
| `GET /v1/driver/deductions` | نعم (DEC-37) | 404 | **متأخر نشرًا** |
| `GET /v1/me/emergency-contact` | نعم (DEC-41) | 404 | **متأخر نشرًا** |
| `PUT /v1/me/emergency-contact` | نعم (DEC-41) | 404 | **متأخر نشرًا** |
| `GET /v1/me/notification-preferences` | نعم (DEC-42) | 404 | **متأخر نشرًا** |
| `PUT /v1/me/notification-preferences` | نعم (DEC-42) | 404 | **متأخر نشرًا** |
| `POST /v1/support/tickets/:id/messages` | نعم (DEC-43) | 404 | **متأخر نشرًا** |
| `GET /v1/support/tickets/:id/messages` | نعم (DEC-43) | 404 | **متأخر نشرًا** |
| `POST /v1/driver/support/tickets/:id/messages` | نعم (DEC-43) | 404 | **متأخر نشرًا** |
| `GET /v1/driver/support/tickets/:id/messages` | نعم (DEC-43) | 404 | **متأخر نشرًا** |

**الخلاصة:** النشر متأخر عن main بـ 8 مسارات من 4 ميزات (DEC-37، DEC-41، DEC-42، DEC-43). `autoDeploy: false` في `render.yaml`، والنشر بقرار يدوي.
