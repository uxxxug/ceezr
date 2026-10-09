# PRD-102 — اختبار Redis الوظيفي في الإنتاج (2026-10-09)

**الحالة:** Verified. **المصدر:** طلبات حيّة إلى `waslah-gateway.onrender.com` من بيئة الوكيل، واستعلامات Supabase للقراءة فقط (أعداد مجمّعة، بلا بيانات مستخدمين). الإنتاج على `e3d741be`.
**ما لا يحتويه:** لا أسرار، ولا معرّفات مستخدمين، ولا قيم `sid` (مُخفاة).

| الشرط | ما نُفّذ فعلًا | النتيجة |
|---|---|---|
| الجلسات على Redis | `SESSION_STORE=redis` في `render.yaml`؛ الإقلاع يرفض `memory` في الإنتاج (`SESSION_STORE_MEMORY_IN_PRODUCTION`). سجل `session.store_selected store=redis` وجلسة حوار البوت `GET`/`SET EX` موثّقان حيًّا في `PRD-001-redis-healthy-20261008.md` §2 و§4ب و`PRD-008-telegram-smoke-20261008.md`. `/ready` الآن: `ready`، `degradedChecks: []` (يشمل فحص `redis`) | ناجح |
| حدّ المعدّل | 2026-10-09 13:17:57–13:18:07 UTC: 32 طلب `POST /v1/session/telegram` بـ initData غير صالح (الحدّ 30/60ث لكل عنوان، `policy.ts`) ⇒ 30 × `400` ثم `429`؛ وطلب إضافي ⇒ `429` مع `retry-after: 50` وجسم `{"ok":false,"error":"RATE_LIMITED"}` | ناجح |
| Socket.IO | 13:24:55 UTC: `GET /socket.io/?EIO=4&transport=polling` ⇒ `200` بحزمة فتح (`upgrades:["websocket"]`، `pingInterval 25000`)؛ واتصال `wss://…/socket.io/?EIO=4&transport=websocket` ⇒ حزمة فتح `0`، ثم `40` للمساحة الافتراضية ⇒ ردّ `40{"sid":…}` | ناجح |
| المهام المجدولة | `job_heartbeats` ≈13:17 UTC: 71 مهمة مختلفة، كلها `last_status=ok`، 56 منها نبضت خلال 15 دقيقة، و71 خلال 24 ساعة (البقية جداولها أطول) | ناجح |

**حدود الدليل:** الخدمة عملية واحدة (`PROCESS_TOPOLOGY=single-process`)، فلا يُميَّز خارجيًّا مخزن Redis من الذاكرة لحدّ المعدّل؛ الدليل على Redis هو اختيار المخزن عند الإقلاع وفحص `/ready` السليم وغياب `rate_limit.redis_failed` من مسار الفشل (تسجيلات Render غير متاحة للوكيل اليوم). اختبار multi-instance خارج النطاق ما دامت الطوبولوجيا عملية واحدة.
