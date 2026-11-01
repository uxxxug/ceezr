# النسخةُ خارجَ الموقع: age ← Google Drive (ADR 0297)

دليلُ تشغيلٍ واستعادة. **لا يحوي أيَّ سرّ**، ويصلحُ للحفظِ في أيِّ مكان، ومنه Drive نفسُه.

## الفكرة في ثلاثةِ أسطر

- كلَّ ليلةٍ (03:30 UTC) يصنعُ `backup.sh` النسخةَ المحلّيّة. ثمّ يجمعُها `offsite-backup.sh` في أرشيفٍ واحد، ويشفّرُه بـage **بالمفتاحِ العامّ وحدَه**، ويرفعُه إلى مجلّد `WASLA-Backups` في Google Drive الخاصّ بالمالك.
- المفتاحُ الخاصُّ على لابتوبِ المالكِ فقط. فالخادمُ لا يستطيعُ فكَّ ما يرفعُه، ومن يصلُ إلى Drive لا يرى إلّا ملفّاتٍ مشفّرة.
- الاستعادةُ تُثبَتُ بتمرينٍ فعليّ:
  1. الخادمُ ينزّلُ الملفَّ من Drive.
  2. اللابتوبُ يفكُّه.
  3. الخادمُ يستعيدُه في حاوياتٍ معزولةٍ ويقارنُه بالإنتاج.

## ما في كلِّ نسخة (`wasla-<TS>.tar.age`)

| الملفّ | المحتوى |
|---|---|
| `waslah-<TS>.dump` (+`.sha256`) | قاعدةُ التطبيق، `pg_dump -Fc` |
| `storage-roles-<TS>.sql` | أدوارُ قاعدةِ المخزن (فيها بصماتُ كلماتِ مرورٍ؛ لذلك الأرشيفُ مشفّر) |
| `storage-db-<TS>.dump` (+`.sha256`) | قاعدةُ المخزنِ الوصفيّة |
| `storage-files-<TS>.tar` (+`.sha256`) و`storage-files-<TS>.sha256` | بايتاتُ وثائقِ السائقين، وبيانُ sha256 لكلِّ ملفّ |
| `config-<TS>.tgz` | `/etc/wasla/*.env` و`redis.conf` و`/opt/wasla/{.env,compose.yml,haproxy.cfg}` (أسرارُ التشغيل) |
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
- الحجم اليوم نحو 2.6 MB للنسخة، فالمجموعُ أقلُّ من 100 MB.

## التحقّقُ بعدَ كلِّ رفع (آليّ)

1. قبلَ التشفير: sha256 لكلِّ تفريغٍ يطابقُ ملفَّه.
2. بعدَه: الملفُّ يبدأُ بترويسة `age-encryption.org/v1`، وإلّا لا يُرفَع.
3. بعدَ الرفع:
   - md5 الذي يحسبُه Drive يساوي md5 المحلّيّ.
   - ثمّ يُنزَّلُ الملفُّ كاملاً ويُقارَنُ sha256.
4. النتيجةُ في `journalctl -t wasla-offsite`، وفي `/var/backups/wasla/offsite/last-ok.json`.
5. فشلُ أيِّ خطوةٍ يُفشِلُ `wasla-backup.service`. للفحص: `systemctl status wasla-backup`.

age يشفّرُ تشفيراً موثَّقاً، فأيُّ تلاعبٍ بالملفِّ يُكتشَفُ عندَ الفكّ (`failed to decrypt and authenticate payload chunk`). قيسَ ذلك على الخادمِ في 2026-11-01.

## الإعدادُ لمرّةٍ واحدة (المالك)

### أ) عميلُ OAuth خاصٌّ في Google Cloud (نحو 5 دقائق)

عميلُ rclone المشترَكُ يُسحَبُ خلالَ 2026، فيلزمُ عميلٌ باسمِ المالك.

1. افتح <https://console.cloud.google.com/> بحسابِ Google الذي ستُحفَظُ فيه النسخ، وأنشئْ مشروعاً، مثلاً `wasla-backup`.
2. **APIs & Services ← Library ← Google Drive API ← Enable**.
3. **Google Auth Platform ← Get started**:
   - اسمُ التطبيق `wasla-backup`، وبريدُك.
   - **Audience: External**.
4. **Audience ← Publish app** (In production).
   - **ضروريّ**: في وضعِ Testing ينتهي الرمزُ بعدَ 7 أيّامٍ فيتوقّفُ النسخ.
   - النطاقُ `drive.file` غيرُ حسّاس، فلا يحتاجُ مراجعةً من Google.
5. **Clients ← Create client ← Application type: Desktop app** ← Create. انسخ **Client ID** و**Client secret**، ولا ترسلْهما في أيِّ محادثة.

### ب) أدواتُ اللابتوب

- macOS: `brew install age rclone cloudflared`
- Linux: `sudo apt install age rclone`، وcloudflared من حزمةِ Cloudflare الرسميّة.
- Windows: `winget install FiloSottile.age Rclone.Rclone Cloudflare.cloudflared Git.Git`، ثمّ نفّذِ الأوامرَ في **Git Bash**.

أضفْ إلى `~/.ssh/config`. الملفُّ `wasla_deploy_ed25519` هو مفتاحُ SSH الذي سُلِّمَ لك:

