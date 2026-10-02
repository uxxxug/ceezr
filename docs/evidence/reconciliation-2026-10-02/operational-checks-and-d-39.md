# فحوص تشغيلية محدودة + اكتشاف `D-39` — 2026-10-02

> زيادةٌ لا محو (`ح-8`). البيئةُ تجريبيّةٌ (Render + Supabase التجريبيّة)، ولا يُدَّعى منها شيءٌ إنتاجيٌّ (`ح-5`).
> رأسُ `main` وقتَ الفحص: `b862b127` · النشرُ الحيُّ: `b3705b4`.

## ١) خدمةُ الإدارة

| الفحص | النتيجة |
|---|---|
| `GET /admin` | 303 → `/admin/login` |
| `GET /admin/login` | 200 · CSP بـ`nonce` · `frame-ancestors 'none'` · `X-Frame-Options: DENY` |
| `POST /admin/login` برمزٍ خاطئ | 303 → `/admin/login` (لا دخول) |
| `/ready` | `status: ready` · `missingEnv: []` · `failedChecks: []` · `degradedChecks: []` |
| `job_heartbeats` | كلُّ المهامِّ الدوريّةِ لكلِّ مدينةٍ من المدنِ الخمسِ `ok` وآخرُ نبضةٍ خلالَ الدقيقةِ الأخيرة |

**اكتشافٌ (تباعدُ طوبولوجيا · لا يُعالَجُ هنا):** `render.yaml` يُعلِنُ ثلاثَ خدماتٍ تشغيليّةٍ
(`waslah-gateway` بـ`RUN_WORKER_IN_GATEWAY=false` و`RUN_ADMIN_IN_GATEWAY=false` · `waslah-worker` · `waslah-admin`)،
والحسابُ الفعليُّ على Render فيه البوّابةُ والتطبيقُ المصغَّرُ وحدَهما، وفي بيئةِ البوّابةِ
`RUN_WORKER_IN_GATEWAY=true` و`RUN_ADMIN_IN_GATEWAY=true`. فالعاملُ ولوحةُ الإدارةِ يعملانِ
داخلَ البوّابةِ (والنبضاتُ تُثبِتُ أنَّ المهامَّ تعملُ — لا `JOBS_ORPHANED` حيٌّ). وهذا عينُ الحدِّ
المُعلَنِ في `F5-04`/`F5-08`: الحاجزُ يحرسُ الملفَّ لا لوحةَ Render. إنشاءُ الخدمتَينِ قرارُ كلفةٍ
وبنيةٍ للمالكِ (`REQ-01`/`REQ-02` · `DEC-17`)، فلا يُنشَأُ شيءٌ ولا تُقلَبُ قيمةٌ.

## ٢) سجلُّ الهجراتِ الفعليُّ

| القياس | قبل | بعد |
|---|---|---|
| ملفّاتُ الهجرةِ في المستودع | 213 | 213 (+1 بهذا الفرع: `20261002100000`) |
| صفوفُ `supabase_migrations.schema_migrations` | 203 | 213 |
| في القاعدةِ وليس في المستودع | 0 | 0 |
| أسماءٌ غيرُ مطابِقة | 0 | 0 |
| فهارسُ غيرُ صالحة (`indisvalid = false`) | 0 | 0 |

عشرُ هجراتٍ كانت **مطبَّقةً فعلاً وغيرَ مسجَّلةٍ** في جدولِ التتبُّعِ. تُحقِّقَ من كلٍّ بأثرِه في المخطَّطِ
قبلَ تسجيلِه (لا بوجودِ الملفِّ):

| الهجرة | الشاهد في القاعدة |
|---|---|
| `20260806120000` core schema | `users` و`service_type` موجودان |
| `20260807100000` negotiation | `unsubscribed_negotiations` موجود |
| `20260810100000` group ids | `admin_update_city_group_ids` موجودة |
| `20260811150000` payment core | `payment_transactions` موجود |
| `20260814010000` subscription notices | `subscription_notices` موجود |
| `20260908030000` outbox broadcast | قيدُ `notification_outbox_kind_check` يحوي `broadcast` |
| `20260908050000` dead letter | العمود `notification_outbox.died_at` موجود |
| `20260909152000` causal head | الفهرس `notification_outbox_order_pending_idx` موجود |
| `20260926093000` trial upgrade | جسمُ `plan_upgrade_quote` يحوي فرعَ `trialing` بـ`payment_required: true` |
| `20260928080000` D-38 | جسمُ `persist_driver_location_batch` يُلحِقُ الأثرَ من `parsed` (ADR-0209) |

