# حقيبةُ اللابتوب: النسخةُ المشفّرةُ لوصلة خارجَ الموقع

هذه الحقيبةُ **لا تحوي أيَّ سرّ**. تُبنى من المستودعِ بـ`deploy/casaos/laptop/build-kit.sh`، ويُطابَقُ محتواها بـ`SHA256SUMS`.

```
wasla-offsite-kit/
├── README-AR.md                    ← هذا الملفّ: الخطواتُ بالترتيب
├── OFFSITE-BACKUP.md               ← الدليلُ الكامل: ما يجري، والاستعادةُ الحقيقيّة، والتراجع
├── wasla-offsite-connect.sh        ← الربطُ لمرّةٍ واحدة
├── wasla-offsite-restore-test.sh   ← اختبارُ الاستعادةِ الشهريّ
├── wasla-laptop-lib.sh             ← مفتاحُ SSH المرجعيُّ للخادم وفحصُه (يستوردُه السكربتان)
└── SHA256SUMS
```

> **لا تبدأ قبلَ اعتمادِ الخطواتِ النهائيّة.** إنشاءُ عميلِ OAuth في Google Cloud (الخطوة 4) يتمُّ بعدَ موافقتك.

## الخطواتُ بالترتيب

| # | الخطوة | مرّة | أين |
|---|---|---|---|
| 1 | التحقّقُ من الحقيبة | كلَّ تنزيل | اللابتوب |
| 2 | تثبيتُ الأدوات | مرّة | اللابتوب |
| 3 | إعدادُ SSH | مرّة | اللابتوب |
| 4 | عميلُ OAuth | مرّة | Google Cloud (`OFFSITE-BACKUP.md` §أ) |
| 5 | الربط: مفتاحُ الخادم، ثمّ مفتاحُ التوقيع، ثمّ Drive | مرّة | اللابتوب، ومعه **شاشةُ الخادم** أو مخرجاتُ سكربتِ إعدادِه |
| 6 | اختبارُ الاستعادة | شهريّاً | اللابتوب |

## 1) التحقّقُ من الحقيبة

افتحِ الطرفيّةَ داخلَ مجلّد `wasla-offsite-kit`، ثمّ:

| النظام | الأمر |
|---|---|
| Linux، أو Windows (Git Bash) | `sha256sum -c SHA256SUMS` |
| macOS | `shasum -a 256 -c SHA256SUMS` |

يجبُ أن يظهرَ `OK` لكلِّ سطرٍ من الخمسة.

## 2) الأدوات

| النظام | التثبيت |
|---|---|
| macOS | `brew install age rclone cloudflared` |
| Linux (Debian/Ubuntu) | `sudo apt install age rclone openssh-client`، وcloudflared من حزمةِ Cloudflare الرسميّة |
| Windows | `winget install FiloSottile.age Rclone.Rclone Cloudflare.cloudflared Git.Git`، ثمّ افتحْ **Git Bash** من قائمةِ ابدأ |

يلزمُ: `bash` و`age` و`age-keygen` و`rclone` و`ssh` و`ssh-keygen` (من OpenSSH 8.1 فأحدث) و`base64`. والسكربتان يتحقّقان من وجودِها قبلَ أيِّ خطوة.

**ملاحظاتُ Windows (Git Bash):**

- أغلقْ Git Bash وافتحْه من جديدٍ بعدَ `winget`، ليرى الأوامرَ الجديدة. وتأكّدْ بـ`age --version` و`rclone version` و`cloudflared --version`.
- `ssh` و`ssh-keygen` و`base64` و`sha256sum` تأتي مع Git for Windows.
- `~` هو `C:\Users\<اسمك>`، فملفُّ SSH هو `C:\Users\<اسمك>\.ssh\config`، والمفاتيحُ في `C:\Users\<اسمك>\.wasla\`.
- صلاحيّاتُ 600 لا تُطبَّقُ على NTFS كما على Linux، فلا تشاركْ حسابَ Windows مع غيرك.
- السكربتُ يحوّلُ مسارَ ملفِّ rclone المؤقّتِ بـ`cygpath -w` لأنّ rclone برنامجُ Windows أصليّ.
- إن ظهرَ `$'\r': command not found` فالملفّاتُ حُوِّلت إلى CRLF. أعدْ فكَّ الحقيبةِ بأداةِ ZIP العاديّة، لا عبرَ `git clone` مع `autocrlf`.

## 3) SSH إلى الخادم

أضفْ إلى `~/.ssh/config` (أنشئْه إن غاب). الملفُّ `wasla_deploy_ed25519` هو مفتاحُ SSH الذي سُلِّمَ لك:

```
Host wasla
  HostName ssh.waslareev.dpdns.org
  User wasla
  IdentityFile ~/.ssh/wasla_deploy_ed25519
  ProxyCommand cloudflared access ssh --hostname %h
  HostKeyAlias wasla-casaos
  UserKnownHostsFile ~/.wasla/known_hosts
  StrictHostKeyChecking yes
