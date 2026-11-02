# WR-27: فصلُ مراحلِ النسخِ خارجَ الموقع: الربط ← أوّلُ رفع ← التفعيل (2026-11-02)

**البند:** WR-27 · **ADR:** 0300 (يحلُّ محلَّ خطوةِ `--install` وقراءةِ `offsite.env` بـ`source` في 0297/0298) · **Work Packet:** `docs/work-packets/wr-27-offsite-stage-separation-20261102.json`
**السجلّاتُ الخام:** `docs/evidence/archive/WR-27-offsite-stage-separation-20261102/` (معها `SHA256SUMS`).
**مرتبةُ الدليل:** **محلّيّ** (sandbox Linux)، و**CI** (Linux وwindows-latest Git Bash). **لا إنتاج:** لم يُتَّصَلْ بخادمِ CasaOS، ولم يُغيَّرْ عليه شيء. ولا Google حقيقيّ: خادمُ Drive وهميّ، وخادمُ OAuth وهميّ.

## ١) العيبُ الذي أُصلِح

في `9b8c3b1b` (المثبَّتِ على CasaOS، غيرَ مُعَدّ) كان أمرٌ واحدٌ يجمعُ المراحلَ الثلاث:

- `wasla-offsite-connect.sh` ← `offsite-setup.sh --install`، فيكتبُ `rclone.conf` و`offsite.env` معاً، ثمّ `rclone mkdir`، ثمّ أوّلَ رفع.
- و`backup.sh` يرفعُ كلَّ ليلةٍ متى وُجدَ `offsite.env`.
- فنجاحُ OAuth وحدَه كان يعني: مجلّداً في Drive، ورفعاً فوريّاً، وتفعيلاً ليليّاً. بلا موافقةٍ منفصلةٍ لأيٍّ منها.
- و`offsite.env` كان يُقرأُ بـ`source`، فأيُّ سطرٍ فيه يُنفَّذُ بصلاحيّةِ root.

## ٢) ما تغيّرَ في الكود

| المرحلة | الأمرُ على الخادم | يكتب | لا يفعل |
|---|---|---|---|
| أ الربط | `offsite-setup.sh --link age1… < section` | `rclone.conf` (بعدَ نجاحِ `rclone about` على ملفٍّ مرشَّح)، `offsite-pending.env` (`LINK_ID`)، ويحذفُ `offsite-first-ok` | لا `offsite.env`، ولا mkdir/copy، ولا رفع |
| ب أوّلُ رفع | `offsite-backup.sh --first [TS]` | 3 ملفّاتٍ في `daily/`، ثمّ `offsite-first-ok` عندَ النجاحِ وحدَه | لا tiers، ولا حذفَ بعيد، ولا `offsite.env`. ويُرفَضُ إن كان مفعَّلاً أو غيرَ مربوط |
| ج التفعيل | `offsite-setup.sh --enable-nightly TS` | `offsite.env` ذرّيّاً (600، 4 مفاتيح) | لا رفع. ويُرفَضُ بلا first-ok لهذا `LINK_ID` وبهذا TS، وبلا الملفّاتِ الثلاثةِ بحجمِها في Drive (`lsf`) |
| إيقاف | `offsite-setup.sh --disable-nightly` | يحذفُ `offsite.env` | لا يمسُّ الربطَ ولا النسخَ المحلّيّ |
| الحالة | `offsite-setup.sh --status` | — | `stage=unlinked\|linked\|first-ok\|enabled`، بلا أسرار |

- `--install` القديمُ: exit 2 بلا أثر.
- `backup.sh` يستدعي `offsite-backup.sh --nightly` فقط إن وُجدَ `offsite.env`. وهذا الملفُّ لا يكتبُه إلّا `--enable-nightly` (فحصٌ ثابتٌ في الاختبار).
- ملفّاتُ الحالةِ تُقرأُ بمحلّلٍ صارم (`kv_load`):
  - ملفٌّ عاديٌّ لا رابط، مالكُه المستخدم، و600؛
  - مفاتيحُ معروفةٌ بلا تكرار، وقيمٌ بمحارفَ آمنة؛
  - لا `source`.
