# النسخةُ خارجَ الموقع: age ← Google Drive (ADR 0297 · ADR 0298)

دليلُ تشغيلٍ واستعادة. **لا يحوي أيَّ سرّ**، ويصلحُ للحفظِ في أيِّ مكان، ومنه Drive نفسُه.

## الفكرة في ثلاثةِ أسطر

- كلَّ ليلةٍ (03:30 UTC) يصنعُ `backup.sh` النسخةَ المحلّيّة. ثمّ يجمعُها `offsite-backup.sh` في أرشيفٍ واحد، ويشفّرُه بـage **بالمفتاحِ العامّ وحدَه**، ويرفعُه إلى مجلّد `WASLA-Backups` في Google Drive الخاصّ بالمالك.
- المفتاحُ الخاصُّ على لابتوبِ المالكِ فقط. فالخادمُ لا يستطيعُ فكَّ ما يرفعُه، ومن يصلُ إلى Drive لا يرى إلّا ملفّاتٍ مشفّرة.
- الاستعادةُ تُثبَتُ بتمرينٍ فعليّ:
  1. الخادمُ ينزّلُ الملفَّ من Drive.
  2. اللابتوبُ يفكُّه.
  3. الخادمُ يستعيدُه في حاوياتٍ معزولةٍ ويقارنُه ## ما في كلِّ نسخة

في Drive ثلاثةُ ملفّاتٍ لكلِّ نسخة:

| الملفّ | المحتوى |
|---|---|
| `wasla-<TS>.tar.age` | الأرشيفُ مشفّراً بـage للمفتاحِ العامِّ وحدَه |
| `wasla-<TS>.manifest` | بيانٌ بلا بيانات: الاسم والطابع وحجمُ النصِّ المشفّرِ وsha256 له، وsha256 لـ`MANIFEST.sha256` الداخليّ، والمستلم |
| `wasla-<TS>.manifest.sig` | توقيعُ البيانِ بمفتاحِ الخادم (`ssh-keygen -Y sign`، الهويّة `wasla-backup`، النطاق `wasla-offsite-backup`) |

داخلَ الأرشيف:

| الملفّ | المحتوى |
|---|---|
| `waslah-<TS>.dump` (+`.sha256`) | قاعدةُ التطبيق، `pg_dump -Fc` من لقطةٍ (`REPEATABLE READ`) |
| `waslah-<TS>.rowstats` | من **اللقطةِ نفسِها**: لكلِّ جدولٍ عددُ صفوفِه وmd5 لمحتواه مرتَّباً |
| `storage-roles-<TS>.sql` | أدوارُ قاعدةِ المخزن (فيها بصماتُ كلماتِ مرورٍ؛ لذلك الأرشيفُ مشفّر) |
| `storage-db-<TS>.dump` (+`.sha256`) و`storage-db-<TS>.rowstats` | قاعدةُ المخزنِ الوصفيّة ولقطةُ صفوفِها |
| `storage-files-<TS>.tar` (+`.sha256`) و`storage-files-<TS>.sha256` | بايتاتُ وثائقِ السائقين، وبيانُ sha256 لكلِّ ملفّ |
| `config-<TS>.tgz` | `/etc/wasla/*.env` و`redis.conf` و`/opt/wasla/{.env,compose.yml,haproxy.cfg}` (أسرارُ التشغيل) |
| `MANIFEST.sha256` | sha256 لكلِّ ما سبق، وبصمتُه نفسُها في البيانِ الموقَّع |

لا تدخلُ النسخةَ هذه الملفّات:

- `rclone.conf`، وفيه رمزُ Drive. يُعادُ إنشاؤه بـ`wasla-offsite-connect.sh`.
- مفتاحُ age الخاصّ (على اللابتوبِ فقط)، ومفتاحُ التوقيعِ الخاصّ (`/etc/wasla/backup-signing.key` على الخادمِ فقط).

لتشغيل) |
| `MANIFEST.sha256` | sha256 لكلِّ ما سبق |

لا تدخلُ النسخةَ هذه الملفّات:

- `rclone.conf`، وفيه رمزُ Drive. يُعادُ إنشاؤه بـ`wasla-offsite-connect.sh`.
- المفتاحُ الخاصّ.

## الاحتفاظ

| المجلّد في Drive | متى | يبقى |
|---|---|---|
| `WASLA-Backups/daily/` | كلَّ ليلة | 14 يوماً |
| `WASLA-Backups/weekly/` | الجمعة (توقيتُ الرياض)، وأوّلُ رفعٍ على الإطلاق | 8 أسابيع |
| `WASLA-Backups/monthly/` | أوّلُ كلِّ شهر، وأوّلُ رفعٍ على الإطلاق | 12 شهراً |

