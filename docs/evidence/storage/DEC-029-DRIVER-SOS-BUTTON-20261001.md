# DEC-29 — زرُّ استغاثةِ السائقِ في شاشةِ المَهمّةِ

## الملخّصُ

تنشيطُ الدَّينِ المُعلَنِ في `JobScreen.tsx`: «لا تُظهِرُ زرَّ نجدةٍ».
أُضيفَ زرُّ استغاثةٍ يستدعي `POST /v1/driver/safety/sos` (F12-22).

## التغييراتُ

| الملفُ | الوصفُ |
|---|---|
| `apps/miniapp/src/surfaces/driver/job/job-api.ts` | دالّةٌ جديدةٌ `triggerDriverSos` |
| `apps/miniapp/src/surfaces/driver/job/JobScreen.tsx` | زرُّ استغاثةٍ + `triggerSos?` prop + `SosState` |
| `apps/miniapp/src/surfaces/driver/job/job-view.ts` | `SosButtonState` · `sosStateKey` · `isSosButtonDisabled` |
| `packages/shared/i18n/miniapp/ar.json` · `en.json` · `ur.json` | ٦ مفاتيح `driver.job.sos.*` |
| `apps/miniapp/src/styles/global.css` | أنماطُ `djb__sos*` |
| `tests/unit/driver-sos-button-view.test.ts` | ١١ اختبارَ وحدةٍ |
| `docs/adr/0226-driver-sos-button.md` | ADR |

## القياسُ

- محليّاً: ٦٥١٤ ناجحًا · ١٦١٦ متخطّاةً · ٠ فاشلاً
- `typecheck` نظيفٌ · `lint` نظيفٌ

## ولا `[x]` قبلَ ثلاثِ جولاتٍ خضراءَ (`ح-4`)

ولا يُدَّعى قياسٌ إنتاجيٌّ (`ح-5`).