سُجِّلَت بـ`version` و`name` فقط (لا إعادةَ تطبيق). والسببُ أنَّ `supabase db push` كانَ سيُعيدُ تطبيقَها،
و`20260814010000` فيها `create type` بلا `if not exists` فيسقط. والمستودعُ نفسُه لا يقرأُ هذا الجدول
(`scripts/migrate.ts` يُطبِّقُ بـ`--from`).

## ٣) Telegram Bot API (قراءةٌ فقط · لا رسالةَ أُرسِلَت)

| الفحص | `@ODD_D_BOT` (السائق) | `@ODD_R_BOT` (الراكب) |
|---|---|---|
| `getMe` | ok | ok |
| webhook | `/webhook/telegram/driver` | `/webhook/telegram/rider` |
| `pending_update_count` / `last_error` | 0 / لا يوجد | 0 / لا يوجد |
| `max_connections` | 40 | 40 |
| `allowed_updates` | message · edited_message · inline_query · callback_query · my_chat_member · chat_member · chat_join_request | الشيءُ نفسُه |
| الأوامر | مضبوطةٌ بالعربيّة (`start` · `app` · `rating` · `area` · `city` · `language` …) | مضبوطةٌ (`start` · `app` · `delivery` · `city` · `rating` · `language` …) |
| زرُّ القائمة | `web_app` → `https://waslah-miniapp.onrender.com/` | الشيءُ نفسُه |
| `description` / `short_description` | فارغان | فارغان |
| ويبهوكٌ بلا سرٍّ / بسرٍّ خاطئ | 401 / 401 | 401 / 401 |
| `telegram_update_jobs` | 59 `done` · 0 عالقة | — |

الوصفانِ الفارغانِ نصٌّ تسويقيٌّ للمالكِ، لا يُكتَبانِ هنا.

## ٤) اكتشافُ `D-39` — حجزُ استغاثةٍ متروكٌ يعلَقُ في `sending` إلى الأبد

**الشاهدُ الحيُّ** (`notification_outbox` على البيئةِ التجريبيّة):

| id | kind | status | attempts | claimed_at |
|---|---|---|---|---|
| `388397b5…` | `safety_incident` | `sending` | 26 | 2026-09-30 03:06:46 UTC — **لم يتحرّكْ منذُ يومَين** |
| `e6ac09ce…` | `safety_incident` | `pending` | 171 | يُعادُ كلَّ 30 ثانية |

**الجذر:** `claim_safety_incident_delivery` تلتقطُ `pending` وحدَه، و`finish_safety_incident_delivery`
لا تمسُّ إلّا صفّاً بحجزِه الحيِّ. فعاملٌ حجزَ ثمَّ ماتَ قبلَ `finish` (إعادةُ نشرٍ · `SIGKILL`) تركَ
البطاقةَ `sending` بلا مخرج. وأصنافُ الرحلةِ (`claim_notification_delivery`) والبثُّ وإشعاراتُ الاشتراكِ
(`20260814040000`) تستردُّ حجوزَها المتروكةَ داخلَ المطالبةِ نفسِها؛ والاستغاثةُ وحدَها بلا استرداد.

**العلاج:** `supabase/migrations/20261002100000_d_39_sos_outbox_reclaim_abandoned_claims.sql` — `create or replace`
بالتوقيعِ والمُخرَجِ نفسَيهما، واستردادٌ قبلَ المسحِ بالإعدادِ نفسِه الذي يحكمُ الصندوقَ
(`notification_claim_timeout_seconds` · افتراضُ 300 كشقيقتِها) — لا إعدادٌ ثانٍ بالمعنى نفسِه.

**القياس (PostgreSQL 18.6 + PostGIS محلّيّاً · 214 هجرةً بـ`scripts/migrate.ts`):**

| | قبل العلاج | بعده |
|---|---|---|
| `safety-sos.test.ts` | 12 نجاحاً · **1 فشلٌ** (`claimed` = 0 بعدَ المهلة) | **13 نجاحاً · 0 فشل** |
| الضابطُ: حجزٌ حيٌّ داخلَ مهلتِه | لا يُنتزَع | لا يُنتزَع |
| بعدَ المهلة | يبقى `sending` | `delivered` · `attempts = 2` · `claim_token = null` |
| المُسلَّمُ لا يُستردُّ ثانية | — | ✓ |

كاملُ الوحدات: 6601 نجاحاً · 0 فشل. `biome@2.5.7` (المثبَّتُ في `bun.lock`) نظيف · `typecheck` نظيف ·
`check-migration-safety` (214) · `check-migrations` · `check-schema-contract` · `check-rollback-safety` ·
`check-skip-classification` · `check-migration-applier` · `check-integration-city-precondition` نجاح.
تمرينُ مسارِ العودةِ محلّيّاً على PG18 يُخفِقُ في `20260922090000` بقيدِ `users_telegram_id_not_null` —
اسمُ قيدِ NOT NULL ظاهرةٌ في PG18 وحدَه، وCI على `postgis/postgis:17-3.5`؛ فحكمُ CI هو المرجع.