- المحذوفُ يذهبُ إلى سلّةِ Drive، وتُفرَّغُ وحدَها بعدَ 30 يوماً.
- على الخادم: النسخُ المحلّيّةُ غيرُ المشفّرةِ 14 يوماً في `/var/backups/wasla` (700 root). ومعها آخرُ 3 ملفّاتٍ مشفّرةٍ في `/var/backups/wasla/offsite`.
- الملفّاتُ الثلاثةُ تُحفَظُ وتُحذَفُ معاً في كلِّ مستوى.
- الحجم اليوم نحو 2.6 MB للنسخة، فالمجموعُ أقلُّ من 100 MB.

## التحقّقُ بعدَ كلِّ رفع (آليّ)

1. قبلَ التشفير: sha256 لكلِّ تفريغٍ يطابقُ ملفَّه.
2. بعدَه: الملفُّ يبدأُ بترويسة `age-encryption.org/v1`، وإلّا لا يُرفَع.
3. يُوقَّعُ البيان. وبلا مفتاحِ توقيعٍ يرفضُ الرفعَ كلَّه.
4. بعدَ رفعِ كلِّ ملفٍّ من الثلاثة:
   - md5 الذي يحسبُه Drive يساوي md5 المحلّيّ.
   - ثمّ يُنزَّلُ الملفُّ كاملاً ويُقارَنُ sha256.
5. أيُّ فشلٍ يُسجِّلُ `offsite-fail stage=<الخطوة>`، ويحذفُ ما رُفِعَ في هذا التشغيل، فلا تبقى نسخةٌ نصفُها في Drive.
6. النتيجةُ في `journalctl -t wasla-offsite`، وفي `/var/backups/wasla/offsite/last-ok.json`.
7. فشلُ أيِّ خطوةٍ يُفشِلُ `wasla-backup.service`. للفحص: `systemctl status wasla-backup`.

age يشفّرُ تشفيراً موثَّقاً، فأيُّ تلاعبٍ بالنصِّ المشفّرِ يُكتشَفُ عندَ الفكّ. والتوقيعُ يكشفُ قبلَ ذلك تبديلَ الملفِّ كلِّه بملفٍّ آخرَ مشفّرٍ للمفتاحِ العامِّ نفسِه، وهو ما لا يكشفُه age وحدَه (ADR 0298).

## الإعدادُ لمرّةٍ واحدة (المالك)

### أ) عميلُ OAuth خاصٌّ في Google Cloud (نحو 5 دقائق، **بعدَ اعتمادِ هذه الخطوات**)

عميلُ rclone المشترَكُ يُسحَبُ خلالَ 2026، فيلزمُ عميلٌ باسمِ المالك.

1. افتح <https://console.cloud.google.com/> بحسابِ Google الذي ستُحفَظُ فيه النسخ، وأنشئْ مشروعاً، مثلاً `wasla-backup`.
2. **APIs & Services ← Library ← Google Drive API ← Enable**.
3. **Google Auth Platform ← Get started**:
   - اسمُ التطبيق `wasla-backup`، وبريدُك. **لا تضعْ شعاراً.**
   - **Audience: External**.
