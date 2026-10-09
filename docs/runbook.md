# دليل التشغيل (Runbook)

> **الحالة الحالية**: البوابة تعمل فعلاً على قاعدة PostgreSQL، والمسار الكامل (تسجيل ← طلب ← بثّ عرض
> ← قبول ذرّي) مُختبَر آلياً على قاعدة محلية. المتبقي للإنتاج: مفاتيح Supabase وUpstash ورمزا البوتين.
>
> **تحديث الحاجز (2026-09-21):** أُغلقت جميعُ بنودِ دَينِ المنتَجِ القابلةِ للتنفيذِ. ما يبقى عشرةُ بنودٍ `[!]` قراراتُ مالكٍ، وبنودُ إثباتٍ تقنيٍّ تتطلَّبُ بنيةً تحتيّةً حقيقيّةً (staging · multi-instance · load testing). الحاجزُ موثَّقٌ في `ROADMAP.md` (الالتزامُ `b626538`) والتقريرُ الموحَّدُ في `docs/audits/09-final-unified-audit-20260921.md`.

## التشغيل المحلي
```bash
bun install
bun run lint        # Biome
bun run typecheck   # tsc --noEmit
bun run test        # اختبارات الوحدة
```

## قاعدة PostgreSQL محلية للتطوير والاختبار
لا تحتاج أي مفتاح إنتاج. أي PostgreSQL 15+ مع PostGIS يكفي:

```bash
# 1) قاعدة فارغة
createdb waslah

# 2) الأدوار التي تفترضها الهجرات (تُنشئها Supabase تلقائياً، وننشئها نحن محلياً)
psql waslah -c "create role anon nologin noinherit;
                create role authenticated nologin noinherit;
                create role service_role nologin noinherit bypassrls;"

# 3) الهجرات بالترتيب
for f in supabase/migrations/*.sql; do psql waslah -v ON_ERROR_STOP=1 -f "$f"; done

# 4) اختبارات التكامل الحقيقية
TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/waslah" bun run test:integration
```

بلا `TEST_DATABASE_URL` تُتخطّى اختبارات التكامل مع تحذير ظاهر، و CI يرفض التخطّي صراحةً.

> بيئة الاختبار المحلية ليست بديلاً عن Supabase: RLS مفعَّلة في المخطط، والاختبارات تعمل بدور
> superuser محلي يتجاوزها. التحقّق من سياسات RLS نفسها يبقى على مشروع Supabase الحقيقي.

## متغيرات البيئة
انسخ `.env.example` إلى `.env` واملأ القيم. أي متغير ناقص يفشل الإقلاع فوراً عبر `MissingEnvVarError`.

## النشر
- البداية: **Render** (فوترة شهرية ثابتة) — خدمتان: `gateway` و `workers`.
- لاحقاً عند الحاجة الفعلية: **Fly.io — منطقة Bahrain**.

> **تصحيح 2026-10-04 (`ح-8`):** السطرُ أعلاه خطّةٌ أولى. الحيُّ اليومَ: `waslah-gateway` (Docker، `free`، فرانكفورت،
> `autoDeploy: false`، يستضيفُ العاملَ ولوحةَ الإدارة) و`waslah-miniapp` (ساكن). لا خدمةَ `workers` منفصلة.
> القاعدةُ Supabase `jafuchojgxzeuvibkkfx`، وRedis على Upstash. الدليل: `docs/evidence/reconciliation-2026-10-04/claims-audit.md`.

## التنبيهُ والمراقبة (`OPS-ALERT-01`)
- مراقبُ Supabase (`deploy/watchdog/`) يفحصُ `/ready` كلَّ دقيقة. «متوقّفة» بعدَ فحصَين فاشلَين: Telegram كلَّ دقيقةٍ والبريدُ كلَّ 10 دقائق
  حتى العودة؛ ونبضةٌ يوميّةٌ 09:00 بتوقيتِ الرياض. **غيابُ النبضةِ اليوميّةِ يعني أنّ المراقبَ نفسَه معطَّل.**
- الحالةُ: `select * from ops.watchdog_state;` · السجلّ: `select * from ops.watchdog_events order by id desc limit 20;`
- إيقافٌ مؤقّتٌ أثناءَ صيانةٍ مقصودة: `update ops.watchdog_config set enabled = false;` — **وأعِدْه `true` بعدَها.**
- المستلِمونَ في `ops.watchdog_config` لا في المستودَع (عامّ). الأسرارُ في Vault.

## الأهداف: RTO/RPO (`PRD-103` · 2026-10-09)
| العملية | RPO | RTO المستهدف | المرجع | المقيس |
|---|---|---|---|---|
| تعطّل البوابة أو `/ready` متدهور | — | 30 دقيقة | §التنبيه، §هجرة سيئة أو نشر فاشل | المراقب ينبّه بعد فحصين (دقيقتان) |
| نشر فاشل | — | 30 دقيقة (إعادة النشر السابق من Render) | §هجرة سيئة أو نشر فاشل | — |
| تدوير كلمة سر القاعدة | — | 15 دقيقة | §تدوير كلمة سر القاعدة | — |
| فقد القاعدة أو تلفها | 24 ساعة (نسخة ليلية 00:17 UTC) | 4 ساعات (مشروع جديد + `ceezr-backups/docs/RESTORE.md` + توجيه `DATABASE_URL`) | §الاستعادة والتعافي | استعادة آلية للنسخة ≈1 ث، الاسترجاع المشفّر غير مقيس (`PRD-104`) |
| ملفات Storage | غير محمية (لا نسخ) | — | `ceezr-backups/README.md` | — |

