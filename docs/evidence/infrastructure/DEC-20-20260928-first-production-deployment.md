# دليلُ أوّلِ نشرٍ إنتاجيٍّ — `DEC-20` (2026-09-28)

المرجع: `docs/decisions/DEC-20-20260928-production-environment.md`. هذا الملف **سجلُّ ما فُعِلَ وما رُئيَ**، ولا يدّعي قياساً إنتاجيّاً (`ح-5`): لا حملَ ولا زمنَ استجابةٍ ولا توافرَ مُقاسٌ هنا.

## ١) إذنُ المالكِ — بنصِّه

- «اعتمد كل شي واستخدم كل شي كبيئة حقيقيه ليست تجريبيه ابدء».
- «اخي لايوجد مستخدمين، استخدم قاعدة البيانات، قم بإنشاء ونشر على راندر استخدم البوتات، لا تتوقف لاي سبب».
- وعلى سؤالِ «هل تأذنُ بحذفِ كلِّ محتوى القاعدةِ وإعادةِ بنائها من الهجراتِ من الصفرِ؟» أجابَ: «نعم، احذف وأعد البناء». ومعرِّفُ المشرفِ الأوّلِ منه: `8634283336`.

## ٢) القاعدةُ — لماذا أُعيدَ بناؤها وكيف

**ما وُجِدَ (قراءةٌ قبلَ الفعلِ):** القاعدةُ كانت مُستعمَلةً في قياسِ التكاملِ المحلّيِّ حتّى 2026-09-28، فحملت بقاياه: ثلاثُ مدنٍ وهميّةٍ (`smk…` ×2 · `sd12`) · جدّةُ **مُفعَّلةٌ** برقمِ مجموعةِ دعمٍ وهميٍّ (`-1001`) · مستخدمٌ وسائقٌ وهميّانِ · و`platform_settings` بـ80 مفتاحاً لكلِّ مدينةٍ من 88 تزرعُها الهجراتُ. **والأثرُ المرئيُّ:** أوّلُ إقلاعٍ للبوّابةِ أعلنَ `/ready` بحالِ `degraded`، ومهمّةُ `deliver-subscription-notices` تسقطُ كلَّ ~20 ثانيةً بـ`MISSING_SETTING:subscription_notice_batch_limit`. وسجلُّ `supabase_migrations.schema_migrations` لم يكنْ مرجعاً صالحاً (يُسقِطُ حتّى هجرةَ المخطَّطِ الأساسيِّ القائمةِ).

**لماذا إعادةُ البناءِ لا الترقيعُ:** إكمالُ المفاتيحِ الناقصةِ يُبقي مدناً وهميّةً وتفعيلاً وهميّاً في قاعدةِ إنتاجٍ، ولا يُثبِتُ أنَّ ما بقيَ يطابقُ السلسلةَ. والسلسلةُ نفسُها تصلحُ لقاعدةٍ فارغةٍ (`scripts/migrate.ts` بلا `--from`).

**ما فُعِلَ بالترتيب:**

1. إيقافُ البوّابةِ مؤقّتاً (`suspend`) كي لا تكتبَ أثناءَ الإعادةِ.
2. `drop schema public cascade` ثمَّ `create schema public` بمنحِ Supabase المعتادةِ (`postgres` · `anon` · `authenticated` · `service_role`). ولم يُمَسَّ غيرُ `public` (`auth` · `storage` · `extensions` · `vault` باقيةٌ).
3. `bun run scripts/migrate.ts` — طبّقَ 85 هجرةً ثمَّ توقّفَ عندَ `20260909130000_f6_06_queue_backpressure_events_index.sql` بـ`canceling statement due to lock timeout` (مهلةُ القفلِ 3s — الحارسُ عملَ كما صُمِّمَ). **والسببُ الجذريُّ للأثرِ الباقي:** `create index concurrently` الساقطُ يتركُ فهرساً `INVALID`، و`if not exists` في الإعادةِ كانَ سيتخطّاه فيبقى فهرسٌ غيرُ صالحٍ صامتاً. فحُذِفَ (`drop index concurrently if exists queue_backpressure_events_recent_idx`) ثمَّ أُعيدَ من `--from 20260909120000` فطبّقَ الـ117 الباقيةَ. **المجموعُ 202 = عددُ ملفّاتِ السلسلةِ.**
4. التحقّقُ بعدَها: 0 فهرسٍ غيرِ صالحٍ · 79 جدولاً في `public` · خمسُ مدنٍ فقط (`JED` · `MED` · `MKK` · `RUH` · `TIF`) **كلُّها غيرُ مُفعَّلةٍ** وبلا مجموعةِ دعمٍ · `platform_settings` = 440 صفّاً (88 مفتاحاً × 5) · `subscription_notice_batch_limit` حاضرٌ للخمسِ · 0 مستخدمٍ.

