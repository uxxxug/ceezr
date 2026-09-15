/**
 * الغرض: نموذجُ عرضِ حصيلةِ السائقِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ
 *   نصٍّ وأرقامٍ معروضةٍ، **بلا JSX وبلا شبكةٍ وبلا ساعةٍ** (`F3-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/activity
 * يُستخدم من: `ActivityScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — لوحُ الاشتراكِ نموذجُه لهُ لا ههنا.
 * يحرسُه: scripts/check-driver-activity-contract.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ النسبةُ **تُصاغُ ثلاثةَ أحوالٍ** لا رقماً واحداً
 *
 * «٠٪» و«لم تُقَسْ» حالانِ لا حالٌ: أولاهُما حكمٌ على سائقٍ، والثانيةُ إقرارٌ
 * بأنَّ النظامَ لم يُعطِه فرصةً يُحكَمُ بها. فالمقامُ الصفرُ يُعطي **مفتاحَ
 * «غيرِ مقيسةٍ»** ويُعرَضُ معَه المقامُ نفسُه ليرى السائقَ لِمَ.
 *
 * ## ولِمَ الساعاتُ تُصاغُ من ثوانٍ ههنا ولا تأتي جاهزةً
 *
 * لأنَّ **الصياغةَ عرضٌ والحسابَ حقيقةٌ**: الخادمُ يُرسِلُ ثوانيَ لأنَّها وحدةٌ لا
 * تُدوَّرُ، والشاشةُ تُصيِّرُها «س:د» لأنَّ إنساناً يقرأُ. ولو أرسلَ الخادمُ نصّاً
 * مُصاغاً لَصارَ في الخادمِ قرارُ لغةٍ وتدويرٍ لا يخصُّه.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — ولا يُحسَبُ عُمرٌ
 *      من فرقٍ عن ساعةِ جهازٍ، ولا تُقارَنُ نافذةٌ بزمنٍ محليٍّ.
 *   ــ **لا يجمعُ ولا يُقسِّمُ حقيقةً**: النِسَبُ من الخادمِ، وههنا **صياغةٌ**.
 *   ــ **لا يُخترِعُ مالاً**: لا سعرَ ولا معدَّلَ ساعةٍ ولا حسابَ أجرةٍ.
 *   ــ **لا يُقارِنُ سائقاً بسائقٍ**: لا رُتبةَ ولا مِئينَ ولا متوسّطَ مدينةٍ.
 *   ــ **لا يُخفي عاملَ ترتيبٍ لأنَّ وزنَه غيرُ معروفٍ**: يُعرَضُ العاملُ ويُقالُ
 *      «غيرُ معروفٍ» — وحذفُه كانَ سيُري شفافيّةً ناقصةً وهيَ تُقدَّمُ كامِلةً.
 */

import type {
  ApiActivityPeriod,
  ApiActivityRatio,
  ApiDriverActivityEntry,
  ApiRankingFactorKey,
  DriverActivityEntriesResponse,
  DriverActivitySummaryResponse,
} from "./activity-contract.ts";

/** المُدَدُ **بترتيبِ عرضِها** — لا تُشتَقُّ من مفاتيحِ كائنٍ فيتغيَّرَ ترتيبُها. */
export const ACTIVITY_PERIOD_ORDER: readonly ApiActivityPeriod[] = ["day", "week", "month"];

/** رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — مُقابِلةٌ لقائمةِ الطبقةِ حرفاً. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "ACTIVITY_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PERIOD_INVALID",
  "WINDOW_UNRESOLVED",
]);

export function activityErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? `driver.activity.error.${code}` : "driver.activity.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. و`WINDOW_UNRESOLVED` منها: إعدادُ
 * مدينةٍ ناقصٌ قد يُزرَعُ في دقيقةٍ، فزرُّ إعادةٍ أصدقُ من شاشةٍ ميّتةٍ. أمّا
 * «ليسَ سائقاً» فليسَ منها: إعادةُ النداءِ تردُّ الرفضَ عينَه إلى الأبدِ.
 */
export function isRetryableActivityError(code: string): boolean {
  return (
    code === "ACTIVITY_STORE_NOT_AVAILABLE" ||
    code === "SESSION_NOT_AVAILABLE" ||
    code === "WINDOW_UNRESOLVED" ||
    code === "UNKNOWN"
  );
}

/** حكمُ الكسرِ — **المقامُ هوَ الفاصلُ** لا البَسْطُ. */
export type RatioVerdict = "UNMEASURED" | "MEASURED";

export interface RatioModel {
  readonly verdict: RatioVerdict;
  readonly numerator: number;
  readonly denominator: number;
  /** نسبةٌ مِئويّةٌ مُدوَّرةٌ لعرضٍ، و`null` عندَ **غيابِ القياسِ** لا عندَ صفرٍ. */
  readonly percent: number | null;
}

