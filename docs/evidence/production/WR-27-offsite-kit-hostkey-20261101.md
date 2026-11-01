# WR-27: حقيبةُ اللابتوب — تثبيتُ مفتاحِ الخادم، وتصحيحُ الدليل، وتنظيفُ الملفّاتِ المولَّدة (2026-11-01)

**البند:** WR-27 · **ADR:** [0299](../../adr/0299-casaos-offsite-laptop-ssh-host-key-pinning.md) · **Work Packet:** `docs/work-packets/wr-27-offsite-kit-hostkey-20261101.json`
**يتابعُ:** PR #714 (`11cd50c7`، ADR 0298) و#713 (ADR 0297).
**CasaOS:** لم يُثبَّتْ شيء. `/etc/wasla/offsite.env` غائبٌ (النسخُ الليليُّ يطبعُ `offsite-skip`)، و`/opt/wasla/offsite-lib.sh` غيرُ مثبَّت، و9 حاوياتِ wasla كما هي، و`https://api.waslareev.dpdns.org/ready` = 200 ×3 بعدَ الاختبارات. Google Drive لم يُربَط.

## ١) مرجعُ مفتاحِ الخادم: تحقّقٌ مستقلّ

| المصدر | البصمة (ED25519) |
|---|---|
| رسالةُ المالكِ الأولى: سطرُ `HOST_KEY` من سكربتِ الإعدادِ الذي شغّلَه على الخادمِ نفسِه (خارجَ النفق) | `SHA256:xpIw6WmQ6gB/t7pDMYlzvkcfgSbe7/8LyNECMJd0D+U` |
| `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` على الخادم | `SHA256:xpIw6WmQ6gB/t7pDMYlzvkcfgSbe7/8LyNECMJd0D+U` |
| `WASLA_HOST_PUB` في `laptop/wasla-laptop-lib.sh` محسوبةً بـ`ssh-keygen -lf` | `SHA256:xpIw6WmQ6gB/t7pDMYlzvkcfgSbe7/8LyNECMJd0D+U` |

المفتاحُ العامُّ والبصمةُ ليسا سرّاً. ولم يُكتَبْ عنوانُ IP في المستودع.

## ٢) تنظيفُ الملفّاتِ المولَّدة

- **ما أُزيل من Git:** `deploy/casaos/__pycache__/offsite-tool.cpython-314.pyc`، و`deploy/casaos/tests/__pycache__/mock-oauth.cpython-314.pyc`، و`shellcheck_py-0.11.0.1-…whl` في جذرِ المستودع.
- **السبب:** في #714 شُغِّلَ `pip download shellcheck-py` و`python3 -m py_compile` داخلَ مجلّدِ المستودع، ثمّ أدخلَها `git add -A`.
  - ملفُّ wheel **غيرُ مطلوب**: shellcheck مثبَّتٌ أداةً في بيئةِ التطوير، ولا يستعملُه أيُّ سكربتٍ أو CI.
- **الوقاية:** في `.gitignore` الآن `__pycache__/` و`*.py[cod]` و`*.whl`.
- **ما بقيَ عن قصد:** 6 ملفّاتِ `.pyc` في `docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/batch31/analysis/__pycache__/`.
  - هي مختومةٌ في `SHA256SUMS` تلك الحزمة (الأسطر 2–7)، وطابقت تجزئاتُها.
  - و`AGENTS.md` ينصُّ أنّ `docs/evidence/**` يُحفَظُ ولا يُحذَف.
  - قاعدةُ التجاهلِ لا تمسُّها لأنّها متتبَّعةٌ أصلاً.

## ٣) الدليلُ `OFFSITE-BACKUP.md`

- أُعيدت كتابتُه كاملاً: أُصلِحَ السطرُ 12 التالفُ، وأُزيلت البقايا المكرّرةُ في الأسطر 39–45 من #714.
  - لا أسطرَ مكرّرة، و14 سياجَ كودٍ متوازنة، وعناوينُ مرتّبة.
