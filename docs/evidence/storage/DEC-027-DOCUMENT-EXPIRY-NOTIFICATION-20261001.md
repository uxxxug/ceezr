# DEC-27 — إشعار انتهاء وثائق السائق قبل ثلاثين يومًا

**التاريخ**: 2026-10-01
**الحالة**: مُنفَّذ · مُختبَر محلّيًّا
**ADR**: 0224

## الدَّينُ المُعلَن

`packages/application/driver/driver-documents.ts` السطر 31:

> إشعارٌ يُرسَلُ قبلَ ثلاثينَ يوماً دَينٌ مُعلَنٌ لا مُنفَّذٌ.

## التنفيذ

### الهجرة

`supabase/migrations/20261001030000_dec_27_document_expiry_warning.sql`:

- `expiry_warning_sent_at timestamptz` على `driver_documents`.
- `driver_documents_expiring_soon(uuid, integer)` — الوثائقُ المقبولةُ التي تنتهي
  خلال N يومًا ولم يُنبَّهْ صاحبُها.
- `record_document_expiry_warning(uuid)` — تثبيتُ الإشعارِ.

### طبقةُ التطبيق

`packages/application/driver/warn-expiring-documents.ts`:
- `DocumentExpiryRpcPort` — `expiringSoon` و `recordWarning`.
- `DocumentExpiryWarningSender` — واجهةُ إرسالٍ واحدةٌ.
- `warnExpiringDocuments` — تُرسِلُ لكلِّ وثيقةٍ وتُسجِّلُ بعدَ النجاحِ.

### البنيةُ التحتية

- `packages/infrastructure/driver/document-expiry-rpc.ts` — منفذُ PostgreSQL.
- `packages/infrastructure/notification/document-expiry-sender.ts` — مُرسِلُ تلغرام.
- `apps/workers/src/jobs/warn-expiring-documents.ts` — مهمّةُ العاملِ.

### التركيب

`apps/workers/src/container.ts`:
- `warnExpiringDocuments: 21_600` في `JOB_INTERVALS`.
- `warn-expiring-documents:${cityId}` مسجَّلةٌ لكلِّ مدينةٍ.
- تُعيدُ استخدام `warningSender` (نفسُ مُرسِلِ اشتراكٍ منتهٍ).

## الاختبارات

`tests/unit/warn-expiring-documents.test.ts` — ٦ اختباراتِ وحدةٍ:

1. إرسالُ إشعارٍ لكلِّ وثيقةٍ تنتهي قريبًا.
2. تسجيلُ التحذيرِ بعدَ الإرسالِ الناجحِ.
3. عدمُ تسجيلِ التحذيرِ عند فشلِ الإرسالِ + قائمةُ الفشلِ.
4. يعملُ بلا وثائقَ منتهيةٍ قريبًا.
5. يعيدُ فشلَ RPC عند فشلِ الاستعلامِ.
6. يواصلُ بقيةَ الدفعةِ عند فشلِ إرسالٍ واحدٍ.

`tests/unit/embedded-worker.test.ts` — تحديثُ `jobCount` من ١٧ إلى ١٨ وإضافةُ
`warn-expiring-documents:${CITY_ID}` لقائمةِ الأسماءِ المثبَّتةِ.

## حصيلةُ المحلي

- `bun test`: ٦٤٩٤ ناجحًا · ١٦١٦ متخطّى · ٠ فاشلٍ.
- `typecheck`: ناجحٌ.
- `lint`: ناجحٌ.
- `check-schema-contract --write`: ١٥٤ دالّةً و٣٠ جدولًا (كانت ١٥٢).

## عقدُ المخطّط

`packages/infrastructure/db/schema-contract.ts` — أُضيفت:
- `driver_documents_expiring_soon(uuid, integer)`
- `record_document_expiry_warning(uuid)`

## ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`)

ولا يُدَّعى قياسٌ إنتاجيٌّ (`ح-5`).