- قفلٌ (`flock`) يمنعُ تزامنَ عمليّتَين.
- **الحقيبة:**
  - `wasla-offsite-connect.sh` للمرحلةِ أ وحدَها: يقرأُ `--status` قبلَ أيِّ سرّ، ويطلبُ `RELINK` إن كان مربوطاً.
  - جديد: `wasla-offsite-first-upload.sh` (يطلبُ `UPLOAD`)، و`wasla-offsite-enable-nightly.sh` (يطلبُ `ENABLE`، و`--disable` يطلبُ `DISABLE`).
  - الكلماتُ تُقبَلُ مع CR (Windows).
- **خادمٌ أقدمُ من ADR 0300:** `--status` يردُّ برسالةِ الاستعمالِ ورمزِ 2 دونَ أثر (تحقّقٌ على `9b8c3b1b:offsite-setup.sh`). فتتوقّفُ الحقيبةُ برسالةٍ تذكرُ ADR 0300 قبلَ Client ID.
- **تحذيرٌ عندَ إعادةِ الربطِ والتفعيلُ قائم:** `offsite.env` لا يتغيّر، فيبقى الرفعُ الليليُّ بالمستلمِ القديم. والرسالةُ والدليلُ يطلبانِ: إيقاف ← ربط ← أوّلُ رفع ← تفعيل.

## ٣) النتائج

| الاختبار | البيئة | النتيجة | الملفّ |
|---|---|---|---|
| `tests/offsite-stages-test.sh` (الاختباراتُ الإلزاميّة 1–12 وغيرُها) | sandbox Linux: rclone حقيقيٌّ على اللابتوب مع mock-oauth، وrclone وهميٌّ على الخادم، و`HOME` فيه مسافة | **PASS 86/0** | `stages-test.txt` |
| اختبارُ الطفرات: 8 تعديلاتٍ تكسرُ الفصل، كلٌّ على نسخةٍ منفصلة | sandbox Linux | **PASS 8/8 كُشفَت** | `mutation-results.txt` · `mutation-run.txt` |
| `tests/offsite-selftest.sh` (التشفير والتوقيع والاستعادة والحالاتُ السلبيّة، postgis حقيقيّ `--network none`) | sandbox Linux بصلاحيّةِ root وdocker | **PASS 133/0** | `selftest.txt` |
| `tests/offsite-kit-windows-test.sh` على الحقيبةِ المبنيّة (مجلّد `Ahmed Ali`) | sandbox Linux | **PASS 29/0** | `kit-test-linux.txt` |
| الاختبارُ نفسُه على windows-latest Git Bash، وstages-linux | GitHub Actions | **PASS** — Windows 30/0، stages-linux 86/0 | `windows-kit-test.txt` · `stages-linux.txt` |
| `build-kit.sh` مرّتين | sandbox | sha256 واحد: `a0d94b57d3a89499ad0d41914a241a04a3bea7426e24ab03424cc53d5df3de7f` | — |

**الاختباراتُ الإلزاميّة** (أسطرُ `test N` في `stages-test.txt`):

