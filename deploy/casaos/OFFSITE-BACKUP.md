# النسخةُ خارجَ الموقع: age ← Google Drive (ADR 0297 · ADR 0298 · ADR 0299 · ADR 0300)

دليلُ تشغيلٍ واستعادة. **لا يحوي أيَّ سرّ**، ويصلحُ للحفظِ في أيِّ مكان، ومنه Drive نفسُه.
خطواتُ اللابتوبِ بالترتيبِ في `laptop/README-AR.md` (في الحقيبة: `README-AR.md`).

## الفكرةُ باختصار

- **ثلاثُ مراحلَ منفصلة، لكلٍّ موافقتُها (ADR 0300).** لا تُنفِّذُ مرحلةٌ ما بعدَها، والافتراضيُّ دائماً «غيرُ مفعَّل»:
  1. **الربط** (`wasla-offsite-connect.sh`): يحفظُ رمزَ Drive على الخادم، ويتحقّقُ من الحسابِ بقراءةٍ فقط. لا رفعَ ولا مجلّد.
  2. **أوّلُ رفعٍ يدويّ** (`wasla-offsite-first-upload.sh`): نسخةٌ واحدةٌ مشفّرةٌ موقَّعة. لا يفعّلُ الليليّ.
  3. **تفعيلُ الرفعِ الليليّ** (`wasla-offsite-enable-nightly.sh`): يُرفَضُ قبلَ نجاحِ أوّلِ رفعٍ لهذا الربط.
- **كلَّ ليلة (03:30 UTC) بعدَ التفعيلِ وحدَه:** يصنعُ `backup.sh` النسخةَ المحلّيّة. ثمّ يجمعُها `offsite-backup.sh` في أرشيفٍ واحد، ويشفّرُه بـage **بالمفتاحِ العامِّ وحدَه**، ويوقّعُ بيانَه، ويرفعُ الثلاثةَ إلى مجلّد `WASLA-Backups` في Google Drive الخاصِّ بالمالك.
- **المفتاحُ الخاصُّ على لابتوبِ المالكِ فقط.** فالخادمُ لا يستطيعُ فكَّ ما يرفعُه، ومن يصلُ إلى Drive لا يرى إلّا ملفّاتٍ مشفّرة.
- **التوقيعُ يثبتُ المصدر:** النسخةُ من خادمِك ولم تُعدَّل. والتشفيرُ يحمي سرّيّتَها.
- **الاستعادةُ تُثبَتُ بتمرينٍ فعليّ:**
  1. الخادمُ ينزّلُ الملفّاتِ من Drive.
  2. اللابتوبُ يتحقّقُ منها ويفكُّها.
  3. الخادمُ يستعيدُها في حاوياتٍ معزولة، ويقارنُها **بلقطةِ الصفوفِ التي أُخذت لحظةَ النسخ** (لا بالإنتاجِ الحيّ).
- **اللابتوبُ لا يتّصلُ إلّا بخادمٍ تحقّقَ المالكُ من مفتاحِه** بقناةٍ مستقلّة (انظر «مفتاحُ SSH للخادم»).

## ما في كلِّ نسخة

في Drive ثلاثةُ ملفّاتٍ لكلِّ نسخة:

| الملفّ | المحتوى |
|---|---|
| `wasla-<TS>.tar.age` | الأرشيفُ مشفّراً بـage للمفتاحِ العامِّ وحدَه |
| `wasla-<TS>.manifest` | بيانٌ بلا بيانات: الاسم، والطابع، وحجمُ النصِّ المشفّرِ وsha256 له، وsha256 لـ`MANIFEST.sha256` الداخليّ، والمستلم |
| `wasla-<TS>.manifest.sig` | توقيعُ البيانِ بمفتاحِ الخادم (`ssh-keygen -Y sign`، الهويّة `wasla-backup`، النطاق `wasla-offsite-backup`) |

داخلَ الأرشيف:

| الملفّ | المحتوى |
|---|---|
| `waslah-<TS>.dump` (+`.sha256`) | قاعدةُ التطبيق، `pg_dump -Fc` من لقطة (`REPEATABLE READ`) |
| `waslah-<TS>.rowstats` | من **اللقطةِ نفسِها**: لكلِّ جدولٍ عددُ صفوفِه وmd5 لمحتواه مرتَّباً |
| `storage-roles-<TS>.sql` | أدوارُ قاعدةِ المخزن (فيها بصماتُ كلماتِ مرور؛ لذلك الأرشيفُ مشفّر) |
| `storage-db-<TS>.dump` (+`.sha256`) و`storage-db-<TS>.rowstats` | قاعدةُ المخزنِ الوصفيّة، ولقطةُ صفوفِها |
| `storage-files-<TS>.tar` (+`.sha256`) و`storage-files-<TS>.sha256` | بايتاتُ وثائقِ السائقين، وبيانُ sha256 لكلِّ ملفّ. **دلوُّ وسائطِ محادثةِ الطلبِ (`order-chat-media`) مستبعَدٌ منهما** (WR-40): بايتاتُ الوسائطِ عابرةٌ بالتصميمِ ولا تُنسَخُ احتياطيًّا |
| `config-<TS>.tgz` | `/etc/wasla/*.env` و`redis.conf`، و`/opt/wasla/{.env,compose.yml,haproxy.cfg}` (أسرارُ التشغيل) |
| `MANIFEST.sha256` | sha256 لكلِّ ما سبق، وبصمتُه نفسُها في البيانِ الموقَّع |

ليست في النسخة:

