# DEC-28 — تقدُّمُ رفعِ الوثائقِ بالنسبةِ المئويّةِ

## الملخّصُ

تنشيطُ الدَّينِ المُعلَنِ في `documents-contract.ts`: «لا تقدُّمَ رفعٍ بالنسبةِ المئويّةِ».
أُضيفتَ `uploadFileToSlotWithProgress` باستخدامِ `XMLHttpRequest` و `upload.onprogress`.

## التغييراتُ

| الملفُ | الوصفُ |
|---|---|
| `apps/miniapp/src/surfaces/driver/documents/documents-api.ts` | دالّةٌ جديدةٌ `uploadFileToSlotWithProgress` مع `onProgress` و `createXhr` مُحقَنٍ |
| `apps/miniapp/src/surfaces/driver/documents/documents-contract.ts` | تحديثُ تعليقِ الدَّينِ إلى «مُنشَطٌ» |
| `tests/unit/upload-progress.test.ts` | ٨ اختباراتِ وحدةٍ |
| `docs/adr/0225-document-upload-progress.md` | ADR |

## القياسُ

- محليّاً: ٦٥٠٣ ناجحاً · ١٦١٦ متخطّاةً · ٠ فاشلاً
- `typecheck` نظيفٌ (لا أخطاءَ جديدةٌ)
- `lint` نظيفٌ

## ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`)

ولا يُدَّعى قياسٌ إنتاجيٌّ (`ح-5`).
