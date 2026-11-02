# WR-27: إصلاحُ ملاحظتَي مراجعةِ PR #717 — لا إعادةَ ربطٍ تحتَ رفعٍ مفعَّل، وتحقّقٌ كاملٌ قبلَ التفعيل (2026-11-02)

**البند:** WR-27
**ADR:** [0301](../../adr/0301-casaos-offsite-relink-binding-and-enable-integrity.md)، ويحلُّ محلَّ أجزاءٍ من 0300، و0300 بلا تعديل
**Work Packet:** `docs/work-packets/wr-27-offsite-review-fixes-20261102.json`
**السجلّاتُ الخام:** `docs/evidence/archive/WR-27-offsite-review-fixes-20261102/` (معها `SHA256SUMS`). والدليلُ السابق [`WR-27-offsite-stage-separation-20261102.md`](WR-27-offsite-stage-separation-20261102.md) وأرشيفُه باقيانِ بلا حذف.

**مرتبةُ الدليل:** **محلّيّ** (sandbox Linux) و**CI** (Linux، وwindows-latest Git Bash).

**لا إنتاج:**
- لم يُتَّصَلْ بخادمِ CasaOS.
- لا Google حقيقيّ، ولا رفعَ خارجيّ، ولا تفعيل.
- خادمُ Drive وخادمُ OAuth وهميّان.

## ١) الملاحظتان

| | الملاحظة | الإصلاح (ADR 0301) |
|---|---|---|
| P1 | `--link` يستبدلُ `rclone.conf` والليليُّ مفعَّل، و`offsite.env` باقٍ، فيذهبُ الرفعُ الليليُّ إلى الحسابِ الجديد. والاختبارُ لم يشغّلْ `backup.sh` بعدَ إعادةِ الربط | أربعُ طبقات:<br>(١) `--link` يُرفَضُ والليليُّ مفعَّل (`link-FAIL nightly_enabled`)، تحتَ القفل، قبلَ stdin، وبلا أيِّ استدعاءٍ لـrclone.<br>(٢) الحقيبةُ تتوقّفُ عندَ `stage=enabled` قبلَ `RELINK` وقبلَ Client ID.<br>(٣) بصمةُ الاعتماد `CRED_FP` (sha256 لقسمِ الوجهة بلا `access_token`) تُسجَّلُ في الربطِ وأوّلِ الرفعِ و`offsite.env`.<br>(٤) `--nightly` لا يلمسُ Drive إلّا إن تطابقَ `offsite.env` والربطُ وسجلُّ أوّلِ رفعٍ وبصمةُ `rclone.conf` الحاليّة، وإلّا `link_changed` أو `credential_changed` |
| P2 | التفعيلُ يفحصُ الأسماءَ وحجمَ الأرشيفِ فقط. `FO_SHA256` غيرُ مستعمَل، والبيانُ والتوقيعُ بلا فحص | قراءةٌ فقط، بالترتيب:<br>الأسماءُ الثلاثةُ وحدَها والحجم ← sha256 الأرشيفِ بعدَ تنزيلِه كاملاً (`ciphertext_mismatch`) ← sha256 البيان = `FO_MANIFEST_SHA256` (`manifest_mismatch`) ← `ssh-keygen -Y verify` بمفتاحِ الخادم، `wasla-backup`/`wasla-offsite-backup` (`manifest_signature_invalid`) ← حقولُ البيانِ = السجلُّ والمستلم (`manifest_mismatch`).<br>وتُفحَصُ البصمةُ أيضاً (`credential_changed`) |

## ٢) الكود

- **`offsite-tool.py`:** `cred-fp RCLONE_CONF REMOTE`.
  - مفاتيحُ القسمِ مرتّبةً عدا `token`، ثمّ `refresh_token` وحدَه.
  - يرفضُ قسمَ drive بلا `refresh_token` أو بلا `client_id`.
  - لا يطبعُ إلّا التجزئة.
- **`offsite-lib.sh`:**
  - `cred_fp`؛
  - و`first_ok_load` يتطلّبُ `FO_MANIFEST_SHA256` و`FO_CRED_FP`؛
  - و`offsite_cfg_load` يقبلُ `CRED_FP`.
