# DEC-30 — فاحصُ وجودِ الكائنِ في المخزنِ

## الملخّصُ

تنشيطُ الدَّينِ المُعلَنِ في `signed-upload.ts`: «مطابقةُ وجودِ الكائنِ فعلاً دَينٌ مُعلَنٌ».
أُضيفَ `ObjectExistenceChecker` يتحقَّقُ من وجودِ الكائنِ في المخزنِ قبلَ تسجيلِه.

## التغييراتُ

| الملفُ | الوصفُ |
|---|---|
| `packages/application/driver/ports.ts` | `ObjectExistenceChecker` port + `ObjectExistenceFailure` |
| `packages/application/driver/driver-documents.ts` | `OBJECT_NOT_FOUND` رمزٌ + `existenceChecker?` في `DriverDocumentDeps` + استدعاءُ الفاحصِ |
| `packages/infrastructure/storage/object-existence-checker.ts` | `HttpObjectExistenceChecker` — نداءُ HEAD |
| `apps/gateway/src/index.ts` | توصيلُ الفاحصِ في الحاويةِ |
| `apps/gateway/src/routes/driver-documents.ts` | `OBJECT_NOT_FOUND: 422` في خريطةِ الحالاتِ |
| `packages/shared/i18n/miniapp/ar.json` · `en.json` · `ur.json` | `driver.documents.error.OBJECT_NOT_FOUND` |
| `tests/unit/object-existence-check.test.ts` | ٤ اختباراتِ وحدةٍ |
| `docs/adr/0227-object-existence-check.md` | ADR |

## القياسُ

- محليّاً: ٦٥١٨ ناجحًا · ١٦١٦ متخطّاةً · ٠ فاشلاً
- `typecheck` نظيفٌ · `lint` نظيفٌ

## ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`)

ولا يُدَّعى قياسٌ إنتاجيٌّ (`ح-5`).
