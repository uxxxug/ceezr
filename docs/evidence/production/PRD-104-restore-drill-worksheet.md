# PRD-104 — ورقةُ تمرينِ الاستعادةِ وفكِّ التشفير (للمالك)

**الحالة:** مُعَدّة، **غيرُ منفَّذة** — PRD-104 يبقى Blocked حتّى ينجحَ التمرين. المفتاحُ الخاصُّ لـ`age` يبقى على جهازِك؛ لا يُرسَلُ في محادثةٍ ولا يُرفَعُ إلى GitHub.
**الدليلُ المرجعيّ:** `uxxxug/ceezr-backups` → `docs/RESTORE.md` §0–§4. **RTO المعلَن:** 4 ساعات (`docs/runbook.md`).

| # | الخطوة (RESTORE.md) | وقتُ البدء UTC | وقتُ الانتهاء UTC | النتيجة |
|---|---|---|---|---|
| 0 | الأدوات: `age --version` ≥ 1.1 · `pg_restore --version` يبدأ بـ17 | | | |
| 1 | تنزيلُ Artifact أحدثِ تشغيلٍ ناجحٍ لـ`nightly-backup` (رقمُ التشغيل: ____؛ المرشَّحُ المفحوصُ 2026-10-10: `38009927769`، ينتهي 2026-11-09) | | | |
| 1.4 | `sha256sum wasla-backup-*.tar.age` = `db_backups.restore_verification_detail->'encrypted'->>'sha256'` (لتشغيل `38009927769`: `f2f8bcf19ed08c19e461702aa1027565007ef67d5d968c9e947bed25ea081ecf`) | | | مطابق ☐ |
| 2 | `age -d -i <المفتاح> … \| tar -C restore -xf -` — تظهرُ الملفّاتُ السبعة | | | ☐ |
| 3 | قاعدةٌ هدفٌ **جديدةٌ فارغة** (الخيار ب المحلّيّ مقبولٌ للتمرين) — لا الإنتاج | | | ☐ |
| 4 | الاستعادةُ وفقَ §4 | | | ☐ |
| 5 | المطابقة: أعدادُ `users` و`orders` و`user_consents` في الهدف = `source.json` | | | ☐ |
| 5.1 | بصمةُ `sql/fingerprint.sql` على الهدفِ مقابلَ `source.json` (`RESTORE.md` §5) ⇒ `MATCH` | | | ☐ |

**ما تُرسِلُه بعدَه (بلا أسرار):** هذه الجدولةُ مملوءةً، ومخرجاتُ `select count(*)` الثلاث، ورقمُ التشغيل. وأتحقّقُ أنا من مطابقتِها لـ`source.json`/`db_backups` وأُحدِّثُ `PRD-104-backup-restore-20261009.md`؛ وVerified فقط إن كان الزمنُ الكلّيُّ (1→5) أقلَّ من 4 ساعات.

## أوامرُ التمرينِ المحلّيِّ (بالترتيب، على جهازِك)

```bash
# 0. الأدوات
age --version            # ≥ 1.1
pg_restore --version     # يبدأ بـ 17
date -u +%FT%TZ          # ← وقتُ البدء (سجّله)

# 1. التنزيل والتحقّق (أو من واجهةِ Actions)
gh run download 38009927769 --repo uxxxug/ceezr-backups -n wasla-backup-38009927769-1 -D drill
sha256sum drill/wasla-backup-*.tar.age   # يجبُ أن يطابقَ f2f8bcf1…1ecf

# 2. فكُّ التشفير — المفتاحُ يبقى على جهازِك
mkdir -p drill/restore && age -d -i /path/to/wasla-backup.key drill/wasla-backup-*.tar.age | tar -C drill/restore -xf -
ls drill/restore         # 7 ملفّات

# 3–4. قاعدةٌ محلّيّةٌ فارغة ثمَّ الاستعادة: نفّذ RESTORE.md الخيارَ «ب» ثمَّ §4 حرفيًّا بـ TARGET=postgresql://postgres@localhost:55432/postgres

# 5. المطابقة: RESTORE.md §5 ⇒ يجبُ أن يطبعَ MATCH
date -u +%FT%TZ          # ← وقتُ الانتهاء
docker rm -f wasla-drill && rm -rf drill   # التنظيف
```

أرسل: وقتَي البدءِ والانتهاء، ورقمَ التشغيل، وناتجَ `sha256sum`، وكلمةَ `MATCH` أو الفروقَ المطبوعة. لا تُرسِل المفتاحَ ولا رابطَ قاعدةٍ ولا الملفّاتِ المفكوكة.