- **`offsite-setup.sh`:**
  - `--link`: رفضُ `offsite.env`، وكتابةُ `CRED_FP` في الربط.
  - `--enable-nightly`: سلسلةُ التحقّقِ أعلاه، في مجلّدٍ مؤقّتٍ 700 يُحذَفُ في كلِّ مسار، وبحدٍّ لحجمِ البيان (4096) والتوقيع (8192). ثمّ `offsite.env` بخمسةِ مفاتيح.
- **`offsite-backup.sh`:**
  - `--nightly`: الربطُ قبلَ أيِّ rclone.
  - `--first`: البصمة، ويسجّلُ `FO_MANIFEST_SHA256` و`FO_CRED_FP`.
- **`laptop/wasla-offsite-connect.sh`:** يتوقّفُ عندَ `stage=enabled` قبلَ أيِّ سؤال.

## ٣) الاختبارات (محلّيّاً)

| الاختبار | النتيجة | الخام |
|---|---|---|
| `offsite-stages-test.sh` | **PASS 133/0 (كان 86 قبلَ هذا الإصلاح)** | `stages-test-r2.txt` |
| `offsite-selftest.sh` (حاويةُ sandbox) | **PASS 133/0** | `selftest-r2.txt` |
| `offsite-kit-windows-test.sh` على الحقيبةِ المبنيّة، والمسارُ فيه مسافة | **PASS 30/0 (حقيبة sha256 `18dc3f74…0545`)** | `kit-test-linux-r2.txt` |
| طفراتٌ تعيدُ كلَّ عيبٍ مُصلَح | **15/15 كُشفَت، وخطُّ الأساسِ 133/0** | `mutation-results-r2.txt` |

**P1 — حالاتٌ جديدةٌ في اختبارِ المراحل:**

- **والليليُّ مفعَّل:**
  - الحقيبةُ تتوقّفُ عندَ `--status` قبلَ `RELINK` وClient ID.
  - `--link` بحسابٍ آخرَ على stdin يُرفَض، والحالةُ مطابقةٌ بايتاً ببايت، وصفرُ استدعاءٍ لـrclone.
  - ثمّ `backup.sh` الليليُّ يرفعُ بالاعتمادِ المعتمَدِ وحدَه.
- **ثمانُ حالاتِ `night_reject`** (كلُّها بصفرِ استدعاءٍ لـrclone):
  - `rclone.conf` لحسابٍ آخر، أو محذوف ⇒ `credential_changed`؛
  - `LINK_ID` أو `CRED_FP` في الربطِ تغيّرَ خارجَ الأوامر، أو الربطُ محذوف ⇒ `link_changed reason=link_record`؛
  - سجلُّ أوّلِ رفعٍ محذوف ⇒ `reason=first_upload_record`؛
  - `offsite.env` بلا `CRED_FP` أو بلا `LINK_ID` (صيغةٌ قديمة) ⇒ `reason=unbound_config`.
- **المسارُ الصحيح:** إيقافٌ ← ربطٌ جديدٌ (محلّيٌّ فقط بعدَه) ← التفعيلُ يطلبُ أوّلَ رفعٍ جديد ← `UPLOAD` ← `ENABLE` ← الليليُّ يرفعُ بالحسابِ الجديد.

**P2 — ثماني عشرةَ حالةً سلبيّةً للتفعيل** في `en_reject`، وكلٌّ منها يتحقّقُ من: لا `offsite.env`، وصفرُ كتابةٍ في Drive، ولا مجلّدَ تحقّقٍ متروك.

- **الأرشيف:**
  - بِتٌّ مقلوبٌ في الوسط؛
  - تغييرُ آخرِ بايت؛
  - استبدالٌ كاملٌ بالحجمِ نفسِه؛
  - إعادةُ كتابتِه مع بيانٍ مُعادِ التوقيع.