المناوبة: المالك وحده مستلم تنبيهات Telegram والبريد (`ops.watchdog_config`). الدليل: `docs/evidence/production/PRD-103-ops-20261009.md`.

## تدويرُ كلمةِ سرِّ القاعدة (درسُ حادثةِ 2026-10-04 02:23 UTC)
كلمةُ سرِّ الدورِ `postgres` يقرؤها **مكانان**؛ تغييرُها في Supabase وحدَه يقطعُ البوّابةَ فوراً
(`password authentication failed` ثمّ قاطعُ دائرةِ Supavisor، و`/ready` 503، وRender يُعيدُ الخدمةَ كلَّ 10–20 دقيقة):
1. Render ← `waslah-gateway` ← Environment ← `DATABASE_URL` (Session pooler) ← Save and deploy.
2. `uxxxug/ceezr-backups` ← Settings ← Secrets ← `BACKUP_DATABASE_URL`.

بالترتيب: غيّرْ الكلمةَ ← حدِّثْ الموضعَين خلالَ دقائق ← تحقّقْ: `/ready` 200، وسجلُّ `embedded_worker.started` بـ`jobCount` 71
(لا 4)، ونبضاتٌ جديدةٌ في `job_heartbeats`. قاطعُ الدائرةِ يُغلَقُ وحدَه بعدَ توقّفِ المحاولاتِ الفاشلة (نحو دقيقتَين).

## النسخُ الاحتياطيّ
يجري من المستودَعِ الخاصِّ `uxxxug/ceezr-backups` (GitHub Actions، `nightly-backup` يوميّاً 00:17 UTC، مُشفَّرٌ بـ`age`،
باستعادةٍ مُتحقَّقة) ويكتبُ صفّاً في `db_backups`. مهمّةُ العاملِ `backup-database` **غيرُ مسجَّلة** (تُسقَطُ بصمتٍ لغيابِ
مخزنِها) — لا تعتمدْ عليها.

## الاستعادة والتعافي
> أوقف العامل والبوابة أولاً عند تلف بيانات أو فشل قاعدة، ولا تطبق استعادة على قاعدة
> حية. عيّن `DATABASE_URL` في جلسة التشغيل فقط؛ لا تضعه في الأوامر المحفوظة.

### تمرين استعادة دوري
```bash
export PATH="$HOME/.bun/bin:/tmp/pg/bin:$PATH"
export DATABASE_URL='postgres://USER@HOST:PORT/waslah'
bun scripts/backup-restore-drill.ts
psql "$DATABASE_URL" -c "select backup_run_id,restore_verification_status,restore_verification_detail from db_backups order by created_at desc limit 5"
```
ينشئ الأمر `waslah_drill` ويستعيد إليه أرشيف `pg_dump` ومرافق الأدوار، ثم يقارن عدد
الجداول والدوال وسياسات RLS والقيود والفهارس وصفوف كل جداول البيانات (عدا سجل التدقيق
الذي يتغير أثناء التحقق). لا تعد نسخة صالحة إلا إذا كانت `restore_verification_status=verified`.

### فشل قاعدة أو تلف بيانات
```bash
export BACKUP_FILE='/path/to/wasalah-backup-YYYY-MM-DD.dump'
export ROLE_FILE='/path/to/wasalah-backup-YYYY-MM-DD.roles.sql'
dropdb --force waslah_failed
createdb -T template0 waslah_failed
pg_restore --exit-on-error --no-owner -d waslah_failed "$BACKUP_FILE"
psql waslah_failed -c "select count(*) from users"
```
بدّل اتصال البوابة والعامل إلى `waslah_failed` بعد تحقق العدّ والتشغيل الصحي، ثم أعد
تسميتها في نافذة الصيانة. لاستعادة الأدوار على **خادم جديد فقط** راجع الملف أولاً ثم طبق
`psql -d postgres -v ON_ERROR_STOP=1 -f "$ROLE_FILE"`؛ مرافق الأدوار لا يحمل كلمات مرور.

### هجرة سيئة أو نشر فاشل
```bash
# نشر فاشل: أعد صورة الإصدار السابق ثم تحقق
render rollback SERVICE_ID DEPLOY_ID
curl -fsS https://SERVICE/health && curl -fsS https://SERVICE/ready

# هجرة سيئة: أوقف الكتابة، استعد آخر أرشيف متحقق إلى قاعدة جديدة كما أعلاه،
# ثم وجّه DATABASE_URL إليها وأعد نشر الإصدار السابق.
```
لا تحاول عكس هجرة مدمرة على القاعدة المتضررة؛ احتفظ بها للطب الشرعي حتى يثبت عمل
البديل. بعد عودة الخدمة شغّل تمرين الاستعادة أعلاه وسجّل النتيجة في `db_backups`.

## إجراءات متوقعة في الأمر الثاني
| الحالة | الإجراء |
|---|---|
| تغيير سعر اشتراك | تحديث صف في `platform_settings` — **لا نشر كود** |
| تغيير مهلة قبول العرض | تحديث `offer_timeout_seconds` في `platform_settings` |
| إضافة مدينة (بأمر لاحق) | صف في `cities` + ثلاثة معرّفات قروبات تيليجرام |
| طلب فشلت مطابقته نهائياً | يُنشر تلقائياً في قروب الإسناد للمدينة |
| بلاغ SOS | قروب الإسناد فوراً، بغض النظر عن سير المطابقة |
