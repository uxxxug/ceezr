# WR-21 — مخزنُ وثائقِ السائقِ على CasaOS: نشرٌ وفحصٌ وتمرينُ استعادة (2026-10-30)

**[خ] قياسٌ على خادمِ الإنتاجِ الحيّ (CasaOS). لا مستخدمين في القاعدة. لا تيليجرامَ حقيقيٌّ ولا جهازٌ حقيقيّ.**
ADR 0294 · PR #705 (`dd2b8c43`) · وهذه الحزمةُ `wr-21-storage-egress-env-20261030`.

## ١) النشر (بلا مساسٍ بالبوابات)
- الحاويتان `wasla-storage-db-1` (postgres:17-alpine) و`wasla-storage-1` (`supabase/storage-api:v1.84.36@sha256:da5e5e14…`) قائمتان. سجلُّ المخزنِ بلا سطرِ خطأ (`level 50` = 0)، و`/status` = 200.
- الأسرارُ في `/etc/wasla/storage.env` و`/etc/wasla/storage-client.env` (600، root)، وُلِّدت على الخادم ولم تُطبَع.
- الدلوُ `driver-documents`: `public=false`، و`file_size_limit=5242880`، والأنواعُ `image/jpeg` و`image/png` و`application/pdf`.
- HAProxy: إعادةُ تحميلٍ (`HUP`) بلا انقطاع. 40/40 فحصًا لـ`/ready` من الإنترنتِ بقيمة 200 أثناءَها.
- النسخُ الاحتياطيّةُ قبلَ التغيير: `compose.yml` و`haproxy.cfg` و`backup.sh` و`public.env` و`wasla-tunnel-sync.sh` بلاحقةِ `.bak-pre-storage*`.

## ٢) البابُ العامّ (من الإنترنت، عبرَ النفق)
| الطلب | الرمز |
|---|---|
| `GET /storage/v1/bucket` · `POST /storage/v1/bucket` | 403 · 403 |
| `POST …/object/upload/sign/…` (إنشاءُ توقيعٍ) | 403 |
| `GET …/object/driver-documents/x.jpg` (بلا توقيع) | 403 |
| `GET …/object/upload/sign/…` · `PUT …/object/sign/…` (طريقةٌ خاطئة) | 403 · 403 |
| `PUT …/upload/sign/driver-documents/%2e%2e/x.jpg` | 403 |
| `PUT …/upload/sign/driver-documents/../x.jpg` (تُطبِّعُه الحافّة) | 400 |
| `PUT …/upload/sign/…?token=bad` · `GET …/object/sign/…?token=bad` | 400 · 400 (المخزنُ يرفضُ الرمز) |
| `GET /admin` | 403 |

## ٣) الرفعُ والقراءةُ بلا البوابة (توقيعٌ داخليٌّ عبرَ `lb:8090`)
- `PUT` لملفِّ PDF بحجم 300 KB عبرَ الإنترنت: 200 (`{"Key":"driver-documents/e2e-probe/doc.pdf"}`). وإعادةُ الرمزِ نفسِه: 400.
- `HEAD` داخليٌّ بمفتاحِ الخدمة: 200. و`Range: bytes=0-15`: 206 بـ16 بايتًا.
- رابطُ قراءةٍ موقَّعٌ عبرَ الإنترنت: 200، وsha256 المُنزَّلِ يطابقُ الأصل (`fc8c468262436645…`).

## ٤) النسخُ وتمرينُ الاستعادة
- `backup.sh` الجديد: `backup-ok … storage_files=1 storage_tar=304640`.
- `storage-restore-drill.sh` على النسخة `20261030T143018Z`: `files_manifest_equal=yes object_rows=1 compared=1 equal=1 different=0` ⇒ **drill-PASS**. لم يبقَ بعدَه شيءٌ من حاوياتِه أو مجلّداتِه أو شبكتِه (0/0/0).
- **فحصُ الكشف:** نسخةٌ مُفسَدةٌ عمدًا (بايتٌ واحدٌ في الكائن، وsha256 للأرشيفِ أُعيدَ حسابُه حتى يجتازَ فحصَ السلامة) ⇒ `files_manifest_equal=no`، و`mismatch prod=fc8c46826243 drill=75c330571e90` ⇒ **drill-FAIL**. ثمّ حُذفت النسخةُ المُفسَدة.
- **الحدّ:** كائنٌ واحدٌ فقط، والنسخُ على قرصِ الخادمِ نفسِه.

## ٥) عطبٌ وُجدَ بكودِ البوابةِ الحقيقيّ (صورة `dd2b8c43`)
- حاويةٌ لمرّةٍ واحدةٍ من صورةِ البوابة، بملفّاتِ بيئةِ الإنتاج، شغّلت `HttpUploadSigner`. النتيجة: `base=http://lb:8090`، والأصلُ العامُّ مضبوط، لكنّ التوقيعَ ردَّ **`SIGNER_UNAVAILABLE`**.
- السبب: الأصنافُ الأربعةُ في `packages/infrastructure/storage` تبني بوّابةَ الصادرِ بلا بيئة (`createGuardedFetch("supabase-object-storage")`). فلا يُجازُ إلّا مضيفٌ محلّيٌّ أو محفوظ، ويُرفَضُ `lb` (`UNDECLARED_HOST`). ويُرفَضُ كذلك مضيفُ Supabase المستضاف.
- الإصلاح: `{ env: process.env }` كما في `osrm-provider` و`metrics-exporter` و`upstash`. واختبارُ انحدارٍ يفشلُ بدونِه ويجتازُ معه.
- **الرفعُ ما زال `paused`.** الرفعُ الطرفيُّ بالبوابةِ يُعادُ بعدَ نشرِ هذا الإصلاح، ويُسجَّلُ في ملحقٍ لهذا الدليل.