- **البيان:**
  - تعديلُ حقل؛
  - sha آخرُ مع إعادةِ التوقيعِ بمفتاحِ الخادم؛
  - الحقولُ نفسُها ببايتاتٍ مختلفةٍ (موقَّع)؛
  - بيانُ نسخةٍ أخرى بتوقيعِها؛
  - بيانٌ مقطوع.
- **التوقيع:**
  - توقيعٌ تالف؛
  - توقيعٌ فارغ؛
  - توقيعٌ بمفتاحٍ آخر؛
  - نطاقٌ آخر؛
  - توقيعٌ صالحٌ لمحتوًى آخر؛
  - بِتٌّ مقلوب.
- **غيرُ ذلك:**
  - مستلمٌ آخرُ مع سجلٍّ يطابقُ تجزئتَه؛
  - ملفٌّ زائدٌ في `daily/`؛
  - استبدالُ `rclone.conf` ⇒ `credential_changed`.
- **وحالةٌ لأوّلِ الرفع:** `--first` يُرفَضُ عندَ تبدّلِ الاعتماد (`first-FAIL credential_changed`).

**الطفرات:** كلُّ طفرةٍ تعيدُ عيباً بعينِه في نسخةٍ منسوخة، ويجبُ أن يفشلَ الاختبار. ومنها:
- **M11:** عيبُ P1 كما وصفَه المراجع، بإزالةِ الطبقاتِ كلِّها.
- **M22:** عيبُ P2، أي فحصُ الحجمِ وحدَه.

القائمةُ والنتائجُ في `mutation-results-r2.txt`.

**إصلاحٌ عرضيّ:**
- اختبارُ «tampered ciphertext» القديمُ (test 12) كان يكتبُ الحرفَ `X` في البايتِ 200. فإن كان البايتُ `X` أصلاً لا يتغيّرُ الملفّ، أي فشلٌ عشوائيٌّ بنسبة 1/256. رُصِدَ مرّةً في خطِّ أساسِ الطفرات، بلا أيِّ تعديلٍ في الكود.
- صارَ قلبَ بِتٍّ مع شرطٍ مسبقٍ أنّ الملفَّ تغيّر.
- وأُصلِحَ النمطُ نفسُه في اختبارِ الحقيبة.

## ٤) CI

على الالتزام `ae347c7c` ([run 41366978188](https://github.com/uxxxug/ceezr/actions/runs/41366978188)):

| الوظيفة | النتيجة | الخام |
|---|---|---|
| `windows-git-bash` (windows-latest، MINGW64، والمسارُ فيه مسافة) | **PASS 31/0**: حالاتُ Linux الثلاثون، وتحقّقٌ واحدٌ بـ`ssh-keygen` الأصليّ في Windows | `windows-kit-test-ci-r2.txt` |
| `stages-linux` | **PASS 133/0** | `stages-linux-ci-r2.txt` |
| `build-kit`، `verify`، `roadmap`، `execution-roadmap`، والبقيّة | PASS | — |

الملفّانِ مستخرَجانِ من سجلِّ الوظيفة، لأنّ تنزيلَ الـartifact يعيدُ 401.

## ٥) ما بقيَ خارجَ هذا الدليل

- **NOT TESTED:**
  - Google Drive وOAuth الحقيقيّان، وسلوكُ Google الفعليُّ في تدويرِ `refresh_token`؛
  - SSH حقيقيٌّ عبرَ cloudflared؛
  - Windows 11 Pro المكتبيّ، وmacOS؛
  - إعادةُ تشغيلِ systemd حقيقيّة؛
  - التثبيتُ على CasaOS (ما زالَ `9b8c3b1b`).
- **قيودٌ باقية:**
  - root على الخادمِ يستطيعُ تعديلَ كلِّ ملفّاتِ الحالةِ وبصمتِها معاً. هذا خارجَ نموذجِ التهديد.
  - التفعيلُ ينزّلُ الأرشيفَ كاملاً مرّةً واحدة.
  - إن دوّرَ Google `refresh_token` يتوقّفُ الليليُّ بـ`credential_changed` ظاهراً، ويلزمُ ربطٌ جديد.