```

- الأسطرُ الثلاثةُ الأخيرةُ تمنعُ `ssh` من قبولِ أيِّ مفتاحِ خادمٍ لم يُتحقَّقْ منه.
- **لا تتّصلْ بـ`ssh wasla` قبلَ الخطوة 5.** سيرفضُ بـ`Host key verification failed`، وهذا متوقَّع: لم يُثبَّتْ مفتاحُ الخادمِ بعد.
- ولا تقبلْ أبداً رسالةَ `Are you sure you want to continue connecting (yes/no)?` لهذا الخادم.

## 4) عميلُ OAuth

في `OFFSITE-BACKUP.md`، القسم «أ) عميلُ OAuth خاصٌّ في Google Cloud». احفظْ Client ID وClient secret في مديرِ كلماتِ المرور.

## 5) الربط (مرّةً واحدة)

جهّزْ قبلَ البدءِ أحدَ مرجعَين **من غيرِ هذا الاتصال**، ليُقرأَ منه مفتاحُ الخادم:

- **أ) شاشةُ الخادمِ ولوحةُ مفاتيحِه**، أو طرفيّةُ لوحةِ CasaOS على الشبكةِ المحلّيّةِ إن وُجدت. نفّذْ هناك:
  ```
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
  ```
- **ب) مخرجاتُ سكربتِ الإعداد** الذي شغّلتَه على الخادمِ أوّلَ مرّة: السطرُ `HOST_KEY: 256 SHA256:… (ED25519)`.

ثمّ من داخلِ مجلّدِ الحقيبة:

```bash
bash wasla-offsite-connect.sh
```

| الخطوة | ماذا يجري | ماذا تفعل |
|---|---|---|
| 5-1 مفتاحُ الخادم | يطلبُ **آخرَ 8 أحرفٍ** من البصمةِ التي تراها في المرجع. لا يعرضُ البصمةَ المتوقَّعةَ قبلَ إدخالك، حتّى لا تُنسَخَ دونَ مقارنة | انقلْها من المرجعِ كما هي (الأحرفُ الكبيرةُ والصغيرةُ مهمّة) |
| | تطابق ⇒ يكتبُ `~/.wasla/known_hosts`، ثمّ يتّصل | — |
| | لا تطابق ⇒ يتوقّفُ دونَ أيِّ اتصالٍ أو تثبيت | أعدِ القراءة. وإن بقيَ الاختلافُ **فتوقّفْ وأخبرِ المهندس**: قد لا يكونُ هذا خادمَك |
| 5-2 مفتاحُ age | ينشئُ `~/.wasla/wasla-backup.agekey` إن غاب، ويطبعُ العامّ | — |
| 5-3 مفتاحُ توقيعِ النسخ | يطلبُه من الخادمِ عبرَ الاتصالِ الموثَّق، ويثبّتُه في `~/.wasla/allowed_signers` | — |
| 5-4 Drive | يسألُ عن Client ID، ثمّ عن secret **دونَ صدى**، ويفتحُ المتصفّح | سجّلْ دخولَك بحسابِ Google الذي تريدُ النسخَ فيه. ثمّ في شاشةِ «Google hasn't verified this app»: **Advanced ← Go to wasla-backup** ← Continue |
| 5-5 الخادم | يرسلُ إعدادَ Drive عبرَ stdin لـSSH، فينشئُ المجلّدَ ويرفعُ أوّلَ نسخة | انتظرْ `offsite-ok` و«تمّ» |

بعدَها احفظْ **خارجَ الإنترنت** (مديرُ كلماتِ مرورٍ أو USB، لا في Drive):

- `~/.wasla/wasla-backup.agekey`: **سرّ**. ضياعُه يعني أنّ كلَّ النسخِ غيرُ قابلةٍ للفكّ.
- `~/.wasla/allowed_signers` و`~/.wasla/known_hosts`: ليسا سرّاً، لكنّهما يلزمان للتحقّقِ إن ضاعَ اللابتوب.

## 6) اختبارُ الاستعادة (شهريّاً)

```bash
bash wasla-offsite-restore-test.sh            # أحدثُ نسخةٍ يوميّة
bash wasla-offsite-restore-test.sh --list     # القائمة
bash wasla-offsite-restore-test.sh monthly/wasla-<TS>.tar.age
```

| النتيجة | المعنى |
|---|---|
| `PASS` | التوقيعُ صحيح، والفكُّ كامل، والمستعادُ يطابقُ لقطةَ النسخِ جدولاً جدولاً (عددُ الصفوفِ وبصمةُ المحتوى) |
| `FAIL` | مفتاحُ خادم، أو توقيع، أو مفتاح، أو عبث، أو نقص، أو اختلافٌ في البيانات. لم يُستعَدْ شيءٌ أو لم يُعتمَد |
| `INCONCLUSIVE` | النسخةُ لا تحوي لقطةَ صفوف. لا تُعَدُّ نجاحاً |

- السجلُّ `wasla-restore-test-*.log` في المجلّدِ الحاليّ، ولا يحوي أسراراً.
- الاستعادةُ الحقيقيّةُ (الخادمُ ضاع) في `OFFSITE-BACKUP.md`.

## ما اختُبِر وما لم يُختبَر

| البيئة | الحالة |
|---|---|
| Linux (Ubuntu، OpenSSH 10.2، age 1.3.2) لابتوباً عبرَ SSH حقيقيٍّ إلى الخادم، ببياناتٍ اصطناعيّة: تثبيتُ مفتاحِ الخادمِ بالتحقّقِ المستقلّ، ورفضُ الإدخالِ الخاطئ، ورفضُ مفتاحِ خادمٍ مختلف | PASS |
| الخادم (CasaOS) لابتوباً محاكى، ومعه خادمُ OAuth وهميّ | PASS |
| macOS | NOT TESTED (الأوامرُ محمولة: `shasum` بديلٌ تلقائيّ) |
| Windows (Git Bash) | NOT TESTED على Windows حقيقيّ |
| Google Drive حقيقيّ، وشاشةُ موافقةِ Google | NOT TESTED: يحتاجُ حسابَ المالكِ بعدَ الاعتماد |