export function toRatio(ratio: ApiActivityRatio): RatioModel {
  // **المقامُ لا `rate`** هوَ ما يُقرَّرُ به: خادمٌ يُرسِلُ `rate: 0` معَ مقامٍ
  // موجبٍ يقولُ حقيقةً مقيسةً، وصفرٌ حينَها حكمٌ صحيحٌ يُعرَضُ.
  if (ratio.denominator === 0 || ratio.rate === null) {
    return {
      verdict: "UNMEASURED",
      numerator: ratio.numerator,
      denominator: ratio.denominator,
      percent: null,
    };
  }
  return {
    verdict: "MEASURED",
    numerator: ratio.numerator,
    denominator: ratio.denominator,
    percent: Math.round(ratio.rate * 100),
  };
}

/**
 * ساعاتٌ ودقائقُ من ثوانٍ — **بلا تدويرٍ إلى أعلى**: «٥٩ دقيقةً» لا تُصيَّرُ
 * ساعةً، لأنَّ سائقاً يرى ساعةً لم يعملْها يفقدُ الثقةَ في العدَّادِ كلِّه.
 */
export interface DurationModel {
  readonly hours: number;
  readonly minutes: number;
}

export function toDuration(seconds: number): DurationModel {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return { hours: Math.floor(safe / 3600), minutes: Math.floor((safe % 3600) / 60) };
}

export interface RankingFactorModel {
  readonly key: ApiRankingFactorKey;
  readonly labelKey: string;
  /** `null` = **لم يُضبَطْ وزنٌ** — يُقالُ «غيرُ معروفٍ» ولا يُعرَضُ صفراً. */
  readonly weight: number | null;
}

export interface ActivitySummaryModel {
  readonly serverTime: string;
  readonly period: ApiActivityPeriod;
  readonly timezone: string;
  readonly from: string;
  readonly to: string;
  readonly ridesCompleted: number;
  readonly duration: DurationModel;
  /** فترةٌ جاريةٌ — الرقمُ **ما زالَ يزيدُ** ويُقالُ ذلكَ صراحةً. */
  readonly attendanceOpen: boolean;
  readonly acceptance: RatioModel;
  readonly cancellation: RatioModel;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly ratingTrustMinCount: number | null;
  /** `null` = لا حدَّ ثقةٍ مضبوطٌ — **لا حكمَ** لا «فوقَ الحدِّ». */
  readonly ratingBelowTrust: boolean | null;
  readonly rankingFactors: readonly RankingFactorModel[];
  readonly behaviourAffectsRanking: boolean;
  /** مفتاحُ نصِّ **سببِ غيابِ المبلغِ** — لا رقمَ ولا فراغَ. */
  readonly moneyBasisKey: string;
}

export function toActivitySummary(response: DriverActivitySummaryResponse): ActivitySummaryModel {
  return {
    serverTime: response.server_time,
    period: response.window.period,
    timezone: response.window.timezone,
    from: response.window.from,
    to: response.window.to,
    ridesCompleted: response.rides.completed,
    duration: toDuration(response.attendance.available_seconds),
    attendanceOpen: response.attendance.open,
    acceptance: toRatio(response.acceptance),
    cancellation: toRatio(response.cancellation),
    ratingAverage: response.rating.average,
    ratingCount: response.rating.count,
    ratingTrustMinCount: response.rating.trust_min_count,
    ratingBelowTrust: response.rating.below_trust,
    rankingFactors: response.ranking.factors.map((factor) => ({
      key: factor.key,
      labelKey: `driver.activity.ranking.factor.${factor.key}`,
      weight: factor.weight,
    })),
    behaviourAffectsRanking: response.ranking.behaviour_affects_ranking,
    moneyBasisKey: `driver.activity.money.basis.${response.money.basis}`,
  };
}

export interface ActivityEntryModel {
  readonly orderId: string;
  readonly serviceKey: string;
  readonly completedAt: string;
  /** `null` = لا ختمَ بدءٍ — تُقالُ «غيرُ معروفةٍ» ولا تُحسَبُ من المطابَقةِ. */
  readonly duration: DurationModel | null;
  readonly distanceKm: number | null;
  /** مفتاحُ **أساسِ المسافةِ** — خطٌّ مستقيمٌ يُقالُ صريحاً لا يُوهَمُ طريقاً. */
  readonly distanceBasisKey: string | null;
}

export function toActivityEntry(entry: ApiDriverActivityEntry): ActivityEntryModel {
  return {
    orderId: entry.order_id,
    serviceKey: `driver.activity.service.${entry.service}`,
    completedAt: entry.completed_at,
    duration: entry.duration_seconds === null ? null : toDuration(entry.duration_seconds),
    distanceKm: entry.distance === null ? null : entry.distance.km,
    distanceBasisKey:
      entry.distance === null ? null : `driver.activity.distance.basis.${entry.distance.basis}`,
  };
}

export interface ActivityLogModel {
  readonly limit: number;
  readonly entries: readonly ActivityEntryModel[];
}

export function toActivityLog(response: DriverActivityEntriesResponse): ActivityLogModel {
  return { limit: response.limit, entries: response.entries.map(toActivityEntry) };
}
