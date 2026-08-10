# واجهات النظام (API)

> **الحالة: مُطابِق للواقع.** حُرِّر بعد استخراج المسارات من الكود ودوال القاعدة
> من قاعدة حيّة، لا من نيّة تصميم. النسخة السابقة كانت «هيكلاً مخطَّطاً» وذكرت
> ثلاث دوال لا وجود لها (`claim_delivery`, `renew_subscription`, `top_up_wallet`).
>
> عند تعديل أي مسار أو دالّة، حدِّث هذا الملفّ في **نفس** الدفعة.

---

## 1) البوّابة العامّة (Gateway)

تُركَّب في `apps/gateway/src/server.ts`. **مكشوفة على الإنترنت.**

### الصحّة والجاهزية

| المسار | الطريقة | المصادقة | الغرض |
|---|---|---|---|
| `/health` | GET | لا | حيويّة العملية فقط. يجيب 200 ما دامت تستجيب |
| `/ready` | GET | لا | جاهزية للخدمة. `healthCheckPath` في `render.yaml` |

`/ready` يعيد `{ status, missingEnv, failedChecks, degradedChecks }` بثلاث حالات:

| `status` | الرمز | المعنى |
|---|---|---|
| `ready` | 200 | كل شيء سليم |
| `degraded` | **200** | تبعية **غير حرجة** ساقطة (مثل Redis). الخدمة تعمل بقدرة أقلّ |
| `not_ready` | 503 | متغيّر بيئة ناقص، أو تبعية **حرجة** ساقطة |

> ⚠️ `degraded` يجيب **200**. فمراقبةٌ تقيس رمز HTTP وحده **لن ترى تعطّل Redis**.
> مطابقة نصّ الجسم على `"status":"ready"` **إلزامية** لا اختيارية.
> التفصيل في [`render-deployment-vars.md`](./render-deployment-vars.md).

### ويبهوك تلغرام

| المسار | الطريقة |
|---|---|
| `/webhook/telegram/:bot` | POST |

`:bot` من `driver` أو `rider` حصراً؛ غيرهما **404** `UNKNOWN_BOT`.

**المصادقة:** ترويسة `x-telegram-bot-api-secret-token` تُطابَق بمقارنة زمن ثابت
مع `TELEGRAM_WEBHOOK_SECRET`.

**الردود:**

| الحالة | الرمز | الجسم |
|---|---|---|
| عولج | 200 | `{ ok: true }` |
| لم يُعرَف نوع التحديث | 200 | `{ ok: false, error: "NOT_HANDLED" }` |
| سرّ خاطئ أو غائب | 401 | `{ ok: false, error: "INVALID_SECRET" }` |
| جسم ليس JSON | 400 | `{ ok: false, error: "INVALID_JSON" }` |
| التحديث ليس كائناً | 400 | `{ ok: false, error: "INVALID_UPDATE" }` |
| الجسم > 256 كِبّي | 413 | `{ ok: false, error: "PAYLOAD_TOO_LARGE" }` |
| تجاوز حدّ المعدّل | 429 | مع `Retry-After` |

**لماذا 200 لما لم يُعالَج:** تلغرام يعيد إرسال أي ردّ غير 2xx. فالردّ بخطأ على
تحديث لن نعالجه أبداً يصنع حلقة إعادة لا تنتهي.

**الحدود** (نافذة ثابتة):

| الحدّ | القيمة | يُحتسب على |
|---|---|---|
| فحص السرّ | 20 / دقيقة | عنوان المُرسِل، **بعد** فشل السرّ فقط |
| المستخدم | 30 / 10 ثوانٍ | معرّف صاحب التحديث، بعد التحقّق |

حدّ الفحص يُحتسب بعد فشل السرّ لا قبله عمداً: تحديثات تلغرام تأتي من حزمة عناوين
ضيّقة، فحدُّ العنوان قبل التحقّق كان سيخنق المنصّة نفسها لا المهاجم.

**حدّ الحجم 256 كِبّي:** يُقاس بقراءة التدفّق مقطعاً مقطعاً مع الإلغاء فور
التجاوز (`readBounded`)، لا بقراءة الجسم كاملاً ثم قياسه — وإلا لكانت الحماية
وهمية. القياس بالبايت لا بالمحارف.

---

## 2) لوحة الإدارة

تُركَّب في `apps/gateway/src/index.ts` (لا في `server.ts` — ADR 0007)، بموجّهين
منفصلين: `/admin/api` **قبل** `/admin`، وإلا التقط حارس الصفحات نداءات JSON.

**المصادقة:** كعكة `waslah_admin` (HttpOnly · SameSite=Strict · Path=/admin).
كل طلب يعيد فحص الدور والحظر. عمر الجلسة 8 ساعات.
**CSRF:** رمز = `sha256(sessionTokenHash + ":csrf")`، مطلوب في كل POST.

**الدخول:** رمز لمرّة واحدة يُرسَل عبر بوت تلغرام. صلاحيته 600 ثانية، وبحدّ
**5 رموز/ساعة** لكل مستخدم و**5 محاولات** لكل رمز.

### `/admin/api/*` — JSON