- **بايتاتُ وسائطِ محادثةِ الطلبِ** (`order-chat-media`): مستبعَدةٌ من `storage-files` ومن بيانِه منذَ [WR-40](../../docs/adr/0307-chat-media-excluded-from-backups.md) — استبقاءُ الوسائطِ قصيرٌ بالتصميم (7 أيّامٍ من انتهاءِ الطلبِ أو 30 يوماً من الرفعِ أيّهما أسبق، والمحوُ الفوريُّ عندَ حذفِ الحسابِ يسبقُهما)، فلا معنى لحفظِ بايتاتِها أصلًا. الاستبقاءُ نفسُه لا يتغيّرُ: صفوفُ `order_chat_attachments` في قاعدةِ التطبيقِ تُحذَفُ كالمعتاد.
- `rclone.conf`، وفيه رمزُ Drive. يُعادُ إنشاؤه بـ`wasla-offsite-connect.sh`.
- مفتاحُ age الخاصّ (على اللابتوبِ فقط)، ومفتاحُ التوقيعِ الخاصّ (`/etc/wasla/backup-signing.key`، على الخادمِ فقط).
- ما يُعادُ بناؤه من المستودع: الشيفرة، و`miniapp-nginx.conf`، و`shim-overlay/Dockerfile`، وحزمةُ Mini App. انظر «الاستعادةُ الحقيقيّة».

## الاحتفاظ

| المجلّدُ في Drive | متى | يبقى |
|---|---|---|
| `WASLA-Backups/daily/` | كلَّ ليلة | 14 يوماً |
| `WASLA-Backups/weekly/` | الجمعة (توقيتُ الرياض)، وأوّلُ رفعٍ على الإطلاق | 8 أسابيع |
| `WASLA-Backups/monthly/` | أوّلُ كلِّ شهر، وأوّلُ رفعٍ على الإطلاق | 12 شهراً |

- الملفّاتُ الثلاثةُ تُحفَظُ وتُحذَفُ معاً في كلِّ مستوى.
- المحذوفُ يذهبُ إلى سلّةِ Drive، وتُفرَّغُ وحدَها بعدَ 30 يوماً.
- على الخادم: النسخُ المحلّيّةُ غيرُ المشفّرةِ 14 يوماً في `/var/backups/wasla` (700 root)، ومعها آخرُ 3 ملفّاتٍ مشفّرةٍ في `/var/backups/wasla/offsite`.
- الحجمُ اليومَ نحو 2.6 MB للنسخة، فالمجموعُ أقلُّ من 100 MB.

## التحقّقُ بعدَ كلِّ رفع (آليّ)

1. قبلَ التشفير: sha256 لكلِّ تفريغٍ يطابقُ ملفَّه.
2. بعدَه: الملفُّ يبدأُ بترويسة `age-encryption.org/v1`، وإلّا لا يُرفَع.
3. يُوقَّعُ البيان. وبلا مفتاحِ توقيعٍ يرفضُ الرفعَ كلَّه.
4. بعدَ رفعِ كلِّ ملفٍّ من الثلاثة: md5 الذي يحسبُه Drive يساوي md5 المحلّيّ، ثمّ يُنزَّلُ الملفُّ كاملاً ويُقارَنُ sha256.
5. أيُّ فشلٍ يُسجِّلُ `offsite-fail stage=<الخطوة>`، ويحذفُ ما رُفِعَ في هذا التشغيل، فلا تبقى في Drive نسخةٌ ناقصة.
6. النتيجةُ في `journalctl -t wasla-offsite`، وفي `/var/backups/wasla/offsite/last-ok.json`.
7. فشلُ أيِّ خطوةٍ يُفشِلُ `wasla-backup.service`. للفحص: `systemctl status wasla-backup`.

age يشفّرُ تشفيراً موثَّقاً، فأيُّ تلاعبٍ بالنصِّ المشفّرِ يُكتشَفُ عندَ الفكّ. والتوقيعُ يكشفُ قبلَ ذلك تبديلَ الملفِّ كلِّه بملفٍّ آخرَ مشفّرٍ للمفتاحِ العامِّ نفسِه، وهو ما لا يكشفُه age وحدَه (ADR 0298).

## مفتاحُ SSH للخادم (ADR 0299)

كلُّ ما يثقُ به اللابتوبُ يمرُّ عبرَ SSH: مفتاحُ توقيعِ النسخ، وإعدادُ Drive، ونتائجُ التمرين. فلو قبلَ اللابتوبُ أوّلَ مفتاحٍ يُعرَضُ عليه، لاستطاعَ وسيطٌ في الطريقِ أن يقدّمَ مفتاحَ توقيعِه هو، فتُثبَّتَ ثقةٌ مزيّفةٌ من البداية.

**القرار:**

- مفتاحُ ed25519 للخادمِ مضمَّنٌ في الحقيبة (`wasla-laptop-lib.sh`) مع بصمتِه:

  ```
  SHA256:xpIw6WmQ6gB/t7pDMYlzvkcfgSbe7/8LyNECMJd0D+U
  ```

