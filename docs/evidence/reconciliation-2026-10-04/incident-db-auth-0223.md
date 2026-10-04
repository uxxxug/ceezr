# حادثةٌ مفتوحة — البوّابةُ لا تتّصلُ بالقاعدةِ منذ 2026-10-04 02:23 UTC

> فحصٌ قرائيٌّ فقط (03:28–03:40 UTC). لم يُعدَّل شيءٌ في Render ولا Supabase ولا Telegram ولا أيِّ سرّ.
> المنفِّذ: وكيل Perplexity Computer. **الحالة: مُغلَقةٌ 03:48 UTC** — انظر §«الإغلاق» في آخرِ الملفّ.

## الأثر

- `https://waslah-gateway.onrender.com/health` و`/ready`: **لا ردَّ خلالَ 60–90 ثانية** (03:30 و03:38 UTC).
- البوّابةُ تُعادُ كلَّ 10–20 دقيقةً (فحصُ `/ready` يُعيدُ 503 ← Render يُرسلُ `SIGTERM`):
  إقلاعاتٌ في 02:24 و02:40 و02:55 و03:00 و03:15 و03:20 UTC (سجلُّ `gateway.started` / `gateway.shutdown_starting`).
- كلُّ استعلامٍ يفشلُ بـ`(ECIRCUITBREAKER) too many authentication failures` — مُصرِّفُ تيليجرام
  (`telegram.drainer.claim_failed` كلَّ ثانية)، و`gateway.schema_not_applied`، و`worker.cities_failed`.
- العاملُ المضمَّنُ يقلعُ بـ**4 مهامَّ عامّةٍ فقط** بدلَ 71 (المدنُ لم تُقرأ). آخرُ نبضٍ في `job_heartbeats`: 02:24:05 UTC.
- آخرُ تحديثِ تيليجرام مسجَّلٍ في `telegram_update_receipts`: 22:52 UTC يومَ 2026-10-03.
  ما يصلُ بعدَ 02:23 لا يُعالَج؛ تيليجرام يعيدُ المحاولةَ مدّةً محدودةً ثمّ قد يُسقِطُ التحديثات (غيرُ مقيس).
- لا طلباتَ نشطةً متأثّرة: `orders` = 2 مكتمل + 1 ملغى، آخرُها 13:02 UTC يومَ 2026-10-03.

## السببُ الجذريّ (مرجَّحٌ بقوّةٍ بالأدلّة)

تغيّرت كلمةُ سرِّ الدورِ `postgres` في Supabase نحو 02:23 UTC، ولم يُحدَّث `DATABASE_URL` في Render.

| الوقت (UTC) | الحدث | المصدر |
|---|---|---|
| 02:16–02:21 | طلباتُ `mgmt-api` (صحّة، `network-bans/retrieve`) — فتحُ إعداداتِ القاعدةِ في لوحةِ Supabase | `edge_logs` |
| 02:23:03 | ضُبِطَ السرُّ `BACKUP_DATABASE_URL` في المستودَعِ الجديدِ `uxxxug/ceezr-backups` | `gh secret list` |
| 02:23:08 | Supavisor يُنهي اتّصالاتِ العملاءِ القائمة (`Terminate received from client`) | `supavisor_logs` |
| 02:23:12 | أوّلُ `password authentication failed for user "postgres"` من عنوانِ Render `74.220.51.162` | `supavisor_logs` |
| 02:23:48 | `Circuit breaker opened … operation=auth_error` | `supavisor_logs` |
| 02:24:07 | Render: `server_failed` — `HTTP health check failed with status code 503` | Render events |
| 02:26–02:29 | `nightly-backup` في `ceezr-backups` **ينجح** بالسرِّ الجديدِ ويكتبُ 5 صفوفٍ في `db_backups` | Actions run `37171053988` · `db_backups` |