- **أُضيف:** قسمُ «مفتاحُ SSH للخادم (ADR 0299)»، وخطوةُ مفتاحِ الخادمِ أوّلاً في «الربطُ وأوّلُ نسخة».
- **الاستعادةُ الحقيقيّة:** صارت متسلسلة: المتطلّبات، ثمّ تحقّقٌ قبلَ الفكّ، ثمّ `tar -tvf`، ثمّ `sha256sum -c`، ثمّ الإعداد، ثمّ القواعد، ثمّ التخزين.
- **ثغرةٌ وُجدت:** `miniapp-nginx.conf` و`shim-overlay` و`miniapp/current` ليست في النسخة. صارت تُعادُ من المستودع:
  - `deploy/casaos/shim-overlay/Dockerfile` الجديدُ نسخةٌ حرفيّةٌ من ملفِّ الإنتاج، وأساسُه `docker/upstash-rest-shim` في `099c1076`.
  - Mini App تُبنى في حاويةِ `oven/bun:1.4.2`، فلا يلزمُ Bun على الخادم (الخادمُ ليس عليه `bun`).
  - محتوى النسخةِ نفسُه لم يتغيّر.
- **خادمٌ جديد:** له مفتاحُ SSH جديد، فتلزمُه حقيبةٌ جديدةٌ بمرجعٍ مقروءٍ من شاشتِه.

## ٤) الاختبارات

### أ) self-test على الخادم (`offsite-selftest.sh`): **pass=132 fail=0**

- السجلُّ الكامل: [`WR-27-offsite-kit-hostkey-20261101/selftest.txt`](../archive/WR-27-offsite-kit-hostkey-20261101/selftest.txt).
- الحالاتُ الجديدة:
  - لاحقةٌ خاطئةٌ ⇒ رفضٌ بلا أيِّ استدعاءٍ لـssh، وبلا `known_hosts` ولا `allowed_signers`؛
  - حقيبةٌ معدَّلة ⇒ رفضٌ قبلَ السؤال؛
  - restore-test بلا تثبيت ⇒ رفض؛
  - `known_hosts` (600) يُكتَبُ قبلَ مفتاحِ التوقيع.
- **ssh البديلُ صارَ يبتلعُ stdin كالحقيقيِّ إن غابَ `-n`**، فيلتقطُ الخللَ في (ب) لو عاد.

### ب) اتصالٌ حقيقيٌّ من لابتوب Linux عبرَ SSH حقيقيّ (`offsite-laptop-e2e-client.sh`): **pass=19 fail=0**

- السجلّ: [`WR-27-offsite-kit-hostkey-20261101/e2e-client.txt`](../archive/WR-27-offsite-kit-hostkey-20261101/e2e-client.txt).
- البيئةُ اصطناعيّةٌ على الخادم (`offsite-laptop-e2e-server.sh up/down`) و«Drive» محلّيّ، بـOpenSSH 10.2p1 وage 1.3.2.

| الحالة | النتيجة |
|---|---|
| لاحقةٌ خاطئة | توقّف، ولا `known_hosts` ولا `allowed_signers` ولا مفتاحَ age. والبصمةُ المتوقَّعةُ لم تُطبَع |
| لاحقةٌ صحيحة | ثُبِّتَ المفتاح (600)، واتصالٌ حقيقيٌّ بـ`StrictHostKeyChecking=yes`، ثمّ مفتاحُ التوقيعِ (يطابقُ الخادم) **بعدَه** |
| تشغيلٌ ثانٍ | «مثبَّتٌ سابقاً» دونَ سؤال |
| `wasla-offsite-restore-test.sh` | **PASS** |
| حقيبةٌ معدَّلةٌ جزئيّاً | توقّفٌ قبلَ السؤال |
| **انتحال:** حقيبةٌ بمرجعٍ آخرَ متّسق، وأُدخِلت لاحقتُه | ssh الحقيقيّ: `Host key verification failed`، ولم يُثبَّتْ مفتاحُ توقيع |
| `known_hosts` معدَّل / غائب | restore-test يرفضُ دونَ اتصال |
| خطواتُ «الاستعادةُ الحقيقيّة» أ2–أ4 وب1–ب2 حرفيّاً | `Good signature`، وsha256 النصِّ المشفّرِ = البيان، و`age -d`، و`tar -tvf` بأسماءٍ مسطّحة (5)، و`sha256sum -c --strict` (4 OK)، وMANIFEST = القيمةُ الموقَّعة، و`config-*.tgz` |
| أسرارُ age في السجلّات | لا شيء |