## ٣) Render — ما أُنشئَ

| الخدمةُ | المعرِّفُ | العنوانُ | الخطّةُ |
|---|---|---|---|
| `waslah-gateway` (Docker · `docker/Dockerfile.gateway` · فحصُ `/ready`) | `srv-dat37gou01pc739pgnc0` | https://waslah-gateway.onrender.com | `free` |
| `waslah-miniapp` (ساكنٌ · `apps/miniapp/dist`) | `srv-dat383bncjis73cukcpg` | https://waslah-miniapp.onrender.com | مجّانيٌّ |

- **خطّةُ `starter` رُفِضَت**: `HTTP 402 — Payment information is required` (لا بطاقةَ في المساحةِ). فنُشِرَت البوّابةُ على `free` **بالعاملِ ولوحةِ الإدارةِ داخلَها** (`RUN_WORKER_IN_GATEWAY=true` · `RUN_ADMIN_IN_GATEWAY=true`) — وهو شكلٌ يقبلُه الضبطُ في الإنتاجِ صراحةً (`F5-04` · `ADR 0063`). و`waslah-worker` و`waslah-admin` **لم تُنشآ** — العاملُ لا خطّةَ مجّانيّةَ له.
- **دَينٌ مُعلَنٌ لهذا الشكلِ:** الخدمةُ المجّانيّةُ تنامُ بعدَ خمولٍ؛ والمهامُّ الدوريّةُ تتوقّفُ ما دامت نائمةً، وأوّلُ تحديثٍ بعدَ النومِ يوقظُها ببطءٍ. والعلاجُ بيدِ المالكِ: بطاقةٌ في Render ثمَّ رفعُ البوّابةِ إلى `starter` وإنشاءُ الخدمتَينِ كما في `render.yaml`.
- `DEC-14` نافذٌ: `numInstances: 1`.
- `SUPABASE_SERVICE_ROLE_KEY` مضبوطٌ بقيمةٍ دالّةٍ `unused-at-runtime-see-DEC-20`: الضبطُ يشترطُ حضورَه، و**لا شيفرةَ تشغيلٍ تقرؤه** (`rg supabaseServiceKey apps packages` خارجَ `config/index.ts` = لا شيءَ). يُستبدَلُ بالمفتاحِ الحقيقيِّ متى قدّمَه المالكُ.
- الأسرارُ المولَّدةُ (`TELEGRAM_WEBHOOK_SECRET` · `MINIAPP_SESSION_SECRET` · `METRICS_TOKEN` · `CORE_INBOUND_SIGNING_SECRET`) بـ`openssl rand -hex` — في Render وحدَه، لا في المستودعِ.

## ٤) عيبانِ في المستودعِ كشفَهما النشرُ الحقيقيُّ — وأُصلِحا من جذرِهما