**الصفُّ `pending` ذو 171 محاولة ليسَ عيبَ شِفرة:** معرِّفاتُ قروباتِ التصعيدِ في المدنِ الخمسِ قيمٌ نائبةٌ
(`-1001000000002` … `-1001000000014`) فلا قروبَ حقيقيٌّ يستقبلُ البطاقة؛ وإعادةُ المحاولةِ بلا سقفٍ
مقصودةٌ (`deliver-safety-incident.ts`: «لا يجوز إسقاط نداء استغاثة بعد رقم اعتباطي من المحاولات»).
ضبطُ القروباتِ الحقيقيّةِ تبعيّةُ مالكٍ/CORE، فلا يُكتَبُ معرِّفٌ مُخترَعٌ.

**بعدَ الدمجِ والنشر** يستردُّ الصفُّ `388397b5…` تلقائيّاً بالمطالبةِ التالية (لا تعديلَ يدويٌّ للبيانات)،
ويلحقُ بأخيه `pending` حتى تُضبطَ القروبات.

## ٥) بعدَ الدمجِ والنشر — زيادةٌ (2026-10-02)

| العنصر | القيمة |
|---|---|
| الدمج | PR #379 squash → `main`@`c0299486`. وقتَ الأمرِ كانت وظيفةُ PostgreSQL على رأسِ الفرعِ الوثائقيِّ `37f576b7` ما تزالُ تعمل؛ واكتملَت **خضراءَ** (`37010655745`)، ورأسُ الشِفرةِ `5b58608c` كانَ أخضرَ بالثماني (`37009318008`) قبلَها. يُسجَّلُ كما وقع. |
| الهجرةُ على Supabase التجريبيّة | `scripts/migrate.ts --from 20261001311000` → `20261002100000` طُبِّقَت (2241ms)، وسُجِّلَت في `schema_migrations` (214 صفّاً = 214 ملفّاً). جسمُ `claim_safety_incident_delivery` الحيُّ يحوي فرعَ `D-39`. |
| Render | البوّابة `dep-davqpnnlk1mc73c6qqc0` · التطبيقُ المصغَّر `dep-davqpnm0tbcc73f192tg` — كلاهما `live` على `c0299486`. `/ready` = `ready` بلا فحصٍ فاشلٍ ولا متدهوِر. |
| **الصفُّ العالقُ `388397b5…`** | `sending` منذُ 2026-09-30 03:06 → **`pending`** عندَ أوّلِ مطالبةٍ بعدَ النشرِ (13:09:43 UTC) · `attempts` 26 → 27 · ثمَّ يُعادُ كلَّ ~30 ثانيةً مع أخيه ويفشلُ النشرُ لأنَّ القروبَ نائبٌ (`claimed=2 failed=2`). **لا تعديلَ يدويٌّ للبيانات.** |

### اكتشافٌ تشغيليٌّ: خطّةُ Render المجانيّةُ تُنيمُ البوّابةَ ومعَها العامل

`render.yaml` يُعلِنُ `plan: starter`، والخدمةُ الحيّةُ `waslah-gateway` على **`free`**. سجلُّ Render يُظهِرُ
`gateway.shutdown_starting` بـ`SIGTERM` في 12:55:24 UTC ثمَّ `runner.stopped`، ولا عمليّةَ حتى النشرِ التالي
في 13:08:46 — نحوَ **14 دقيقةً بلا أيِّ مهمّةٍ دوريّةٍ** (لا تسليمَ استغاثةٍ ولا انتهاءَ عروضٍ ولا اشتراكات).
والسببُ إنامةُ الخطّةِ المجانيّةِ بعدَ خمولِ HTTP، ولأنَّ `RUN_WORKER_IN_GATEWAY=true` فالعاملُ ينامُ معَ البوّابة.
والإصلاحُ قرارُ كلفةٍ للمالك: رفعُ الخطّةِ إلى `starter` كما يُعلِنُ المانيفست، أو خدمةُ `waslah-worker` مستقلّةٌ
(`REQ-01`/`REQ-02` · `DEC-17`). فلا يُغيَّرُ شيءٌ هنا، ولا يُدَّعى توفّرٌ للعاملِ على هذه البيئة.

| CI على `main`@`c0299486` | CI `37011011986` **success** (الوظائفُ السبعُ) · Roadmap freshness `37011011994` **success** |
