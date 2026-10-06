# جردُ أسطحِ الواجهة — UI-1 / PR 0

**التاريخ:** 2026-10-06 · **القرار:** ADR 0233 §5
**المصدرُ المُلزِم:** `scripts/lib/ui-surface-inventory.ts`، ويطابقُه الحاجزُ
`scripts/check-ui-surface-inventory.ts` مع القرصِ في كلِّ CI.

هذه الوثيقةُ ملخّصٌ يُقرأ. عندَ أيِّ اختلافٍ، السجلُّ هوَ المرجع.

## الملخّص (مقيسٌ على `main` بعدَ `fe56555`)

| المجموعة | الجذر | النوع | العدد |
|---|---|---|---|
| miniapp/rider | `apps/miniapp/src/surfaces/rider` | `.tsx` | 20 |
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
| **المجموع** | | | **82** |

> **UI-2 / PR 2 (2026-10-06 · ADR 0234):** أُضيفَ `apps/miniapp/src/shell/ScreenFrame.tsx`
> (`ScreenFrame` + التبويبُ الجذريُّ + `BackButton` + `ScreenTransition`) إلى `miniapp/shell`
> فصارتِ المجموعةُ 4 والمجموعُ 81. لا سطحَ آخرُ تغيّر.
>
> **UI-3 / PR 4 (2026-10-06 · ADR 0237):** أُضيفَ `apps/miniapp/src/surfaces/rider/active/RideJourney.tsx`
> (سكّةُ الرحلةِ `UiRail` وشريطُ حقيقتِها `UiTruth` في R6/R7) إلى `miniapp/rider` فصارتِ المجموعةُ 20
> والمجموعُ 82.

ملفّاتُ الاختبارِ (`*.test.ts`/`*.test.tsx`) خارجَ الجرد.

## ما لا يدّعيه الجرد

- **إسنادُ R0–R15 وD0–D14 جزئيّ.** أُسنِدَ منها ما نُفِّذ: **R0–R5** في ADR 0235 (UI-3)، و**D0–D14** في
  ADR 0236 (UI-4) **من المصدرِ الأصليِّ (PDF v2.0) بمطابقةٍ مباشرة** — Canonical Source Mapping، و**R6–R15**
  من المصدرِ الأصليِّ في ADR 0237 (UI-3 / PR 4): المنفّذُ منها R6–R10، وR11–R15 لـPR 5.

  | R | التعريفُ الكانونيّ | ملفُّ السطح (`miniapp/rider`) | الحالة |
  |---|---|---|---|
  | R6 | البحث عن سائق | `search/SearchScreen.tsx` · `active/RideJourney.tsx` | PR 4 |
  | R7 | الرحلة النشطة | `active/ActiveRideScreen.tsx` · `active/RideJourney.tsx` | PR 4 |
  | R8 | مشاركة الرحلة | `share/RideShareCard.tsx` (داخلَ R7) | PR 4 |
  | R9 | SOS | `sos/SosScreen.tsx` · `sos/SosCard.tsx` · `sos/SosEntry.tsx` | PR 4 |
  | R10 | ملخص الرحلة والتقييم | `summary/RideSummaryScreen.tsx` | PR 4 |
  | R11 | سجل الرحلات وتفاصيلها | `history/RideHistoryScreen.tsx` · `history/RideDetailScreen.tsx` | PR 5 |
  | R12 | الإشعارات | `notifications/NotificationsScreen.tsx` | PR 5 |
  | R13 | حسابي | `account/AccountScreen.tsx` | PR 5 |
  | R14 | الخصوصية والشروط | `privacy/PrivacyScreen.tsx` | PR 5 |
  | R15 | الدعم والتذاكر والمفقودات وFAQ | `support/SupportScreen.tsx` · `faq/FaqScreen.tsx` | PR 5 |

  | D | التعريفُ الكانونيّ | ملفُّ السطح (`miniapp/driver` ما لم يُذكَر) |
  |---|---|---|
  | D0 | الهيكل وبث الموقع | `DriverRoot.tsx` · `location/LocationBroadcast.tsx` |
  | D1 | لوح العروض | `offers/OffersScreen.tsx` |
  | D2 | بطاقة العرض | `offers/OffersScreen.tsx` (عنصرُ اللوح) |
  | D3 | تفاصيل العرض | `offers/OfferDetailScreen.tsx` |
  | D4 | المهمة الحالية | `job/JobScreen.tsx` |
  | D5 | تعذّر الإكمال | `job/JobScreen.tsx` |
  | D6 | ملخص رحلة السائق وتقييم الراكب | `summary/DriverRideSummaryScreen.tsx` |
  | D7 | SOS | `job/JobScreen.tsx` |
  | D8 | الوثائق | `documents/DocumentsScreen.tsx` |
  | D9 | المركبة | `vehicle/VehicleScreen.tsx` |
  | D10 | الحصيلة والنشاط | `activity/ActivityScreen.tsx` |
  | D11 | الاشتراك والفاتورة | `subscription/SubscriptionScreen.tsx` · `PaymentInvoicePanel.tsx` |
  | D12 | الحساب وحذفه | `account/AccountScreen.tsx` · `miniapp/account/AccountRights.tsx` |
  | D13 | دعم السائق وكشف الخصوم | `support/SupportScreen.tsx` · `deductions/DeductionTraceScreen.tsx` |
  | D14 | تسجيل السائق من الـMini App | `miniapp/onboarding/OnboardingRoot.tsx` (فجوةُ عقدٍ مسجّلة · ADR 0236) |

  لا ملفَّ `.tsx` جديدٌ في UI-4: آلةُ الحالةِ (`driver-flow.ts`) ومؤقّتُ العرضِ (`offer-timer.ts`)
  وخطواتُ الرفعِ (`upload-steps.ts`) منطقٌ نقيٌّ لا سطح، فالعددُ ثابت (14 للسائق، 81 مجموعاً).
- **لا تصنيفَ [A/B/C/D] لكلِّ ملفّ.** وجودُ الملفِّ لا يعني أنَّ السطحَ «قائمٌ بالكامل».
- **العقودُ المحميّةُ (§0.3) ليست أسطحاً عرضيّة** ولا تدخلُ الجرد:
  `*contract.ts` و`*api.ts` و`*view.ts`. قِيسَ تحتَ `apps/miniapp/src/surfaces` **76** ملفّاً منها،
  ولا يغيّرُ PR 0 أيّاً منها.