**خللٌ كشفَه الاتصالُ الحقيقيُّ وأُصلِح:**

- أوّلُ تشغيلٍ أعطى rc=1 بدلَ 2 في حالةِ «لاحقةٌ صحيحة».
- السبب: `ssh` يقرأُ stdin، فابتلعَ ما بعدَه من مُدخلاتِ المالك (Client ID) بعدَ جلبِ مفتاحِ التوقيع.
- لم يكشفْه self-test #714 لأنّ ssh البديلَ لم يقرأْ stdin.
- الإصلاح: كلُّ اتصالٍ لا يحتاجُ مُدخلاً صارَ بـ`ssh -n`. أمّا اتصالا `--install` والتمرين فيحتاجانِ stdin عمداً.

### ج) محاكاةُ الإنتاجِ للقراءةِ فقط (`offsite-prod-readonly-sim.sh`): **offsite-drill-PASS**

- `rowstats` 87/87 جدولاً و4422 صفّاً، بلا أيِّ اختلاف.
- storage-db 10/10 (79 صفّاً)، وكائناتُ التخزين 2/2، والإعداد 12/12.
- الحاوياتُ المتبقّية 0.
- `drift-info` معلوماتيٌّ في جدولَين، ولا يؤثّرُ في الحكم.
- بعدَها حُذِفَ `/tmp/wst` و`/var/tmp/wasla-selftest-e2e`.

### د) خطواتُ البناء

- `VITE_WASLAH_API_BASE= bun run --cwd apps/miniapp build` (bun 1.4.2) نجح في بيئةِ التطوير، ومخرجاتُه `dist/{index.html,assets}`.
- `docker/upstash-rest-shim/Dockerfile` موجودٌ في `099c1076`.
- **لم يُنفَّذْ `docker build`/`docker run` على CasaOS** (لا تثبيت).

### هـ) الحقيبة: `wasla-offsite-laptop-kit.zip`

- **SHA-256:** `41e4703c2ef06de0aed340853cef0ac765483b3842fe906f5f4d8d2e0f3ef107` (بناءانِ متتاليانِ بالتجزئةِ نفسِها).
- **المحتوى:** `wasla-offsite-kit/` فيه 5 ملفّاتٍ و`SHA256SUMS`:
  - `wasla-laptop-lib.sh` (644)،
  - `wasla-offsite-connect.sh` و`wasla-offsite-restore-test.sh` (755)،
  - `README-AR.md` و`OFFSITE-BACKUP.md` (644).
- **الفحص:**
  - `sha256sum -c` أعطى 5 OK، و`bash -n` نجحَ للثلاثة؛
  - كلُّ ملفٍّ مطابقٌ بايتاً ببايتٍ لنظيرِه في المستودع؛
  - لا أسرار.

## ٥) NOT TESTED

- Google Drive الحقيقيّ وموافقةُ OAuth الفعليّة (مقصود: لا ربط).
- macOS وWindows (Git Bash).
- قراءةُ المالكِ للبصمةِ من شاشةِ الخادم.
- `docker build` للوسيطِ وMini App على خادمٍ جديد.