```
Host wasla
  HostName ssh.waslareev.dpdns.org
  User wasla
  IdentityFile ~/.ssh/wasla_deploy_ed25519
  ProxyCommand cloudflared access ssh --hostname %h
```

ثمّ تأكّدْ بـ`ssh wasla true`.

### ج) الربطُ وأوّلُ نسخة

```bash
bash deploy/casaos/laptop/wasla-offsite-connect.sh
```

- يُنشئُ المفتاحَ الخاصَّ في `~/.wasla/wasla-backup.agekey` إن غاب، ويطبعُ العامّ.
- يسألُ عن Client ID وsecret، ويفتحُ المتصفّحَ للموافقة.
- يمرّرُ كلَّ شيءٍ عبرَ SSH إلى `/opt/wasla/offsite-setup.sh`، ثمّ يرفعُ أوّلَ نسخة.

**احفظْ نسخةً من `wasla-backup.agekey` خارجَ الإنترنت** (مدير كلمات المرور أو USB)، لا في Drive. ضياعُه يعني أنّ كلَّ النسخِ غيرُ قابلةٍ للفكّ.

## اختبارُ الاستعادةِ الفعليّ (المالك، كلَّ شهرٍ على الأقلّ)

```bash
bash deploy/casaos/laptop/wasla-offsite-restore-test.sh            # أحدثُ نسخة
bash deploy/casaos/laptop/wasla-offsite-restore-test.sh --list     # القائمة
bash deploy/casaos/laptop/wasla-offsite-restore-test.sh monthly/wasla-<TS>.tar.age
```

ما يجري:

1. `offsite-fetch.sh` ينزّلُ الملفَّ المشفّرَ من Drive، ويتحقّقُ من md5 الذي يحفظُه Drive.
2. `age -d` يفكُّه على اللابتوب.
3. `offsite-restore-drill.sh` على الخادمِ يتحقّقُ ويستعيدُ ويقارن:
   - `MANIFEST.sha256`.
   - قاعدةُ التطبيقِ في حاويةِ postgis معزولةٍ (`--network none`): عددُ الجداولِ والدوالّ، والعددُ الدقيقُ للصفوفِ في كلِّ جدولٍ مقابلَ الإنتاج.
   - المخزن: `storage-restore-drill.sh` على المستعاد، وsha256 لكلِّ كائنٍ مقابلَ الإنتاج.
   - الإعداد: sha256 لكلِّ ملفٍّ مقابلَ الحيّ، دونَ طباعةِ أيِّ قيمة.

النجاحُ يُطبَعُ `offsite-drill-PASS`، ويُحفَظُ السجلُّ (بلا أسرار) بجانبِ السكربت. ثمّ تُحذَفُ الحاوياتُ والمجلّدُ المؤقّت.

## الاستعادةُ الحقيقيّة (كارثة: الخادمُ ضاع)

على خادمٍ جديدٍ فيه Docker:

1. **الملفّ:**
   - نزّلْ `wasla-<TS>.tar.age` من Drive عبرَ المتصفّح.
   - على اللابتوب: `age -d -i ~/.wasla/wasla-backup.agekey -o wasla.tar wasla-<TS>.tar.age`.
   - انقلْ `wasla.tar` إلى الخادمِ الجديدِ عبرَ `scp`، وفكَّه بـ`tar -xf wasla.tar` ثمّ `sha256sum -c MANIFEST.sha256`.
2. **الإعداد:**
   - `sudo tar -C / -xzf config-<TS>.tgz`، فيعيدُ `/etc/wasla/*` و`/opt/wasla/{.env,compose.yml,haproxy.cfg}`.
   - ثمّ `sudo chmod 700 /etc/wasla && sudo chmod 600 /etc/wasla/*`.
3. **الشيفرة:**
   - `git clone` المستودعِ إلى `/opt/wasla/src`، ثمّ `git checkout` إلى الالتزامِ الذي في `TAG` بـ`/opt/wasla/.env`.
   - ابنِ الصورة: `docker build -f docker/Dockerfile.gateway -t wasla/gateway:$TAG .`
   - وابنِ صورةَ `docker/upstash-rest-shim` بالوسمِ الذي في `compose.yml`.
   - وانسخْ `deploy/casaos/*.sh` إلى `/opt/wasla/` (700 root).
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
   - شغّلْ `wasla-offsite-connect.sh` من جديد، بالمفتاحِ نفسِه فلا يُنشأُ آخر.
   - أعدْ توجيهَ نفقِ Cloudflare المسمّى إلى الخادمِ الجديد.

## الإيقافُ والتراجع

- إيقافُ الرفعِ مع بقاءِ النسخِ المحلّيّ: `sudo rm /etc/wasla/offsite.env`، فيتخطّاه `backup.sh` (`offsite-skip`).
- سحبُ الوصول: في <https://myaccount.google.com/permissions> احذفْ `wasla-backup`، أو احذفْ العميلَ من Google Cloud.
- تدويرُ مفتاحِ age:
  1. أنشئْ مفتاحاً جديداً وأعدِ الربط.
  2. **احتفظْ بالقديم** ما دامت في Drive نسخٌ مشفّرةٌ به، أي 12 شهراً للشهريّة.