| # | المعيار | النتيجة |
|---|---|---|
| 1 | الربطُ لا ينشئُ `offsite.env` | PASS |
| 2 | الربطُ يستدعي rclone مرّةً واحدة: `about` (قراءةُ الحصّة) | PASS |
| 3 | لا مجلّدَ ولا ملفَّ في Drive بعدَ الربطِ أو إعادتِه | PASS |
| 4 | `backup.sh` بعدَ الربطِ محلّيٌّ فقط، وبلا استدعاءِ rclone | PASS |
| 5 | أوّلُ رفع: استدعاءٌ واحد، و3 ملفّاتٍ في `daily/` فقط، ولا تفعيل | PASS |
| 6 | فشلٌ محقونٌ في الرفعِ وفي التحقّق: لا first-ok، ولا `offsite.env`، وما رُفعَ يُحذَف، والتفعيلُ مرفوض | PASS |
| 7 | التفعيلُ مرفوضٌ: قبلَ الربط، وقبلَ أوّلِ رفع، وبطابعٍ آخر، وملفٌّ ناقصٌ في Drive، وحجمٌ مختلف، وسجلٌّ ليس 600 | PASS |
| 8 | الرفعُ الليليُّ لا يحدثُ إلّا بعدَ التفعيلِ الصريح | PASS |
| 9 | إعادةُ تشغيلٍ محاكاة (`env -i` مرّتين، وقفلٌ قديم): الحالةُ كما هي في كلِّ مرحلة | PASS (محاكاة، لا systemd حقيقيّ) |
| 10 | إعادةُ الربط: لا رفع، ولا مجلّد، ولا تفعيل، و`LINK_ID` جديد، والسابقُ `.bak` | PASS |
| 11 | لا سرَّ في argv/environ (عيّنةٌ من `/proc` كلَّ 50ms مع تحكّمٍ إيجابيّ)، ولا في السجلّات | PASS |
| 12 | تحقّقُ أوّلِ رفع: التوقيع، وsha256، والمستلم، و`age -d`، وفحصُ الأرشيف، وتطابقُ rowstats والتفريغ؛ والعبثُ مرفوض | PASS |

**الطفرات** (كلٌّ يجبُ أن يُسقطَ الاختبار):

| الطفرة | FAIL |
|---|---|
| M1 الربطُ يكتبُ `offsite.env` | 37 |
| M2 `mkdir` بدلَ `about` | 6 |
| M3 `backup.sh` يرفعُ بعدَ الربط | 35 |
| M4 أوّلُ رفعٍ يفعّل | 13 |
| M5 التفعيلُ يتجاهلُ الطابع | 8 |
| M6 `offsite.env` يُقرأُ بـ`source` | 7 |
| M7 التفعيلُ لا يقارنُ الحجم | 9 (منها «size differs») |
| M8 الحقيبةُ ترفعُ دونَ `UPLOAD` | 5 |

## ٤) NOT TESTED

- Google Drive الحقيقيّ وOAuth الحقيقيّ (ممنوعانِ في هذه المهمّة).
- SSH حقيقيٌّ عبرَ cloudflared من Windows. والحقيبةُ على Windows 11 Pro المكتبيّ: الاختبارُ على windows-latest في CI وحدَه.
- macOS.
- إعادةُ تشغيلٍ حقيقيّةٌ لـsystemd. المختبَرُ محاكاةٌ ببيئةٍ نظيفةٍ وقفلٍ قديم.
- التثبيتُ على CasaOS: النسخةُ هناك ما زالت `9b8c3b1b`، وتحتاجُ موافقةَ المالك.

## ٥) CI

- التشغيلُ: [run 41359848472](https://github.com/uxxxug/ceezr/actions/runs/41359848472) على الالتزام `42efbb75` (PR #717).
- `windows-git-bash` (windows-latest، MINGW64، HOME بمسافة `Ahmed Ali`): **PASS** 30/0 — `windows-kit-test.txt`.
- `stages-linux` (ubuntu-latest): **PASS** 86/0 — `stages-linux.txt`.
- `build-kit`: **PASS**.
- ملاحظة: هذا runner سحابيّ، لا جهازُ المالكِ Windows 11 Pro؛ يبقى ذلك NOT TESTED.


## ملحق: ملاحظاتُ المراجعة (2026-11-02)

أُصلِحت ملاحظتا مراجعةِ PR #717 (P1: إعادةُ الربطِ تحتَ رفعٍ مفعَّل، وP2: التفعيلُ يفحصُ الحجمَ وحدَه) في [ADR 0301](../../adr/0301-casaos-offsite-relink-binding-and-enable-integrity.md). الدليل: [`WR-27-offsite-review-fixes-20261102.md`](WR-27-offsite-review-fixes-20261102.md). ما فوقَ هذا الملحقِ باقٍ كما سُجِّل.
