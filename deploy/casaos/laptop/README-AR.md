# حقيبةُ اللابتوب: النسخةُ المشفّرةُ لوصلة خارجَ الموقع

هذه الحقيبةُ **لا تحوي أيَّ سرّ**. تُبنى من المستودعِ بـ`deploy/casaos/laptop/build-kit.sh`، ويُطابَقُ محتواها بـ`SHA256SUMS`.

```
wasla-offsite-kit/
├── README-AR.md                    ← هذا الملفّ
├── OFFSITE-BACKUP.md               ← الدليلُ الكامل (التشغيل، الاستعادة، الكارثة، التراجع)
├── wasla-offsite-connect.sh        ← الربطُ لمرّةٍ واحدة
├── wasla-offsite-restore-test.sh   ← اختبارُ الاستعادةِ الشهريّ
└── SHA256SUMS
```

> **لا تبدأ الربطَ قبلَ اعتمادِ الخطواتِ النهائيّة.** إنشاءُ عميلِ OAuth ونشرُه في Google Cloud موصوفان في `OFFSITE-BACKUP.md`، ويتمّان بعدَ موافقتك.

## 1) التحقّقُ من الحقيبة

افتح الطرفيّة داخلَ مجلّد `wasla-offsite-kit`، ثمّ:

| النظام | الأمر |
|---|---|
| Linux، أو Windows (Git Bash) | `sha256sum -c SHA256SUMS` |
| macOS | `shasum -a 256 -c SHA256SUMS` |

يجبُ أن يظهرَ `OK` لكلِّ سطر.

## 2) الأدوات

| النظام | التثبيت |
|---|---|
| macOS | `brew install age rclone cloudflared` |
| Linux (Debian/Ubuntu) | `sudo apt install age rclone openssh-client`، وcloudflared من حزمةِ Cloudflare الرسميّة |
| Windows | `winget install FiloSottile.age Rclone.Rclone Cloudflare.cloudflared Git.Git`، ثمّ افتح **Git Bash** من قائمةِ ابدأ |

يلزمُ: `bash` و`age` و`age-keygen` و`rclone` و`ssh` و`ssh-keygen` (من OpenSSH 8.1 فأحدث) و`base64`. والسكربتان يتحقّقان من وجودِها قبلَ أيِّ خطوة.

**ملاحظاتُ Windows (Git Bash):**

- أغلقْ Git Bash وافتحْه من جديدٍ بعدَ `winget`، ليرى الأوامرَ الجديدة. وتأكّدْ بـ`age --version` و`rclone version` و`cloudflared --version`.
- `ssh` و`ssh-keygen` و`base64` و`sha256sum` تأتي مع Git for Windows.
- ملفُّ SSH هو `~/.ssh/config`، أي `C:\Users\<اسمك>\.ssh\config`.
- مفتاحُ age يُحفَظُ في `~/.wasla/wasla-backup.agekey`، أي `C:\Users\<اسمك>\.wasla\`. صلاحيّاتُ 600 لا تُطبَّقُ على NTFS كما على Linux، فلا تشاركْ حسابَ Windows مع غيرك.
- السكربتُ يحوّلُ مسارَ ملفِّ rclone المؤقّتِ بـ`cygpath -w` لأنّ rclone برنامجُ Windows أصليّ.
- إن ظهرَ `$'\r': command not found` فالملفّاتُ حُوِّلت إلى CRLF. أعدْ فكَّ الحقيبةِ بأداةِ ZIP العاديّة، لا عبرَ `git clone` مع `autocrlf`.

## 3) SSH إلى الخادم

أضفْ إلى `~/.ssh/config`. الملفُّ `wasla_deploy_ed25519` هو مفتاحُ SSH الذي سُلِّمَ لك:

```
Host wasla
  HostName ssh.waslareev.dpdns.org
  User wasla
  IdentityFile ~/.ssh/wasla_deploy_ed25519
  ProxyCommand cloudflared access ssh --hostname %h
```

ثمّ تأكّدْ بـ`ssh wasla true`.

## 4) الربط (مرّةً واحدة، بعدَ الاعتماد)

```bash
bash wasla-offsite-connect.sh
```

ماذا يفعل:

1. ينشئُ مفتاحَ age الخاصَّ إن غاب، ويطبعُ العامّ.
2. يثبّتُ مفتاحَ توقيعِ الخادمِ في `~/.wasla/allowed_signers`. وإن تغيّرَ لاحقاً يرفضُ ولا يستبدلُه وحدَه.
3. يسألُ عن Client ID، ثمّ عن Client secret **دونَ صدى**.
4. يفتحُ المتصفّحَ لموافقةِ Google.
5. يرسلُ إعدادَ Drive إلى الخادمِ عبرَ **stdin** لـSSH، لا في سطرِ أوامر.
6. يرفعُ أوّلَ نسخةٍ مشفّرة.

**احفظْ نسخةً من `~/.wasla/wasla-backup.agekey` خارجَ الإنترنت** (مديرُ كلماتِ مرورٍ أو USB)، لا في Drive.

## 5) اختبارُ الاستعادة (شهريّاً)

```bash
bash wasla-offsite-restore-test.sh            # أحدثُ نسخةٍ يوميّة
bash wasla-offsite-restore-test.sh --list     # القائمة
bash wasla-offsite-restore-test.sh monthly/wasla-<TS>.tar.age
```

| النتيجة | المعنى |
|---|---|
| `PASS` | التوقيعُ صحيح، والفكُّ كامل، والمستعادُ يطابقُ لقطةَ النسخِ جدولاً جدولاً (عددُ الصفوفِ وبصمةُ المحتوى) |
| `FAIL` | توقيع، أو مفتاح، أو عبث، أو نقص، أو اختلافٌ في البيانات. لم يُستعَدْ شيءٌ أو لم يُعتمَد |
| `INCONCLUSIVE` | النسخةُ أقدمُ من هذه الآليّة ولا تحوي لقطةَ صفوف. لا تُعَدُّ نجاحاً |

السجلُّ `wasla-restore-test-*.log` في المجلّدِ الحاليّ، ولا يحوي أسراراً.

## ما اختُبِر وما لم يُختبَر

| البيئة | الحالة |
|---|---|
| Linux (Ubuntu، OpenSSH 10.2، age 1.3.2، rclone 1.75.2) لابتوباً عبرَ SSH حقيقيّ إلى الخادم، ببياناتٍ اصطناعيّة | PASS |
| الخادم (CasaOS) لابتوباً محاكى، ومعه خادمُ OAuth وهميّ | PASS |
| macOS | NOT TESTED (الأوامرُ محمولة: `shasum` بديلٌ تلقائيّ) |
| Windows (Git Bash) | NOT TESTED على Windows حقيقيّ |
| Google Drive حقيقيّ | NOT TESTED: يحتاجُ حسابَ المالكِ بعدَ الاعتماد |
