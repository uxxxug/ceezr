# WR-27: تثبيتُ سكربتاتِ النسخِ على CasaOS من `9b8c3b1b`، واختبارُ الحقيبةِ على Windows (2026-11-01/02)

**البند:** WR-27 · **ADR:** 0297 · 0298 · 0299 (لا قرارَ جديد) · **Work Packet:** `docs/work-packets/wr-27-offsite-install-casaos-20261102.json`
**السجلّاتُ الخام:** `docs/evidence/archive/WR-27-offsite-install-casaos-20261102/` (معها `SHA256SUMS`).
**النطاق:** تثبيتُ الملفّاتِ وحدَه. **لم يُنشأْ** `offsite.env` ولا `rclone.conf`، ولم يُربَطْ Drive، ولم يُطلَبْ أيُّ إعدادٍ من المالك، ولم يُرفَعْ شيءٌ خارجَ الخادم.

## ١) العائق

- `wasla-offsite-connect.sh` يستدعي `sudo /opt/wasla/offsite-setup.sh --signing-key` قبلَ OAuth.
- على الخادم كانت نسخةُ #713 (`de02d351`) مثبَّتةً منذُ 2026-11-01 16:25Z، وهي بلا `--signing-key`، وكانت `offsite-lib.sh` و`offsite-tool.py` و`pg-snapshot-dump.sh` غائبة.
- فالربطُ كان سيفشلُ عندَ الخطوة 5-3.
- وتصحيحٌ لتقريري السابق: النسخُ الليليُّ لا يطبعُ `offsite-skip`. هو لا يستدعي `offsite-backup.sh` أصلاً ما دامَ `offsite.env` غائباً. والذي يطبعُ `offsite-skip no_config` هو استدعاءُ `offsite-backup.sh` مباشرةً.

## ٢) التثبيت (2026-11-01T21:06:11Z)

| الملفّ | قبل | بعد (`9b8c3b1b`) | الصلاحيّة |
|---|---|---|---|
| `backup.sh` · `offsite-backup.sh` · `offsite-fetch.sh` · `offsite-restore-drill.sh` · `offsite-setup.sh` · `storage-restore-drill.sh` | #713 | مطابقٌ لـmain | 700 root:root |
| `pg-snapshot-dump.sh` | غائب | مطابق | 700 root:root |
| `offsite-lib.sh` · `offsite-tool.py` | غائب | مطابق | 600 root:root |
| `OFFSITE-BACKUP.md` | #713 | مطابق | 644 root:root |

- **المصدر:** `git show 9b8c3b1b:deploy/casaos/<f>` إلى مجلّدٍ مؤقّتٍ 700. ثمّ `sha256sum -c` قبلَ التثبيتِ وبعدَه (10/10 OK، `installed-SHA256SUMS.9b8c3b1b`)، و`bash -n`، و`ast.parse` لـ`offsite-tool.py`. لا `__pycache__` في `/opt/wasla`.
- **نسخةُ التراجع:** `/opt/wasla/backups/pre-wr27-install-20261101T210540Z/`، وفيها:
  - `opt-wasla-offsite-files.tar` (الملفّاتُ السبعةُ السابقة)،
  - `SHA256SUMS.before` و`MODES.before`،
  - `ROLLBACK.sh` (700): يعيدُ السبعةَ ويحذفُ الثلاثةَ الجديدة، ولا يمسُّ الحاويات.