- طابقت هذه البصمةُ، قبلَ تضمينِها، ما سلّمه المالكُ من سكربتِ الإعدادِ على الخادمِ نفسِه. وهي قناةٌ مستقلّةٌ عن نفقِ SSH.
- **أوّلَ مرّة** يطلبُ `wasla-offsite-connect.sh` من المالكِ آخرَ 8 أحرفٍ من البصمة، كما يقرؤها **من غيرِ هذا الاتصال**:
  - على الخادمِ نفسِه (شاشتُه ولوحةُ مفاتيحِه، أو طرفيّةُ CasaOS المحلّيّة): `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.
  - أو سطرُ `HOST_KEY … (ED25519)` في مخرجاتِ سكربتِ الإعداد.
- **لا تُعرَضُ البصمةُ المتوقَّعةُ قبلَ الإدخال**، فلا تُنسَخُ دونَ مقارنة.
- المطابقةُ تكتبُ `~/.wasla/known_hosts` بسطرٍ واحد (`wasla-casaos ssh-ed25519 …`، 600). وعدمُ المطابقةِ يوقفُ السكربتَ قبلَ أيِّ اتصالٍ أو تثبيت.
- كلُّ اتصالٍ بعدَها من السكربتَين يجري بـ`StrictHostKeyChecking=yes` و`HostKeyAlgorithms=ssh-ed25519` وهذا الملفِّ وحدَه. فمفتاحٌ مختلفٌ يعطي `Host key verification failed`، ولا يُتجاوَز.
- مفتاحُ توقيعِ النسخِ لا يُطلَبُ ولا يُثبَّتُ إلّا بعدَ ذلك، عبرَ الاتصالِ الموثَّق.
- **تغيّرُ مفتاحِ الخادم** (خادمٌ جديدٌ أو إعادةُ تثبيت) يحتاجُ حقيبةً جديدةً من المستودع، بمرجعٍ جديدٍ تحقّقَ منه المالكُ بالطريقةِ نفسِها. لا خيارَ لتجاوزِه من سطرِ الأوامر.

## التثبيتُ على الخادم (المهندس، مرّةً واحدة، قبلَ ربطِ المالك)

**الحالة:** ثُبِّتَ على CasaOS في 2026-11-01 من `main` عندَ `9b8c3b1b`، ولم يُضبَطْ: لا `offsite.env` ولا `rclone.conf`. فالنسخُ الليليُّ محلّيٌّ وحدَه، واستدعاءُ `offsite-backup.sh` مباشرةً يطبعُ `offsite-skip no_config`. الدليل: `docs/evidence/production/WR-27-offsite-install-casaos-20261102.md`.
**فصلُ المراحل (ADR 0300) غيرُ مثبَّتٍ على الخادم بعد:** النسخةُ المثبَّتةُ ما زالت فيها `--install`، وتثبيتُ الجديدةِ يحتاجُ موافقةَ المالك. وحتّى ذلك يتوقّفُ `wasla-offsite-connect.sh` الجديدُ عندَ `--status` (الخادمُ القديمُ لا يعرفُه) قبلَ طلبِ أيِّ سرّ، ولا يُرسَلُ شيء.

**ملفّاتُ الحالة في `/etc/wasla/`** (كلُّها 600 root، تُقرأُ بمحلّلٍ صارمٍ ولا تُنفَّذُ بـ`source`):

| الملفّ | يكتبُه | معناه |
|---|---|---|
| `rclone.conf` | `--link` | رمزُ Drive. وجودُه **لا** يعني إذناً بالرفع |
| `offsite-pending.env` | `--link` | المستلمُ والوجهةُ و`LINK_ID` وبصمةُ الاعتماد `CRED_FP` لهذا الربط (ADR 0301) |
| `offsite-first-ok` | `offsite-backup.sh --first` عندَ النجاحِ وحدَه | سجلُّ أوّلِ رفعٍ تحقّق (الطابع، sha256 الأرشيفِ وحجمُه، sha256 البيان، `LINK_ID`، `CRED_FP`) |
| `offsite.env` | `--enable-nightly` **وحدَه** | إذنُ الرفعِ الليليّ. لا يرفعُ `backup.sh` إلّا إن طابقَ `LINK_ID` و`CRED_FP` فيه الربطَ وسجلَّ أوّلِ رفعٍ وبصمةَ `rclone.conf` الحاليّة، وإلّا `offsite-fail stage=link_changed\|credential_changed` قبلَ أيِّ اتّصالٍ بـDrive |

`sudo /opt/wasla/offsite-setup.sh --status` يطبعُ المرحلة: `stage=unlinked|linked|first-ok|enabled`، بلا أسرار.

| الملفّ في `/opt/wasla/` | الصلاحيّة | دورُه |
|---|---|---|
| `backup.sh` | 700 root | النسخُ الليليّ (`wasla-backup.service`)، ويستدعي `offsite-backup.sh --nightly` فقط إن وُجدَ `offsite.env` |
| `pg-snapshot-dump.sh` | 700 root | لقطةٌ متّسقةٌ ولقطةُ الصفوف `*.rowstats` |
| `storage-restore-drill.sh` | 700 root | تمرينُ استعادةِ التخزينِ في حاوياتٍ معزولة |
| `offsite-backup.sh` · `offsite-fetch.sh` · `offsite-restore-drill.sh` · `offsite-setup.sh` | 700 root | الرفعُ والتنزيلُ والتمرينُ والضبط |
| `offsite-lib.sh` · `offsite-tool.py` | 600 root | مكتبةٌ تُستورَد، وأداةٌ يشغّلُها `python3` |
| `OFFSITE-BACKUP.md` | 644 root | هذا الدليل |

- **الأدوات:** `/opt/wasla/bin/age` (1.3.2) و`/opt/wasla/bin/rclone` (1.75.2)، و`python3` و`ssh-keygen` (OpenSSH 8.1 فأحدث) و`docker` و`logger` من النظام.
- **لا يُثبَّتُ هنا:** `laptop/*` (حقيبةُ المالك)، و`tests/*`، و`shim-overlay/` و`miniapp-nginx.conf` (مطابقانِ للإنتاجِ ولا يمسّهما النسخ).
- **الخطوات:**
  1. نسخةُ تراجع: `tar` للملفّاتِ الحاليّة، و`SHA256SUMS.before` و`MODES.before`، و`ROLLBACK.sh` في `/opt/wasla/backups/pre-wr27-install-<TS>/`.
  2. الملفّاتُ من `git show <SHA>:deploy/casaos/<f>` إلى مجلّدٍ مؤقّتٍ 700، ثمّ `sha256sum -c`، و`bash -n`، وتحليلُ `offsite-tool.py` دونَ `py_compile`، فلا يُكتَبُ `__pycache__`.
  3. `install -o root -g root -m <الصلاحيّة>` لكلِّ ملفّ، ثمّ `sha256sum -c` في `/opt/wasla`.
- **التحقّق:** `offsite-setup.sh --signing-key` يعملُ دونَ OAuth: ينشئُ `/etc/wasla/backup-signing.key` (600) أوّلَ مرّة، ويطبعُ المفتاحَ نفسَه بعدَها. ثمّ `systemctl start wasla-backup.service` و`storage-restore-drill.sh <TS>`، والحاوياتُ و`/ready` كما كانت.
- **التراجع:** `sudo /opt/wasla/backups/pre-wr27-install-<TS>/ROLLBACK.sh`. يعيدُ الملفّاتِ السبعةَ السابقة، ويحذفُ `offsite-lib.sh` و`offsite-tool.py` و`pg-snapshot-dump.sh`. لا يمسُّ الحاويات، ولا يحذفُ مفتاحَ التوقيع.

## الإعدادُ لمرّةٍ واحدة (المالك)

### أ) عميلُ OAuth خاصٌّ في Google Cloud (نحو 5 دقائق، **بعدَ اعتمادِ هذه الخطوات**)

عميلُ rclone المشترَكُ يُسحَبُ خلالَ 2026، فيلزمُ عميلٌ باسمِ المالك.

1. افتحْ <https://console.cloud.google.com/> بحسابِ Google الذي ستُحفَظُ فيه النسخ، وأنشئْ مشروعاً، مثلاً `wasla-backup`.
2. **APIs & Services ← Library ← Google Drive API ← Enable**.
3. **Google Auth Platform ← Get started**:
   - اسمُ التطبيق `wasla-backup`، وبريدُك. **لا تضعْ شعاراً.**
   - **Audience: External**.
4. **Data Access ← Add scopes**: `https://www.googleapis.com/auth/drive.file` وحدَه.
   - يصنّفُه Google نطاقاً **غيرَ حسّاسٍ** وموصىً به ([Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)).
   - يرى التطبيقُ به ما أنشأه هو فقط، لا بقيّةَ ملفّاتِ Drive.
5. **Audience ← Publish app** (In production). السببُ والحدود:
   - **وضعُ Testing**: مع جمهورِ External ونطاقٍ غيرِ الاسمِ والبريدِ والملفِّ الشخصيّ، ينتهي رمزُ التحديثِ بعدَ **7 أيّام** ([Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)). وهذا ينطبقُ هنا لأنّ `drive.file` خارجَ تلك الثلاثة، فيتوقّفُ الرفعُ الليليُّ بعدَ أسبوع.
   - **النشرُ لا يعني التحقّقَ من Google.** تطبيقُ الاستعمالِ الشخصيّ (أقلُّ من 100 مستخدم) يعملُ دونَ تحقّق، وتظهرُ عندَ الموافقةِ شاشةُ «Google hasn't verified this app» تتجاوزُها بـ**Advanced ← Go to wasla-backup** ([When is verification not needed](https://support.google.com/cloud/answer/13464323)).
   - إن طلبَ Google لاحقاً «brand verification» ([Verification requirements](https://support.google.com/cloud/answer/13464321)) فلا تقدّمْ طلباً. أخبرِ المهندس، فقد تتغيّرُ القواعد.
6. **Clients ← Create client ← Application type: Desktop app** ← Create. انسخْ **Client ID** و**Client secret** إلى مديرِ كلماتِ المرور، ولا ترسلْهما في أيِّ محادثةٍ أو بريد.

### ب) أدواتُ اللابتوب وSSH

في `README-AR.md` بالحقيبة: التثبيتُ على macOS وLinux وWindows (Git Bash)، وإعدادُ `~/.ssh/config` بفحصٍ صارمٍ لمفتاحِ الخادم، والتحقّقُ من `SHA256SUMS`.
الحقيبةُ تُبنى بـ`bash deploy/casaos/laptop/build-kit.sh OUT.zip`، والبناءُ حتميّ (sha256 نفسُه في كلِّ مرّة).

### ج) المراحلُ الثلاث (ADR 0300)

من داخلِ مجلّدِ الحقيبة (أو `deploy/casaos/laptop/` في المستودع)، **بهذا الترتيب، وكلٌّ حينَ تقرّرُه أنت**:

| | الأمرُ على اللابتوب | تكتبُ | ما يحدثُ على الخادم | ما لا يحدث |
|---|---|---|---|---|
| أ | `bash wasla-offsite-connect.sh` | (`RELINK` لإعادةِ الربطِ فقط) | `offsite-setup.sh --link` | لا رفع، ولا مجلّدَ في Drive، ولا `offsite.env` |
| ب | `bash wasla-offsite-first-upload.sh` | `UPLOAD` | `offsite-backup.sh --first` | لا تفعيلَ للّيليّ |
| — | `bash wasla-offsite-restore-test.sh` (مستحسَن) | — | تنزيلٌ وتمرينُ استعادةٍ معزول | لا يكتبُ في Drive |
| ج | `bash wasla-offsite-enable-nightly.sh` | `ENABLE` | `offsite-setup.sh --enable-nightly <TS>` | لا رفعَ الآن؛ يبدأُ الليلةَ القادمة |
| إيقاف | `bash wasla-offsite-enable-nightly.sh --disable` | `DISABLE` | `offsite-setup.sh --disable-nightly` | النسخُ المحلّيُّ والربطُ باقيان |

الكلماتُ بالحروفِ اللاتينيّةِ الكبيرة، وأيُّ شيءٍ آخرَ يُلغي دونَ أثر. كلُّ سكربتٍ يقرأُ المرحلةَ من الخادمِ أوّلاً، ويرفضُ ما لا يناسبُها.

**أ) الربط** — `wasla-offsite-connect.sh`:

1. **مفتاحُ الخادم:** تحقّقٌ مستقلٌّ وتثبيت (القسمُ السابق). لا يحدثُ شيءٌ آخرُ قبلَه.
2. **مفتاحُ age:** ينشئُ `~/.wasla/wasla-backup.agekey` إن غاب، ويطبعُ العامّ.
3. **مفتاحُ توقيعِ النسخ:** يطلبُه من الخادمِ (يُنشأُ هناك إن غاب)، ويثبّتُه في `~/.wasla/allowed_signers`. وإن تغيّرَ لاحقاً يتوقّفُ ولا يستبدلُه.
4. **حالةُ الخادم** (`--status`) قبلَ أيِّ سرّ: خادمٌ أقدمُ من ADR 0300 ⇒ توقّف. ومفعَّلٌ ليليّاً ⇒ توقّفٌ قبلَ أيِّ سؤال (أوقفْ أوّلاً). ومربوطٌ مسبقاً ⇒ يلزمُ `RELINK`.
5. **عميلُ OAuth:** يسألُ عن Client ID، ثمّ عن secret **دونَ صدى**، ويكتبُهما بأمرٍ داخليٍّ في ملفٍّ مؤقّت (600، داخلَ مجلّدٍ 700).
6. **الموافقة:** `rclone config reconnect` يفتحُ المتصفّحَ للموافقة، ويكتبُ الرمزَ في الملفِّ نفسِه.
7. **الخادم:** يرسلُ القسمَ إلى `offsite-setup.sh --link` عبرَ **stdin** لـSSH.
   - الخادمُ يرفضُ أوّلاً إن كان `offsite.env` موجوداً (`link-FAIL nightly_enabled`)، قبلَ قراءةِ stdin ودونَ أيِّ تغيير (ADR 0301).
   - ثمّ يتحقّقُ من صيغتِه في ملفٍّ مرشَّح، ثمّ من الحسابِ بأمرٍ واحدٍ للقراءة (`rclone about`: الحصّة).
   - عندَ النجاحِ وحدَه يستبدلُ `rclone.conf` (والسابقُ يُحفَظُ `.bak-<TS>`)، ويكتبُ `offsite-pending.env`. وعندَ الفشلِ لا يتغيّرُ شيء.
8. **التنظيف:** يُحذَفُ الملفُّ المؤقّتُ عندَ الخروج. والنتيجة: «لم يُرفَعْ أيُّ ملفّ، والرفعُ الليليُّ غيرُ مفعَّل».

**ب) أوّلُ رفعٍ يدويّ** — `wasla-offsite-first-upload.sh`:

- يرفضُ إن لم يكنِ الخادمُ مربوطاً، أو كان الليليُّ مفعَّلاً.
- بعدَ `UPLOAD`: نسخةٌ واحدةٌ لأحدثِ نسخةٍ محلّيّة، أي ثلاثةُ ملفّاتٍ في `WASLA-Backups/daily/`، بالتشفيرِ والتوقيعِ والتحقّقِ نفسِه («التحقّقُ بعدَ كلِّ رفع»). لا weekly ولا monthly، ولا حذفَ بعيد.
- النجاحُ يكتبُ `offsite-first-ok`، ويطبعُ `first-ok ts=<TS> … nightly=off`. والفشلُ يحذفُ ما رُفعَ في المحاولة، ولا يكتبُ سجلّاً.

**ج) التفعيل** — `wasla-offsite-enable-nightly.sh`:

- لا يسألُ إلّا إن أبلغَ الخادمُ `stage=first-ok`، ويعرضُ طابعَ أوّلِ رفع.
- بعدَ `ENABLE` يعيدُ الخادمُ التحقّقَ بنفسِه، ويرفضُ إن لم تتحقّقْ كلُّها:
  - ربطٌ صالح؛
  - سجلُّ أوّلِ رفعٍ لهذا الربطِ نفسِه (`LINK_ID`) وبالطابعِ والمستلمِ والوجهةِ نفسِها؛
  - بصمةُ `rclone.conf` الحاليّة تساوي `CRED_FP` المسجَّلة، وإلّا `credential_changed`؛
  - في `daily/` الأسماءُ الثلاثةُ وحدَها، والأرشيفُ بحجمِه المسجَّل، وإلّا `first_upload_missing_on_drive`؛
  - sha256 الأرشيفِ بعدَ تنزيلِه كاملاً (أنبوبٌ، لا قرص) يساوي المسجَّل، وإلّا `ciphertext_mismatch`؛
  - sha256 البيانِ يساوي المسجَّل، وإلّا `manifest_mismatch`؛
  - التوقيعُ صالحٌ بمفتاحِ الخادم (`wasla-backup`، `wasla-offsite-backup`)، وإلّا `manifest_signature_invalid`؛
  - حقولُ البيان (الطابع، الحجم، sha256، المستلم) تطابقُ السجلّ، وإلّا `manifest_mismatch`.
  - كلُّها قراءةٌ فقط، ولا كتابةَ في Drive. والتفعيلُ ينزّلُ الأرشيفَ مرّةً واحدة.
- ثمّ يكتبُ `offsite.env` ذرّيّاً (600). ومن الليلةِ التالية يرفعُ `backup.sh` كما في «الفكرةُ باختصار».

**حدودُ حمايةِ الأسرار:**

- لا يظهرُ client_secret ولا الرمزُ في وسائطِ أيِّ عمليّة (`/proc/*/cmdline`)، على اللابتوبِ ولا على الخادم. اختُبِرَ ذلك بعيّناتٍ متكرّرةٍ أثناءَ التشغيل، مع ضابطٍ إيجابيّ (`docs/evidence/production/WR-27-offsite-hardening-selftest-20261101.md`).
- **قيدٌ باقٍ:** يبقى الرمزُ والسرُّ نصّاً في `/etc/wasla/rclone.conf` (600 root).
  - هذا تصميمُ rclone: لا يقبلُ الرمزَ إلّا من ملفِّ إعدادٍ أو وسيطٍ أو متغيّرِ بيئة، واخترنا الملفّ.
  - تشفيرُ rclone لملفِّه (`RCLONE_CONFIG_PASS`) لا يضيفُ حمايةً حقيقيّةً على خادمٍ يعملُ بلا مراقبة، لأنّ كلمةَ مرورِه يجبُ أن تكونَ على الخادمِ نفسِه.
- من يملكُ root على الخادمِ يصلُ إلى الرمز، فيقرأُ ما أنشأه التطبيقُ في Drive أو يحذفُه، ولا يرى غيرَه (`drive.file`). لكنّه لا يستطيعُ فكَّ أيِّ نسخة. والعلاجُ سحبُ الوصول («الإيقافُ والتراجع»).

**احفظْ خارجَ الإنترنت** (مديرُ كلماتِ مرورٍ أو USB، لا في Drive):

- `~/.wasla/wasla-backup.agekey`: **سرّ**، وضياعُه يعني أنّ كلَّ النسخِ غيرُ قابلةٍ للفكّ.
- `~/.wasla/allowed_signers`: ليس سرّاً، ويلزمُ للتحقّقِ من النسخِ إن ضاعَ اللابتوب.

## اختبارُ الاستعادةِ الفعليّ (المالك، كلَّ شهرٍ على الأقلّ)

```bash
bash wasla-offsite-restore-test.sh            # أحدثُ نسخةٍ يوميّة
bash wasla-offsite-restore-test.sh --list     # القائمة
bash wasla-offsite-restore-test.sh monthly/wasla-<TS>.tar.age
```

الترتيب، ولا يصلُ إلى الخادمِ شيءٌ مفكوكٌ قبلَ نجاحِ كلِّ ما قبلَه:

0. **الخادم:** مفتاحُه يطابقُ المثبَّتَ في `~/.wasla/known_hosts`، وإلّا لا اتصال.
1. **المصدر (اللابتوب):**
   - `offsite-fetch.sh` ينزّلُ البيانَ وتوقيعَه إلى ملفٍّ مؤقّتٍ كامل، ويطابقُ md5 الذي يحفظُه Drive.
   - `ssh-keygen -Y verify` بالمفتاحِ المثبَّت، ثمّ الاسمُ والصيغة، وأنّ المستلمَ مفتاحُك.
2. **النصُّ المشفّر (اللابتوب):** تنزيلٌ كاملٌ إلى ملفٍّ مؤقّت (700)، ثمّ الحجمُ وsha256 مقابلَ البيانِ الموقَّع، ثمّ ترويسةُ age.
3. **فكٌّ تجريبيٌّ كامل** إلى `/dev/null`. المفتاحُ الخاطئُ أو العبثُ يوقفُ الاختبارَ هنا.
4. **الاستعادة:** فكٌّ ثانٍ في الأنبوبِ إلى `offsite-restore-drill.sh` على الخادم، ومعه البيانُ وتوقيعُه. فلا نصَّ مفكوكاً على قرصِ اللابتوب. والخادمُ:
   1. يتحقّقُ من التوقيعِ ثانيةً، ويستقبلُ الأرشيفَ في مجلّدٍ مؤقّت.
   2. يفحصُ الأرشيفَ قبلَ فكِّه: قائمةُ أسماءٍ مسموحة، ولا مساراتٍ مطلقةً أو `..`، ولا روابطَ رمزيّةً أو صلبة، ولا أجهزةَ، ولا ملفّاتٍ زائدةً أو مكرّرة.
   3. يفكُّه، ويطابقُ sha256 لـ`MANIFEST.sha256` بالقيمةِ الموقَّعة، ثمّ `sha256sum -c --strict`.
   4. يستعيدُ قاعدةَ التطبيقِ في حاويةِ postgis معزولة (`--network none`)، ويقارنُ كلَّ جدولٍ **بلقطةِ الصفوفِ في النسخةِ نفسِها**: العددُ وmd5 للمحتوى.
   5. المخزن: `storage-restore-drill.sh` على المستعاد بالمقارنةِ نفسِها، ثمّ sha256 لكلِّ كائن.
   6. الإعداد: يفحصُ قائمةَ الملفّات، ويطابقُها sha256 مقابلَ الحيّ للعلمِ فقط، دونَ طباعةِ أيِّ قيمة.

| النتيجة | الشرط |
|---|---|
| `offsite-drill-PASS` | كلُّ ما سبقَ نجح، وكلُّ جدولٍ يطابقُ لقطتَه تماماً |
| `offsite-drill-FAIL stage=<…>` | أيُّ فشلٍ أو اختلافٍ في العددِ أو المحتوى أو الجداول. **لا يُتجاوَزُ اختلافٌ غيرُ مفسَّر** |
| `INCONCLUSIVE` (رمز 3) | النسخةُ لا تحوي `.rowstats` (أقدمُ من ADR 0298). لا تُعَدُّ نجاحاً |

- الفرقُ بينَ النسخةِ والإنتاجِ الحيِّ اليوم (`drift-info`) يُطبَعُ للعلمِ فقط. فالإنتاجُ يتغيّرُ بعدَ النسخ، وهذا لا يدلُّ على خطأ.
- يُحفَظُ السجلُّ (بلا أسرار) في المجلّدِ الحاليّ. وتُحذَفُ الحاوياتُ والمجلّداتُ المؤقّتةُ على الجانبين في كلِّ حال، نجاحاً أو فشلاً.

## الاستعادةُ الحقيقيّة (كارثة: الخادمُ ضاع)

**ما يلزم:**

- لابتوبٌ فيه `~/.wasla/wasla-backup.agekey` و`~/.wasla/allowed_signers` (أو نسختُهما المحفوظةُ خارجَ الإنترنت)، وage وOpenSSH.
- الدخولُ إلى حسابِ Google الذي فيه `WASLA-Backups`.
- خادمٌ جديدٌ (Ubuntu) فيه Docker وCompose، وsudo.

**أ) على اللابتوب: التحقّقُ ثمّ الفكّ**

1. نزّلْ من Drive عبرَ المتصفّحِ ملفّاتِ نسخةٍ واحدةٍ الثلاثة إلى مجلّدٍ فارغ: `wasla-<TS>.tar.age` و`wasla-<TS>.manifest` و`wasla-<TS>.manifest.sig`. والأحدثُ في `daily/` عادةً.
2. تحقّقْ من المصدر:
   ```bash
   ssh-keygen -Y verify -f ~/.wasla/allowed_signers -I wasla-backup -n wasla-offsite-backup \
     -s wasla-<TS>.manifest.sig < wasla-<TS>.manifest
   ```
   يجبُ أن يطبعَ `Good "wasla-offsite-backup" signature`. وغيرُه ⇒ توقّفْ، فالملفّاتُ ليست من خادمِك أو عُدِّلت.
3. قارنْ `sha256sum wasla-<TS>.tar.age` (على macOS: `shasum -a 256`) بسطرِ `ciphertext_sha256=` في البيان. يجبُ أن يتطابقا حرفاً حرفاً.
4. فكَّ التشفير: `age -d -i ~/.wasla/wasla-backup.agekey -o wasla.tar wasla-<TS>.tar.age`.
   - **`wasla.tar` غيرُ مشفّر، وفيه كلُّ البياناتِ وأسرارُ التشغيل.** لا تضعْه في Drive أو أيِّ مزامنة، واحذفْه بعدَ الخطوة «ب-1».

**ب) على الخادمِ الجديد**

1. **الملفّ:**
   - انقلْه: `scp wasla.tar <الخادم>:/tmp/`. ثمّ على الخادم:
     ```bash
     sudo install -d -m 700 /var/backups/wasla/restore && cd /var/backups/wasla/restore
     sudo tar -tvf /tmp/wasla.tar      # افحصِ القائمة: أسماءٌ مسطّحةٌ فقط، لا / ولا .. ولا روابط
     sudo tar -xf /tmp/wasla.tar && sudo rm /tmp/wasla.tar
     sudo sha256sum -c --strict MANIFEST.sha256
     sha256sum MANIFEST.sha256         # يساوي inner_manifest_sha256= في البيان
     ```
   - احذفْ `wasla.tar` من اللابتوب.
2. **الإعداد:**
   - `sudo tar -C / -xzf config-<TS>.tgz`، فيعيدُ `/etc/wasla/*` و`/opt/wasla/{.env,compose.yml,haproxy.cfg}`.
   - ثمّ `sudo chmod 700 /etc/wasla && sudo chmod 600 /etc/wasla/*`.
3. **الشيفرةُ والصور:**
   - `sudo git clone https://github.com/uxxxug/ceezr /opt/wasla/src`، ثمّ `sudo git -C /opt/wasla/src checkout <TAG>`، والقيمةُ في سطرِ `TAG=` بـ`/opt/wasla/.env`.
   - البوابة: `compose.yml` يبنيها من `/opt/wasla/src` (`docker/Dockerfile.gateway`) بالوسمِ `wasla/gateway:${TAG}`.
   - الوسيطُ لـRedis: أساسُه من الالتزامِ `099c1076`، وفوقَه تعديلُ النشرِ المحفوظُ في المستودع.
     ```bash
     sudo git -C /opt/wasla/src worktree add /tmp/shim-099c1076 099c1076
     sudo docker build -t wasla/upstash-rest-shim:099c1076-base /tmp/shim-099c1076/docker/upstash-rest-shim
     sudo git -C /opt/wasla/src worktree remove /tmp/shim-099c1076
     sudo install -D -m 644 /opt/wasla/src/deploy/casaos/shim-overlay/Dockerfile /opt/wasla/shim-overlay/Dockerfile
     ```
     ثمّ يبني `compose.yml` الصورةَ النهائيّةَ من `/opt/wasla/shim-overlay` بالوسمِ الذي فيه.
   - Mini App: تُبنى في حاويةِ Bun بالإصدارِ الذي يستعملُه المستودع، فلا يلزمُ Bun على الخادم.
     ```bash
     sudo install -m 644 /opt/wasla/src/deploy/casaos/miniapp-nginx.conf /opt/wasla/miniapp-nginx.conf
     sudo docker run --rm -v /opt/wasla/src:/src -w /src -e VITE_WASLAH_API_BASE= oven/bun:1.4.2 \
       sh -c 'bun install --frozen-lockfile && bun run --cwd apps/miniapp build'
     sudo mkdir -p /opt/wasla/miniapp/releases/<TAG>
     sudo cp -a /opt/wasla/src/apps/miniapp/dist/. /opt/wasla/miniapp/releases/<TAG>/
     sudo ln -sfn /opt/wasla/miniapp/releases/<TAG> /opt/wasla/miniapp/current
     ```
   - السكربتات: كما في «التثبيتُ على الخادم» أعلاه، من `/opt/wasla/src/deploy/casaos/` (ومفتاحُ توقيعٍ جديدٌ يُنشأُ عندَ الربط).
4. **قاعدةُ التطبيق:**
   - `sudo docker compose -f /opt/wasla/compose.yml up -d db`.
   - `sudo docker exec wasla-db-1 createdb -U postgres -T template0 waslah`. إن كانت موجودةً فتخطَّ هذا السطر.
   - `sudo docker exec -i wasla-db-1 pg_restore -U postgres -d waslah --clean --if-exists < waslah-<TS>.dump`.
5. **المخزن:**
   - `sudo docker compose -f /opt/wasla/compose.yml up -d storage-db`.
   - الأدوار: `grep -vE '^(CREATE|ALTER) ROLE postgres( |;)' storage-roles-<TS>.sql | sudo docker exec -i wasla-storage-db-1 psql -U postgres`.
   - القاعدة: `sudo docker exec -i wasla-storage-db-1 pg_restore -U postgres -d storage --exit-on-error < storage-db-<TS>.dump`.
   - البايتات: `sudo docker compose -f /opt/wasla/compose.yml run --rm --no-deps --entrypoint sh storage -c 'tar -C /var/lib/storage -xf -' < storage-files-<TS>.tar`. لن تُستعادَ وسائطُ محادثةِ الطلبِ (مستبعَدةٌ من الأرشيفِ منذَ WR-40) — صفوفُها في `waslah` قد تُوجَدُ حديثةً نسبيًّا والمكنسةُ الدوريّةُ تحذفُ ما تجاوزَ الاستبقاءَ، والملفُّ المفقودُ عندَ قراءتِه لا يكسرُ شيئًا.
6. **التشغيلُ والتحقّق:**
   - `sudo docker compose -f /opt/wasla/compose.yml up -d`.
   - ثبّتْ وحداتِ `deploy/casaos/tunnel/` ومؤقّتَ النسخ (`deploy/casaos/README.md`).
   - `curl -s 127.0.0.1:8080/ready` يجبُ أن يُرجعَ جاهزيّة.
   - بعدَ أوّلِ نسخةٍ محلّيّةٍ جديدة: `sudo /opt/wasla/storage-restore-drill.sh`.
   - احذفْ `/var/backups/wasla/restore` بعدَ التأكّد.
7. **إعادةُ الربط:**
   - للخادمِ الجديدِ مفتاحُ SSH جديد. اقرأْ بصمتَه من شاشتِه: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. ثمّ يحدّثُ المهندسُ المرجعَ في `wasla-laptop-lib.sh` ويبني حقيبةً جديدة. احذفْ `~/.wasla/known_hosts` القديمَ عن قصد.
   - وللخادمِ الجديدِ مفتاحُ توقيعٍ جديد. احفظْ سطرَ القديمِ من `~/.wasla/allowed_signers` (ليس سرّاً)، فالنسخُ القديمةُ تُتحقَّقُ به. ثمّ احذفِ الملفَّ عن قصد.
   - شغّلْ `wasla-offsite-connect.sh` بمفتاحِ age نفسِه، فلا يُنشأُ آخر. ثمّ `wasla-offsite-first-upload.sh` ثمّ `wasla-offsite-enable-nightly.sh` (المراحلُ ب وج).
   - أعدْ توجيهَ نفقِ Cloudflare المسمّى إلى الخادمِ الجديد.

**تغييرُ حسابِ Google (ADR 0301):** لا يتغيّرُ حسابُ الوجهةِ إلّا بهذا الترتيب: `--disable` (`DISABLE`) ← `wasla-offsite-connect.sh` (`RELINK`) ← أوّلُ رفع (`UPLOAD`) ← التفعيل (`ENABLE`). و`--link` مرفوضٌ والليليُّ مفعَّل. وإن تغيّرَ `rclone.conf` بأيِّ طريقٍ آخر يتوقّفُ الليليُّ بـ`credential_changed` ولا يرفعُ إلى الحسابِ الجديد.
- **قيدٌ باقٍ:** إن أصدرَ Google يوماً `refresh_token` جديداً تتغيّرُ البصمة، فيتوقّفُ الليليُّ بـ`credential_changed` ظاهراً في السجلّ، ويلزمُ ربطٌ جديدٌ بالترتيبِ أعلاه.

## الإيقافُ والتراجع

- **إيقافُ الرفعِ مع بقاءِ النسخِ المحلّيّ:** `bash wasla-offsite-enable-nightly.sh --disable` من اللابتوب، أو `sudo /opt/wasla/offsite-setup.sh --disable-nightly` على الخادم. يحذفُ `offsite.env`، فلا يستدعي `backup.sh` الرفع. ولا يمسُّ هذا النسخَ المحلّيّةَ ولا سياسةَ الاحتفاظِ بها، ولا الربط.
- **إلغاءُ الربطِ على الخادم:** بعدَ الإيقاف: `sudo rm /etc/wasla/rclone.conf* /etc/wasla/offsite-pending.env /etc/wasla/offsite-first-ok`.
- **سحبُ الوصول:** في <https://myaccount.google.com/permissions> احذفْ `wasla-backup`، أو احذفِ العميلَ من Google Cloud.
- **الاشتباهُ في تسرّبِ الرمز:** اسحبِ الوصول، ثمّ أعدِ الربط.
- **تدويرُ مفتاحِ age:**
  1. أنشئْ مفتاحاً جديداً، ثمّ بالترتيب: `wasla-offsite-enable-nightly.sh --disable`، فإعادةُ الربط، فأوّلُ رفع، فالتفعيل. إعادةُ الربطِ مرفوضةٌ ما دامَ الليليُّ مفعَّلاً (ADR 0301).
  2. **احتفظْ بالقديم** ما دامت في Drive نسخٌ مشفّرةٌ به، أي 12 شهراً للشهريّة.