| المسار | الطريقة | الغرض |
|---|---|---|
| `/overview` | GET | ملخّص المؤشّرات |
| `/live-orders` | GET | الطلبات الجارية (`stallSeconds` لكشف العالق) |
| `/heatmap` | GET | كثافة الطلب. يتطلّب `city` وإلا 400 `CITY_REQUIRED` |
| `/cities` | GET | المدن وحالة تفعيلها |
| `/search` | GET | بحث المجموعات (فارغ ⇒ `{ groups: [] }`) |
| `/drivers` · `/ratings` · `/attendance` · `/disputes` | GET | جداول تشغيلية |
| `/settings` | GET | إعدادات المدينة |
| `/drivers/:id/verification` | POST | تغيير حالة التحقّق |
| `/users/:id/blocked` | POST | حظر/رفع حظر |
| `/settings/:cityId/:key` | POST | تعديل إعداد واحد |
| `/settings/:cityId/group-ids` | POST | معرّفات قروبات المدينة الثلاثة |

كل الردود بالشكل `{ ok: true, ... }` أو `{ ok: false, error: "<رمز>" }`.

### `/admin/*` — صفحات HTML

`/login` · `/login/code` · `/login/verify` · `/logout` · `/` (اللوحة).
كل نصّ يمرّ بـ `escapeHtml` في `apps/admin-dashboard/src/layout.ts`.

---

## 3) دوال القاعدة الذرّية

كلّها `SECURITY DEFINER` بـ `search_path` مثبَّت، وتعيد `jsonb` بالشكل
`{ ok: true, ... }` أو `{ ok: false, error: "<رمز>" }` — لا تُلقي استثناءات
للحالات المتوقَّعة. القائمة مستخرَجة من قاعدة حيّة.

### دورة الرحلة

| الدالّة | الغرض |
|---|---|
| `claim_ride(order_id, driver_id)` | أوّل قبول يفوز. `for update` على الطلب |
| `start_ride(order_id, driver_telegram_id)` | يرفض ما ليس `matched` أو ليس للسائق |
| `complete_ride(order_id, driver_telegram_id)` | يرفض ما ليس `in_progress`. يعيد السائق متاحاً |
| `expire_stale_offers()` | إنهاء العروض المنتهية (مهمّة دورية) |
| `escalate_order(...)` | تصعيد طلب متعثّر إلى قروب التصعيد |

### الاشتراك والتوافر

| الدالّة | الغرض |
|---|---|
| `start_trial(...)` | تجربة مجانية عند التسجيل |
| `activate_subscription(...)` | تفعيل بعد تأكيد الدفع. `for update` |
| `expire_due_subscriptions()` · `record_subscription_warning(...)` · `subscriptions_expiring_soon()` | دورة الانتهاء والتحذير (مهامّ دورية) |
| `record_attendance(...)` (`on conflict`) · `deactivate_stale_availability()` | التوافر |

### الدعم والنزاعات

| الدالّة | الغرض |
|---|---|
| `open_support_ticket(telegram_id, type, message, file_id, order_id)` | فتح تذكرة. **`for update`** — انظر التحذير أدناه |
| `claim_support_ticket(...)` · `resolve_support_ticket(...)` | استلام وحسم |
| `attach_support_ticket_card(...)` · `get_support_ticket_context(...)` · `is_support_actor(...)` | مساندة |

> **`support_ticket_type` = `subscription` \| `ride_dispute` فقط.**
> **التهدئة 300 ثانية** لكل مستخدم (`support_ticket_cooldown_seconds`).
> القفل `for update` أُضيف في هجرة `20260810170000` لسدّ سباق TOCTOU مُثبَت.
> **لا تُزِله**: بلا القفل تفتح الطلبات المتوازية تذاكر متعدّدة (رُصد 4 حيث الحدّ 1).

### التقييم والسمعة

`submit_rating(order_id, rater_telegram_id, stars, comment)` (قيد فريد +
`unique_violation`) · `flag_rating(...)` · `recompute_rating_averages()` ·
`get_reputation_summary(...)`.

### غير المشتركين

`open_unsubscribed_cycle` · `register_unsubscribed_claim` ·
`advance_unsubscribed_negotiation` · `settle_unsubscribed_negotiation` ·
`close_unsubscribed_negotiation`.

### الإدارة والهوية

| الدالّة | ملاحظة |
|---|---|
| `issue_admin_login_code(...)` | **`for update`** — أُضيف في هجرة `20260810160000` لسدّ سباق مُثبَت. لا تُزِله |
| `consume_admin_login_code(...)` · `open_admin_session` · `touch_admin_session` · `close_admin_session` | الجلسات |
| `admin_set_driver_verification` · `admin_set_user_blocked` · `admin_update_setting` · `admin_update_city_group_ids` | إجراءات اللوحة |
| `grant_bootstrap_admin(...)` | يرقّي `BOOTSTRAP_ADMIN_TELEGRAM_ID` عند أوّل تسجيل |

### الإعدادات واللغة والقياس

`get_setting_number` · `get_user_language` · `set_user_language` ·
`get_order_languages` · `record_agent_outcome` (`on conflict`) · `set_updated_at`.

---

## 4) ما ليس موجوداً

لا `claim_delivery` ولا `renew_subscription` ولا `top_up_wallet` — كانت في
النسخة السابقة من هذا الملفّ ولم تُنفَّذ قطّ. لا محفظة ولا دفع داخل المنصّة:
الدفع خارجها، والتفعيل يدوي عبر لوحة الإدارة أو زرّ قروب الدعم.

**PostgREST مُغلَق:** لا وصول مباشر إلى الجداول من الخارج
(هجرتا `20260809000000` و`20260809001000`). كل تعامل عبر البوّابة أو الدوال أعلاه.