1. **أمرُ بناءِ التطبيقِ المصغَّرِ** (`render.yaml` و`deploy/staging/render.staging.yaml`): `npm install -g bun@1.4.2` أسقطَ أوّلَ بناءٍ (`ENOENT: mkdir '/usr/lib/node_modules/bun'`). صارَ `bun install --frozen-lockfile && bun run build:miniapp` مع `BUN_VERSION=1.4.2` (آليةُ Render للتثبيتِ) — والقصدُ الأصليُّ (إصدارٌ مثبَّتٌ لا عائمٌ) باقٍ. و`BUN_VERSION` أُضيفَ إلى `READ_BY_PLATFORM_NOT_CODE` في `scripts/check-env-drift.ts` بسببٍ مكتوبٍ.
2. **التطبيقُ على أصلٍ والبوّابةُ على آخرَ بلا CORS لـ`/v1`**: لو خُبِزَ `VITE_WASLAH_API_BASE` بعنوانِ البوّابةِ لحجبَ المتصفّحُ كلَّ نداءٍ. فأُضيفَت إعادةُ كتابةٍ في Render (`/v1/*` · `/socket.io/*` · `/health` → البوّابة) قبلَ احتياطِ `/*`، و`VITE_WASLAH_API_BASE` فارغٌ = «نفسُ الأصلِ» كما يقصدُ `client.ts`. **ورُئيَ**: `GET https://waslah-miniapp.onrender.com/health` → `200 {"status":"ok"}` من البوّابةِ.

## ٥) تيليجرام

- `setWebhook` للبوتَينِ: `…/webhook/telegram/driver` و`…/webhook/telegram/rider` بسرٍّ واحدٍ، و`allowed_updates` تشملُ `chat_join_request` (شرطُ `ROADMAP-PRODUCT-DEBT.md` لـ`PD-001`). `getWebhookInfo`: `pending_update_count: 0` · بلا `last_error_message`.
- **فحصٌ سالبٌ (`ح-7`)**: `POST /webhook/telegram/rider` بسرٍّ خاطئٍ → `401`.
- زرُّ القائمةِ في البوتَينِ (`setChatMenuButton` · `web_app`) → https://waslah-miniapp.onrender.com/

## ٦) ما رُئيَ بعدَ النشرِ

- `GET /ready` → `200 {"status":"ready","missingEnv":[],"failedChecks":[],"degradedChecks":[]}` (بعدَ إعادةِ البناءِ؛ وقبلَها `degraded` كما في §٢).
- رؤوسُ التطبيقِ المصغَّرِ: `content-security-policy: frame-ancestors https://telegram.org https://*.telegram.org` · `x-content-type-options: nosniff`. **وهذا أوّلُ قياسٍ لرأسِ `F1-10` من مضيفٍ حقيقيٍّ** — يُسجَّلُ رؤيةً، وإغلاقُ البندِ بشروطِ `ح-4` لا بهذا السطرِ.
- سجلُّ الأخطاءِ بعدَ الإعادةِ: لا خطأَ جديدٌ إلّا `move_event_outbox.shipper_not_configured` (`CORE_EVENTS_*` غيرُ مضبوطةٍ — حاجزُ `O-6` الخارجيُّ كما هوَ، لم يُحوَّلْ).

## ٧) ما يبقى — ولا يُدَّعى

- **لا مدينةَ مُفعَّلةٌ**: الطلبُ لا يبدأُ حتّى يُفعِّلَ المشرفُ مدينةً من اللوحةِ (تفعيلُ المدينةِ قرارُ تشغيلٍ بشروطِه، لا يُنتحَلُ هنا).
- المشرفُ الأوّلُ (`8634283336`) يُمنَحُ دورَه عندَ أوّلِ تفاعلٍ له مع بوتِ السائقينَ (`grant_bootstrap_admin` · `ADR 0008`).
- لا أوّلَ `/start` حقيقيٌّ مُسجَّلٌ بعدُ في هذا الملفِّ.
- `F10-*` · `F11-*` · `REQ-01`/`REQ-02` بمعناهما (بيئةٌ شبيهةٌ منفصلةٌ) — باقيةٌ على حاجزِها.
