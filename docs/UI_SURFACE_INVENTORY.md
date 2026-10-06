# جردُ أسطحِ الواجهة — UI-1 / PR 0

**التاريخ:** 2026-10-06 · **القرار:** ADR 0233 §5
**المصدرُ المُلزِم:** `scripts/lib/ui-surface-inventory.ts`، ويطابقُه الحاجزُ
`scripts/check-ui-surface-inventory.ts` مع القرصِ في كلِّ CI.

هذه الوثيقةُ ملخّصٌ يُقرأ. عندَ أيِّ اختلافٍ، السجلُّ هوَ المرجع.

## الملخّص (مقيسٌ على `main` بعدَ `fe56555`)

| المجموعة | الجذر | النوع | العدد |
|---|---|---|---|
| miniapp/rider | `apps/miniapp/src/surfaces/rider` | `.tsx` | 19 |
| miniapp/driver | `apps/miniapp/src/surfaces/driver` | `.tsx` | 14 |
| miniapp/account | `apps/miniapp/src/surfaces/account` | `.tsx` | 1 |
| miniapp/admin | `apps/miniapp/src/surfaces/admin` | `.tsx` | 1 |
| miniapp/onboarding | `apps/miniapp/src/surfaces/onboarding` | `.tsx` | 1 |
| miniapp/support | `apps/miniapp/src/surfaces/support` | `.tsx` | 1 |
| miniapp/shell | `apps/miniapp/src/shell` | `.tsx` | 4 |
| miniapp/system | `apps/miniapp/src/system` | `.tsx` | 4 |
| admin-dashboard/pages | `apps/admin-dashboard/src/pages` | `.ts` | 15 |
| telegram/bots | `apps/gateway/src/bots` | `.ts` | 20 |
| public-tracking | `apps/gateway/src/routes/public-tracking.ts` | `.ts` | 1 |
| **المجموع** | | | **81** |

> **UI-2 / PR 2 (2026-10-06 · ADR 0234):** أُضيفَ `apps/miniapp/src/shell/ScreenFrame.tsx`
> (`ScreenFrame` + التبويبُ الجذريُّ + `BackButton` + `ScreenTransition`) إلى `miniapp/shell`
> فصارتِ المجموعةُ 4 والمجموعُ 81. لا سطحَ آخرُ تغيّر.

ملفّاتُ الاختبارِ (`*.test.ts`/`*.test.tsx`) خارجَ الجرد.

## ما لا يدّعيه الجرد

- **لا إسنادَ لأرقامِ R0–R15 وD0–D14.** تعريفُها في PDF v2.0، وهوَ ليسَ في المستودع.
- **لا تصنيفَ [A/B/C/D] لكلِّ ملفّ.** وجودُ الملفِّ لا يعني أنَّ السطحَ «قائمٌ بالكامل».
- **العقودُ المحميّةُ (§0.3) ليست أسطحاً عرضيّة** ولا تدخلُ الجرد:
  `*contract.ts` و`*api.ts` و`*view.ts`. قِيسَ تحتَ `apps/miniapp/src/surfaces` **76** ملفّاً منها،
  ولا يغيّرُ PR 0 أيّاً منها.
