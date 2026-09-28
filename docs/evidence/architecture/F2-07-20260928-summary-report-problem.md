# F2-07 · SR-08 — «الإبلاغُ عن مشكلةٍ» من شاشةِ نهايةِ الرحلةِ (2026-09-28)

- **البندُ**: `F2-07` — `SR-07` + `SR-08` الإنهاءُ والتقييمُ. الشقُّ المنفَّذُ ههنا: «الإبلاغُ عن مشكلةٍ» من نصِّ `SR-08`.
- **الدرجةُ**: مُنفَّذ · مُختبَر (حاجزُ نصٍّ + بناءٌ + أنواعٌ) — لا `مَقيس` ولا `مُثبَت` (`ح-5`). **`F2-07` يبقى `[~]`**.
- **القرارُ**: `docs/adr/0207-ride-summary-report-problem-raises-intent-router-carries-the-ride.md`.
- **المنشأُ**: `docs/REMAINING-WORK-MAP-20260908.md` §8.2 — الصنفُ (أ) «عملٌ مستودعيٌّ قابلٌ للتنفيذِ الآنَ».

## ١) ما تغيَّرَ

| الموضعُ | التغييرُ |
|---|---|
| `apps/miniapp/src/surfaces/rider/summary/RideSummaryScreen.tsx` | `onReportProblem?` اختياريٌّ · زرٌّ مشروطٌ بالمُستقبِلِ في جسمِ الملخَّصِ · الغيابُ القديمُ مشطوبٌ لا ممحُوّ (`ح-8`) |
| `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` | `onReportProblem={() => setSupport({ orderId: summarized })}` |
| `apps/miniapp/src/surfaces/rider/summary/ride-summary-contract.ts` | تصحيحُ تعليقِ الغيابِ بالإضافةِ؛ العقدُ بلا حقلِ تذكرةٍ |
| `packages/shared/i18n/miniapp/{ar,en,ur}.json` | `rider.summary.reportProblem` (مفتاحٌ واحدٌ في الثلاثةِ) |
| `apps/miniapp/src/styles/global.css` | `.sm__report` (أمسكَ غيابَه حاجزُ تغطيةِ الأصنافِ `UX-021` في أوّلِ تشغيلٍ محلّيٍّ) |
| `scripts/lib/ride-summary-contract.ts` · `scripts/check-ride-summary-contract.ts` | القاعدةُ الثامنةُ `reportEntryProblems` + حقلُ `root` في المدخلِ |
| `tests/unit/check-ride-summary-contract.test.ts` | ٨ اختباراتٍ جديدةٍ: الموجبةُ · أربعُ سالباتٍ للقاعدةِ الثامنةِ + سالبةُ `orderId: null` · سالبةٌ تُثبِتُ أنَّ القاعدةَ الخامسةَ لم تُخفَّفْ · المستودعُ الحقيقيُّ |

## ٢) القياسُ المحلّيُّ (لا حكمَ CI)

- `bun test tests/unit/check-ride-summary-contract.test.ts`: **38 pass · 0 fail**.
- `bun run scripts/check-ride-summary-contract.ts`: نجحَ — ثماني قواعدَ.
- **سالبةٌ على المستودعِ الحقيقيِّ**: حذفُ الوصلِ من `RiderRoot.tsx` ⇒ الحاجزُ يسقطُ برمزِ 1 ورسالةِ
  «الموجِّهُ لا يُوصِلُ onReportProblem …»، ثمَّ أُعيدَ الملفُّ.
- سلسلةُ `ci` كاملةً بـBun 1.4.2 (`JOB_NAME=verify`) خضراءُ **عدا** `check-run-manifest`، وهوَ يقرأُ
  بصمةً تكتبُها خطوةُ CI سابقةٌ فلا يُقاسُ محلّيّاً — ولا يُقرأُ غيابُه نجاحاً.

## ٣) حكمُ CI

يُقرأُ من GitHub Actions بعدَ الدفعِ ويُوثَّقُ ههنا بالإضافةِ.

## ٤) ما يبقى مفتوحاً في `F2-07`

- «المبلغُ» و«الإيصالُ» (`SR-07`): مجمَّدانِ بأثرِ `DEC-11` المحسومِ (`ADR 0039` §٤ · `م13-7`).
- المسافةُ المقطوعةُ: لا أثرَ مسارٍ يُقرأُ للرحلةِ؛ المنشورُ وترٌ مستقيمٌ باسمِه.