4. **Data Access ← Add scopes**: `https://www.googleapis.com/auth/drive.file` وحدَه. يصنّفُه Google نطاقاً **غيرَ حسّاسٍ** وموصىً به ([Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)). يرى التطبيقُ به ما أنشأه هو فقط، لا بقيّةَ ملفّاتِ Drive.
5. **Audience ← Publish app** (In production). السبب والحدود:
   - **وضعُ Testing**: مع جمهورِ External ونطاقٍ غيرِ الاسمِ والبريدِ والملفِّ الشخصيّ، ينتهي رمزُ التحديثِ بعدَ **7 أيّام** ([Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)). وهذا ينطبقُ هنا لأنّ `drive.file` خارجَ تلك الثلاثة، فيتوقّفُ الرفعُ الليليُّ بعدَ أسبوع.
   - **النشرُ لا يعني التحقّقَ من Google.** التطبيقُ للاستعمالِ الشخصيّ (أقلُّ من 100 مستخدم) يعملُ دونَ تحقّق. وتظهرُ عندَ الموافقةِ شاشةُ «Google hasn't verified this app» تتجاوزُها بـ**Advanced ← Go to wasla-backup** ([When is verification not needed](https://support.google.com/cloud/answer/13464323)).
   - إن طلبَ Google لاحقاً «brand verification» ([Verification requirements](https://support.google.com/cloud/answer/13464321)) فلا تقدّمْ طلباً. أخبرْ المهندس، فقد تتغيّرُ القواعد.
6. **Clients ← Create client ← Application type: Desktop app** ← Create. انسخ **Client ID** و**Client secret** إلى مديرِ كلماتِ المرور. لا ترسلْهما في أيِّ محادثةٍ أو بريد.

### ب) أدواتُ اللابتوب وSSH

في حقيبةِ اللابتوب (`wasla-offsite-kit.zip`، تُبنى بـ`bash deploy/casaos/laptop/build-kit.sh OUT.zip`) ملفُّ `README-AR.md`. فيه التثبيتُ على macOS وLinux وWindows (Git Bash)، وإعدادُ `~/.ssh/config`، والتحقّقُ من `SHA256SUMS`.

### ج) الربطُ وأوّلُ نسخة

من داخلِ مجلّدِ الحقيبة (أو `deploy/casaos/laptop/` في المستودع):

```bash
bash wasla-offsite-connect.sh
```

1. يُنشئُ المفتاحَ الخاصَّ في `~/.wasla/wasla-backup.agekey` إن غاب، ويطبعُ العامّ.
2. يطلبُ من الخادمِ مفتاحَ التوقيعِ العامَّ (يُنشأُ هناك إن غاب)، ويثبّتُه في `~/.wasla/allowed_signers`. وإن تغيّرَ لاحقاً يتوقّفُ ولا يستبدلُه.
3. يسألُ عن Client ID، ثمّ عن secret **دونَ صدى**. ويكتبُهما بأمرٍ داخليٍّ في ملفٍّ مؤقّتٍ (600، داخلَ مجلّدٍ 700).
4. `rclone config reconnect` يفتحُ المتصفّحَ للموافقة، ويكتبُ الرمزَ في الملفِّ نفسِه.
5. يرسلُ القسمَ إلى `offsite-setup.sh --install` عبرَ **stdin** لـSSH. الخادمُ يتحقّقُ من صيغتِه، ويكتبُه 600، وينشئُ المجلّدَ في Drive، ثمّ يرفعُ أوّلَ نسخة. ولا يُكتَبُ `offsite.env` إلّا بعدَ نجاحِ الوصولِ إلى Drive.
6. يُحذَفُ الملفُّ المؤقّتُ عندَ الخروج.

**حدودُ حمايةِ الأسرار:**

- لا يظهرُ client_secret ولا الرمزُ في وسائطِ أيِّ عمليّةٍ (`/proc/*/cmdline`)، على اللابتوبِ ولا على الخادم. اختُبِرَ ذلك بعيّناتٍ متكرّرةٍ أثناءَ التشغيل، مع ضابطٍ إيجابيّ (`docs/evidence/production/WR-27-offsite-hardening-selftest-20261101.md`).
- **قيدٌ باقٍ:** يبقى الرمزُ والسرُّ نصّاً في ملفٍّ (`/etc/wasla/rclone.conf`، 600 root). وهذا تصميمُ rclone: لا يقبلُ الرمزَ إلّا من ملفِّ إعدادٍ أو وسيطٍ أو متغيّرِ بيئة، واخترنا الملف. تشفيرُ rclone لملفِّه (`RCLONE_CONFIG_PASS`) لا يضيفُ حمايةً حقيقيّةً على خادمٍ يعملُ بلا مراقبة، لأنّ كلمةَ مرورِه يجبُ أن تكونَ على الخادمِ نفسِه.
- من يملكُ root على الخادمِ يصلُ إلى الرمز، فيقرأُ ما أنشأه التطبيقُ في Drive أو يحذفُه، ولا يرى غيرَه (`drive.file`). لكنّه لا يستطيعُ فكَّ أيِّ نسخة. والعلاجُ سحبُ الوصول (انظر «الإيقافُ والتراجع»).

**احفظْ نسخةً من `wasla-backup.agekey` خارجَ الإنترنت** (مدير كلمات المرور أو USB)، لا في Drive. ضياعُه يعني أنّ كلَّ النسخِ غيرُ قابلةٍ للفكّ.

## اختبارُ الاستعادةِ الفعليّ (المالك، كلَّ شهرٍ على الأقلّ)

```bash
bash wasla-offsite-restore-test.sh            # أحدثُ نسخةٍ يوميّة
bash wasla-offsite-restore-test.sh --list     # القائمة
bash wasla-offsite-restore-test.sh monthly/wasla-<TS>.tar.age
```

الترتيب، ولا يصلُ إلى الخادمِ شيءٌ مفكوكٌ قبلَ نجاحِ كلِّ ما قبلَه:

1. **المصدر (اللابتوب):**
   - `offsite-fetch.sh` ينزّلُ البيانَ وتوقيعَه إلى ملفٍّ مؤقّتٍ كامل، ويطابقُ md5 الذي يحفظُه Drive.
   - `ssh-keygen -Y verify` بالمفتاحِ المثبَّت. ثمّ الاسمُ والصيغة، وأنّ المستلمَ مفتاحُك.
2. **النصُّ المشفّر (اللابتوب):** تنزيلٌ كاملٌ إلى ملفٍّ مؤقّت (700)، ثمّ الحجمُ وsha256 مقابلَ البيانِ الموقَّع، ثمّ ترويسةُ age.
3. **فكٌّ تجريبيٌّ كامل** إلى `/dev/null`. المفتاحُ الخاطئُ أو العبثُ يوقفُ الاختبارَ هنا.
4. **الاستعادة:** فكٌّ ثانٍ في الأنبوبِ إلى `offsite-restore-drill.sh` على الخادم، ومعه البيانُ وتوقيعُه. فلا نصَّ مفكوكاً على قرصِ اللابتوب. والخادمُ:
   1. يتحقّقُ من التوقيعِ ثانيةً، ويستقبلُ الأرشيفَ في مجلّدٍ مؤقّت.
   2. يفحصُ الأرشيفَ قبلَ فكِّه: قائمةُ أسماءٍ مسموحة، ولا مساراتٍ مطلقةً أو `..`، ولا روابطَ رمزيّةً أو صلبة، ولا أجهزةَ ولا ملفّاتٍ زائدةً أو مكرّرة.
   3. يفكُّه، ويطابقُ sha256 لـ`MANIFEST.sha256` بالقيمةِ الموقَّعة، ثمّ `sha256sum -c --strict`.
   4. يستعيدُ قاعدةَ التطبيقِ في حاويةِ postgis معزولة (`--network none`)، ويقارنُ كلَّ جدولٍ **بلقطةِ الصفوفِ في النسخةِ نفسِها**: العددُ وmd5 للمحتوى.
   5. المخزن: `storage-restore-drill.sh` على المستعاد، بالمقارنةِ نفسِها، ثمّ sha256 لكلِّ كائن.
   6. الإعداد: يفحصُ قائمةَ الملفّات، ويطابقُها sha256 مقابلَ الحيّ للعلمِ فقط، دونَ طباعةِ أيِّ قيمة.

| النتيجة | الشرط |
|---|---|
| `offsite-drill-PASS` | كلُّ ما سبقَ نجح، وكلُّ جدولٍ يطابقُ لقطتَه تماماً |
| `offsite-drill-FAIL stage=<…>` | أيُّ فشلٍ أو اختلافٍ في العددِ أو المحتوى أو الجداول. **لا يُتجاوَزُ اختلافٌ غيرُ مفسَّر** |
| `INCONCLUSIVE` (رمز 3) | النسخةُ أقدمُ من ADR 0298 ولا تحوي `.rowstats`. لا تُعَدُّ نجاحاً |

- الفرقُ بينَ النسخةِ والإنتاجِ الحيِّ اليومَ (`drift-info`) يُطبَعُ للعلمِ فقط. فالإنتاجُ يتغيّرُ بعدَ النسخِ، وهذا لا يدلُّ على خطأ.
- يُحفَظُ السجلُّ (بلا أسرار) في المجلّدِ الحاليّ. وتُحذَفُ الحاوياتُ والمجلّداتُ المؤقّتةُ على الجانبين في كلِّ حال، نجاحاً أو فشلاً.

## الاستعادةُ الحقيقيّة (كارثة: الخادمُ ضاع)

على خادمٍ جديدٍ فيه Docker:

1. **الملفّ:**
   - نزّلْ من Drive عبرَ المتصفّحِ الملفّاتِ الثلاثة: `wasla-<TS>.tar.age` و`.manifest` و`.manifest.sig`.
   - تحقّقْ من المصدر: `ssh-keygen -Y verify -f ~/.wasla/allowed_signers -I wasla-backup -n wasla-offsite-backup -s wasla-<TS>.manifest.sig < wasla-<TS>.manifest`، ويجبُ أن يطبعَ `Good "wasla-offsite-backup" signature`.
   - قارنْ `sha256sum wasla-<TS>.tar.age` بسطرِ `ciphertext_sha256` في البيان (`shasum -a 256` على macOS).
   - على اللابتوب: `age -d -i ~/.wasla/wasla-backup.agekey -o wasla.tar wasla-<TS>.tar.age`.
   - انقلْ `wasla.tar` إلى الخادمِ الجديدِ عبرَ `scp`، وفكَّه بـ`tar -xf wasla.tar` ثمّ `sha256sum -c --strict MANIFEST.sha256`. وقارنْ `sha256sum MANIFEST.sha256` بسطرِ `inner_manifest_sha256`.
2. **الإعداد:**
   - `sudo tar -C / -xzf config-<TS>.tgz`، فيعيدُ `/etc/wasla/*` و`/opt/wasla/{.env,compose.yml,haproxy.cfg}`.
   - ثمّ `sudo chmod 700 /etc/wasla && sudo chmod 600 /etc/wasla/*`.
3. **الشيفرة:**
   - `git clone` المستودعِ إلى `/opt/wasla/src`، ثمّ `git checkout` إلى الالتزامِ الذي في `TAG` بـ`/opt/wasla/.env`.
   - ابنِ الصورة: `docker build -f docker/Dockerfile.gateway -t wasla/gateway:$TAG .`
   - وابنِ صورةَ `docker/upstash-rest-shim` بالوسمِ الذي في `compose.yml`.
   - وانسخْ `deploy/casaos/*.sh` و`offsite-lib.sh` و`offsite-tool.py` إلى `/opt/wasla/` (700 root).
4. **قاعدةُ التطبيق:**
   - `docker compose up -d db`، ثمّ `docker exec -i wasla-db-1 pg_restore -U postgres -d waslah --clean --if-exists < waslah-<TS>.dump`.
   - إن لم تكن القاعدةُ موجودةً، أنشئْها أوّلاً بـ`createdb -T template0 waslah`.
5. **المخزن:**
   - `docker compose up -d storage-db`.
   - الأدوار: `grep -vE '^(CREATE|ALTER) ROLE postgres( |;)' storage-roles-<TS>.sql | docker exec -i wasla-storage-db-1 psql -U postgres`.
   - القاعدة: `docker exec -i wasla-storage-db-1 pg_restore -U postgres -d storage --exit-on-error < storage-db-<TS>.dump`.
   - البايتات: `docker compose run --rm --no-deps --entrypoint sh storage -c 'tar -C /var/lib/storage -xf -' < storage-files-<TS>.tar`.
6. **التشغيل:**
   - `docker compose up -d`، ثمّ ثبّتْ وحداتِ `deploy/casaos/tunnel/` ومؤقّتَ النسخ.
   - تحقّقْ بـ`curl -s 127.0.0.1:8080/ready`.
   - ثمّ `sudo /opt/wasla/storage-restore-drill.sh` على أوّلِ نسخةٍ محلّيّةٍ جديدة.
7. **إعادةُ الربط:**
   - الخادمُ الجديدُ ينشئُ مفتاحَ توقيعٍ جديداً. احذفْ `~/.wasla/allowed_signers` عن قصد، ثمّ شغّلْ `wasla-offsite-connect.sh` بمفتاحِ age نفسِه فلا يُنشأُ آخر.
   - النسخُ القديمةُ تبقى قابلةً للتحقّقِ بالمفتاحِ القديم. احفظْ سطرَه قبلَ الحذف (ليس سرّاً).
   - أعدْ توجيهَ نفقِ Cloudflare المسمّى إلى الخادمِ الجديد.

## الإيقافُ والتراجع

- إيقافُ الرفعِ مع بقاءِ النسخِ المحلّيّ: `sudo rm /etc/wasla/offsite.env`، فيتخطّاه `backup.sh` (`offsite-skip`). ولا يمسُّ هذا النسخَ المحلّيّةَ ولا سياسةَ الاحتفاظِ بها.
- الاشتباهُ في تسرّبِ الرمز: اسحبِ الوصولَ (السطرُ التالي)، ثمّ أعدِ الربط.
- سحبُ الوصول: في <https://myaccount.google.com/permissions> احذفْ `wasla-backup`، أو احذفْ العميلَ من Google Cloud.
- تدويرُ مفتاحِ age:
  1. أنشئْ مفتاحاً جديداً وأعدِ الربط.
  2. **احتفظْ بالقديم** ما دامت في Drive نسخٌ مشفّرةٌ به، أي 12 شهراً للشهريّة.