- **الأدوات:** `/opt/wasla/bin/age` v1.3.2 و`/opt/wasla/bin/rclone` v1.75.2 (موجودان من #713)، وpython 3.14.4 وOpenSSH 10.2p1 وdocker وlogger من النظام. لم يُثبَّتْ شيءٌ جديدٌ منها.
- **لم يُمَسّ:** `compose.yml` و`.env` و`haproxy.cfg` و`miniapp-nginx.conf` و`shim-overlay/Dockerfile` ووحدتا `wasla-backup.{service,timer}`. تجزئاتُها قبلَ وبعدَ متطابقة (`baseline.txt` و`after.txt`).

## ٣) التحقّقُ بعدَ التثبيت

| الفحص | النتيجة |
|---|---|
| `offsite-backup.sh` مباشرةً | `offsite-skip no_config`، rc=0 |
| `offsite-fetch.sh --list` | `fetch-fail no_config`، rc=1 (متوقَّعٌ قبلَ الربط) |
| `offsite-setup.sh --signing-key` دونَ OAuth | rc=0، وسطرٌ واحدٌ `ssh-ed25519 …`. أُنشئَ `/etc/wasla/backup-signing.key` (600) و`.pub` (644)، وتشغيلٌ ثانٍ أعطى المفتاحَ نفسَه |
| بصمةُ مفتاحِ التوقيع (عامّة) | `SHA256:Z/8ZRUIQet6LuLUO49sg0kpbhUufBo/HnyqkbfGzZIo`. ستظهرُ للمالكِ في الخطوة 5-3 |
| توقيعٌ وتحقّقٌ تجريبيّ (`-n wasla-offsite-backup`) | `Good "wasla-offsite-backup" signature` |
| `offsite.env` و`rclone.conf` بعدَها | غائبان |
| **الحقيبةُ نفسُها (`9b8c3b1b`) من بيئةِ التطويرِ إلى الإنتاجِ عبرَ SSH حقيقيّ** بإعداداتِها الافتراضيّة (`sudo /opt/wasla`) | ثبّتت مفتاحَ الخادم، ثمّ مفتاحَ التوقيع (`Z/8ZRUIQ…`)، ثمّ توقّفت عندَ Client ID غيرِ الصالح (rc=2). مفتاحُ age الاختباريُّ حُذِف. `restore-test --list` أعطى `fetch-fail no_config` (`kit-connect-prod.txt`) |
| `systemctl start wasla-backup.service` | `success`، `backup-ok …/waslah-20261101T210710Z.dump 2135313 bytes storage_files=2`، **ولا سطرَ offsite** |
| ملفّاتُ النسخة | 11 ملفّاً (600): dump وrowstats (88 سطراً)، وstorage-db (11 سطرَ rowstats)، وstorage-files tar، وroles، وconfig tgz (12 ملفّاً بلا مفتاحِ التوقيع). `sha256sum -c` 3/3، و`pg_restore -l` سليم |
| `storage-restore-drill.sh 20261101T210710Z` | `drill-PASS`: storage-db 10/10 جدولاً (79 صفّاً)، و2/2 كائن، والحاوياتُ المتبقّية 0 |
| الحاوياتُ التسع | المعرّفاتُ وأوقاتُ الإقلاعِ وعددُ إعاداتِ التشغيلِ متطابقة. 6 `healthy` و3 بلا فحصٍ `running` |
| `https://api.waslareev.dpdns.org/ready` | 200 ×3 قبلَ التثبيت، و200 ×5 بعدَه |
| المؤقّت | `wasla-backup.timer` نشطٌ، والتشغيلُ القادمُ ليلاً كالمعتاد |

## ٤) Windows

- **نظامُ لابتوبِ المالكِ غيرُ معروفٍ لي:** لم يُذكَرْ في المحادثة.
- **فاختُبرت الحقيبةُ فعليّاً على Windows:** [`offsite-kit-windows`، التشغيل 41351085357](https://github.com/uxxxug/ceezr/actions/runs/41351085357). البيئة:
  - مشغّلُ `windows-latest` (MINGW64_NT-10.0-26100)، وGit Bash 5.3.15، وOpenSSH_10.6p1 من Git، وOpenSSH_for_Windows_9.5p2 من النظام؛
  - age v1.3.2 وrclone v1.75.2 برنامجان أصليّان بتجزئاتٍ مثبَّتة؛
  - الحقيبةُ مفكوكةٌ بـ`Expand-Archive` في `…\Ahmed Ali\Downloads`.
- **النتيجة: pass=20 fail=0** (`windows-kit-test.txt`):
  - البصمة: ssh-keygen من Git ومن Windows؛
  - رفضُ اللاحقةِ الخاطئةِ دونَ اتصال؛
  - ربطٌ كاملٌ بـOAuth وهميٍّ عبرَ rclone الأصليّ، و`--install` عبرَ stdin، وحذفُ الملفِّ المؤقّت؛
  - `ssh -n`، وعدمُ ظهورِ السرِّ في السجلّات؛
  - restore-test بتوقيعٍ من Linux، وsha256، و`age -d` الأصليّ، وأنبوبٌ ثنائيٌّ سليم؛
  - رفضُ النصِّ المشفّرِ المعدَّلِ و`known_hosts` المعدَّل.
- **خللٌ كشفَه التحضيرُ لـWindows وأُصلِح:** `ssh` يقسمُ قيمةَ `-o UserKnownHostsFile=` عندَ المسافات.
  - مع مجلّدِ مستخدمٍ مثلِ `C:\Users\Ahmed Ali` كان كلُّ اتصالٍ سيفشلُ بـ`Host key verification failed`، أي فشلٌ آمنٌ لكنّه يمنعُ الربط.
  - ثبتَ ذلك بـSSH حقيقيٍّ إلى الخادم.
  - الإصلاح: المسارُ بينَ علامتَي تنصيصٍ داخلَ القيمة، ورفضُ مسارٍ فيه `"`.
  - بعدَه: e2e حقيقيٌّ من مجلّدٍ فيه مسافة 19/0 (`e2e-client-space.txt`).
- **تحصينٌ وقائيٌّ لم يثبتْ أنّه كان سيفشل:** `host_fp_of` صارَ يقرأُ من stdin (`ssh-keygen -lf -`) لا من `<(…)`، لأنّ ssh-keygen الأصليَّ في Windows لا يرى `/dev/fd`. ونجحَ بالاثنين.
- **NOT TESTED على Windows:**
  - SSH حقيقيٌّ عبرَ cloudflared إلى الخادم؛
  - التثبيتُ بـ`winget` (المشغّلُ استعملَ ملفّاتِ ZIP الرسميّةَ بالإصدارَين نفسَيهما)؛
  - شاشةُ Google في متصفّحٍ حقيقيّ.
  - **لا يُطلَبُ من المالكِ تشغيلُ الحقيبةِ على Windows قبلَ أن تُسدَّ هذه.** أوّلُ ما يُطلَبُ هو `ssh wasla true` بعدَ تثبيتِ مفتاحِ الخادم، بإشرافٍ مباشر.

## ٥) الاختبارات الأخرى

- `offsite-selftest.sh` على الخادم (مؤقّتٌ في `/tmp`، حُذِفَ بعدَه): **pass=132 fail=0** (`selftest.txt`).
- **الحقيبة:** `765289d52a5bd98037635b017f6d6884aaf26e64c3277d086d986e28b2338461`.
  - بناءانِ متطابقان، وبناءُ GitHub يطابقُ البناءَ المحلّيَّ في كلِّ مرّة.
  - سكربتاتُها الثلاثةُ مطابقةٌ بايتاً ببايتٍ لما اختُبِرَ على Windows. الفرقُ عن تلك النسخةِ في الوثيقتَين وحدَهما.
  - النسخُ السابقة: `41e4703c…` (#715)، و`2b9e0c4d…` (أوّلُ تشغيلٍ على Windows).

## ٦) خارجَ هذه المرحلة

- **بانتظارِ موافقةِ المالك:** إنشاءُ عميلِ OAuth، والربطُ الفعليّ، وأوّلُ رفعٍ إلى Drive، وتفعيلُ الرفعِ الليليّ.
- نسخةُ `OFFSITE-BACKUP.md` على الخادمِ هي نسخةُ `9b8c3b1b`. الأحدثُ في الحقيبةِ والمستودع.
