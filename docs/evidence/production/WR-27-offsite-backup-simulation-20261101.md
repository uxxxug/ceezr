# WR-27: النسخةُ خارجَ الموقع، محاكاةٌ على الخادم قبلَ الربطِ الحقيقيّ (2026-11-01)

**المستوى:** مختبَرٌ على خادمِ CasaOS بمستودعٍ محلّيٍّ بدلَ Drive. **لم يُربَط Drive بعدُ، ولم يُجرَ اختبارُ استعادةٍ من Drive.** ذلك ينتظرُ المالك.

## الأدوات

- مثبّتةٌ في `/opt/wasla/bin` (755 root) دونَ مساسٍ بحزمِ المضيف. `/usr/bin/rclone` الموجودُ أصلاً لم يُلمَس.
- `age v1.3.2`:
  - `age-v1.3.2-linux-amd64.tar.gz` = `sha256:cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`.
  - هذا يطابقُ بصمةَ الإصدارِ في GitHub.
- `rclone v1.75.2`: `rclone-v1.75.2-linux-amd64.zip: OK` مقابلَ `SHA256SUMS` الرسميّ.

## المحاكاة

- مفتاحٌ مؤقّتٌ (`age-keygen`)، وremote من نوعِ `local`.
- `offsite-backup.sh`:
  `offsite-ok name=wasla-20261101T155009Z.tar.age bytes=2612024 sha256=26f90165d0ef7b4e drive_md5=ok drive_sha256=ok tiers=daily,monthly,weekly(seed)`
  (اليومُ أوّلُ الشهرِ بتوقيتِ الرياض، فدخلَ monthly).
- `offsite-fetch.sh | age -d | offsite-restore-drill.sh`:
  ```
  manifest-ok files=9
  app-db backup=20261101T155009Z tables live=88 restored=88 funcs live=1167 restored=1167 rows_restored=4426 tables_with_row_diff=0
  cities=5 driver_documents=0 drivers=1 orders=0 users=2
  drill backup=20261101T155009Z files_manifest_equal=yes object_rows=2 compared=2 equal=2 different=0 buckets=driver-documents:false:5242880
  drill-PASS
  config files=12 equal_to_live=12 changed=0
  offsite-drill-PASS backup=20261101T155009Z
  fetch-ok daily/wasla-20261101T155009Z.tar.age drive_md5=match
  ```
- **إخفاقٌ أوّلٌ أُصلِح:** صورةُ postgis تُنشئُ مخطّطَ `tiger` في القاعدةِ الافتراضيّة، فرفضَ `pg_restore`: `schema "tiger" already exists`. صارت الاستعادةُ إلى قاعدةٍ من `template0`.

## السلبيّ

| الاختبار | النتيجة |
|---|---|
| تعديلُ 4 بايتات في ملفٍّ مشفّر | `age: error: failed to decrypt and authenticate payload chunk` |
| الفكُّ بمفتاحٍ آخر | `age: error: no identity matched any of the recipients` |
| `tar -tf` على الملفِّ المرفوع | ليس tar مقروءاً، ويبدأُ بـ`age-encryption.org/v1` |

- محاولةٌ أولى لاختبارِ التلاعبِ كانت باطلة: الكتابةُ فشلت صامتةً لأنّ الملفَّ لـroot. أُعيدَت على ملفٍّ مملوك.

## التنظيف

- حُذفَ المفتاحُ المؤقّت (`shred`) والمستودعُ المحلّيّ و`/etc/wasla/offsite.env` و`/etc/wasla/rclone.conf` والملفُّ المشفّرُ المحلّيّ.
- لا حاوياتِ تمرينٍ باقية. فالليلةَ يطبعُ `backup.sh` `offsite-skip no_config` حتّى يربطَ المالكُ Drive.
- السكربتاتُ المحدَّثةُ على الخادم (700 root): `offsite-{backup,fetch,restore-drill}.sh`، و`storage-restore-drill.sh` (يقبلُ `BACKUP_DIR`)، و`backup.sh`.
- القديمانِ محفوظانِ بلاحقةِ `.bak-pre-offsite-<TS>`.
