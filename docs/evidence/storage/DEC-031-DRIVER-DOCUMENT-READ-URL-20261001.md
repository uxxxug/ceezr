# DEC-31 — رابطُ قراءةٍ موقَّعٌ لوثائقِ السائقِ في الميني-أب

## الملخّصُ

تنشيطُ الدَّينِ المُعلَنِ في `documents-contract.ts`: «لا رابطَ قراءةٍ للوثيقةِ المرفوعةِ».
أُضيفَ مسارُ `GET /v1/driver/documents/:docType/read-url` يُوقِّعُ رابطَ قراءةٍ عبرَ
`ReadUrlSigner`.

## التغييراتُ

| الملفُ | الوصفُ |
|---|---|
| `packages/application/driver/ports.ts` | `readObjectPath` method في `DriverDocumentStore` |
| `packages/application/driver/driver-documents.ts` | `readDriverDocumentUrl` + `DriverDocumentReadUrl` + `OBJECT_NOT_SUBMITTED` + `readSigner?` |
| `packages/infrastructure/driver/driver-documents-store.ts` | `readObjectPath` implementation |
| `apps/gateway/src/index.ts` | توصيلُ `readSigner` في الحاويةِ |
| `apps/gateway/src/routes/driver-documents.ts` | `GET /v1/driver/documents/:docType/read-url` + `OBJECT_NOT_SUBMITTED: 404` |
| `apps/miniapp/src/surfaces/driver/documents/documents-api.ts` | `readDriverDocumentUrl` + `DriverDocumentReadUrlResponse` |
| `apps/miniapp/src/surfaces/driver/documents/documents-contract.ts` | تحديثُ تعليقِ الدَّينِ |
| `packages/shared/i18n/miniapp/ar.json` · `en.json` · `ur.json` | `driver.documents.error.OBJECT_NOT_SUBMITTED` |
| `tests/unit/driver-document-read-url.test.ts` | ٤ اختباراتِ وحدةٍ |

## القياسُ

- محليّاً: ٦٥٢٢ ناجحًا · ١٦١٦ متخطّاةً · ٠ فاشلاً
- `typecheck` نظيفٌ · `lint` نظيفٌ

## ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`)

ولا يُدَّعى قياسٌ إنتاجيٌّ (`ح-5`).