نجاحُ النسخِ بالسرِّ الجديدِ بعدَ دقائقَ من فشلِ البوّابةِ بالقديمِ هو الدليلُ الحاسم. سجلُّ Postgres لا يُظهرُ
`ALTER ROLE` (كلماتُ السرِّ تُحجَبُ)، ف**أكّدَ المالكُ أنّه غيّرَها** (لتعبئةِ سرِّ النسخ).

القاعدةُ نفسُها سليمة: `ACTIVE_HEALTHY`، والاستعلامُ عبرَ واجهةِ الإدارةِ يعمل.

## الإصلاح (يحتاجُ المالك — سرّ)

1. Supabase ← Project Settings ← Database ← Connection string ← **Session pooler**، بكلمةِ السرِّ الحاليّة.
2. Render ← `waslah-gateway` ← Environment ← `DATABASE_URL` ← الصقِ الرابط ← Save and deploy.
3. التحقّق: `/ready` 200، وسجلُّ `embedded_worker.started` بـ`jobCount` 71 لا 4، ونبضاتٌ جديدةٌ في `job_heartbeats`.
   قاطعُ الدائرةِ في Supavisor يُغلَقُ وحدَه بعدَ دقائقَ من توقّفِ المحاولاتِ الفاشلة.

## ما كشفَتْه الحادثةُ أيضاً

- **المراقبةُ لم تُنبِّه:** `gateway-keep-alive.yml` آخرُ تشغيلٍ له 01:59 UTC (قبلَ العطل)، وجدولةُ GitHub متقطّعة،
  و`/health` لا يقرأُ القاعدة. لا تنبيهَ يصلُ المالكَ عندَ `server_failed`.
- **تصحيحٌ لـ`live-audit.md` (§3):** «`db_backups` = 0 صفّ» كان صحيحاً عندَ 22:45 UTC، وصارَ 5 صفوفٍ بعدَ 02:29 UTC.
  النسخُ يعملُ الآنَ من **مستودَعٍ منفصل** (`uxxxug/ceezr-backups`، GitHub Actions، مُشفَّرٌ بـ`age`، باستعادةٍ مُتحقَّقة،
  مُجدوَلٌ يوميّاً منذ الدمج 03:17 UTC) — **لا** عبرَ مهمّةِ العامل `backup-database` ولا إلى Google Drive.
- السرُّ `DATABASE_URL` في مستودَعِ `uxxxug/ceezr` (2026-09-30) صارَ قديماً أيضاً؛ لا workflow يقرؤه حاليّاً.

## الإغلاق — 2026-10-04 03:43–03:50 UTC

- بتفويضٍ صريحٍ من المالك حُدِّثَ `DATABASE_URL` وحدَه في `waslah-gateway` (دمجٌ لا استبدال، Session pooler)، فأطلقَ Render
  النشرَ `dep-db0smjou01pc73bpidlg` على `48207719` (رأسُ `main`) ← `live` في 03:44:35.
- `embedded_worker.started` بـ`jobCount` **71**؛ `/health` 200؛ `/ready` 200 (`degraded` مؤقّتاً بـ`critical_jobs_freshness`
  حتى يعيدَ الشوطُ التالي مهامَّ الفاصلِ الطويلِ التي أخفقَت أثناءَ العطل).
- 60 مهمّةً بنبضٍ خلالَ 3 دقائقَ كلُّها `ok`؛ لا إيصالَ تيليجرامَ مفتوح.
- قاطعُ دائرةِ Supavisor بقيَ مفتوحاً نحو دقيقتَين بعدَ النشر (المثيلُ القديمُ كانَ ما يزالُ يحاولُ بالسرِّ القديم)، ثمّ أُغلِق.
- **غيرُ مثبت:** هل أسقطَ تيليجرامُ تحديثاتٍ بينَ 02:23 و03:44 (يلزمُ `getWebhookInfo` بتوكنِ البوت). آخرُ تحديثٍ مسجَّل 22:52 UTC أمس.
- كلمةُ السرِّ الجديدةُ مرَّت عبرَ محادثةِ الوكيل؛ تدويرُها لاحقاً قرارُ المالك (يتطلّبُ تحديثَ Render و`ceezr-backups` معاً).
