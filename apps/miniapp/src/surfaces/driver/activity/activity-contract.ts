/**
 * الغرض: شكلُ ردَّي حصيلةِ السائقِ كما يقرؤهما العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/activity
 * يُستخدم من: `activity-api.ts` · `activity-view.ts` · `ActivityScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — الاشتراكُ عقدٌ يُضافُ في ملفِّه، ولا
 *   يُوسَّعُ هذا العقدُ ليحملَ خطّةً وسعراً.
 * يحرسُه: scripts/check-driver-activity-contract.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ الكسرُ **ثلاثةُ حقولٍ** لا حقلٌ واحدٌ
 *
 * `rate: 0` و«لا مقامَ» يُرسَمانِ في الواجهةِ رسماً واحداً لو نُشِرَ الكسرُ رقماً
 * وحدَه — فيقرأُ سائقٌ لم يُعرَضْ عليه شيءٌ أنَّه **رفضَ كلَّ شيءٍ**. فالبَسْطُ
 * والمقامُ يُنشَرانِ دائماً، و`rate: null` تعني **لم تُقَسْ** لا صفراً.
 *
 * ## ولِمَ `behaviour_affects_ranking` حقلٌ من الخادمِ لا نصٌّ في الترجمةِ
 *
 * لأنَّ الجوابَ **يتغيَّرُ بتغيُّرِ معادلةِ المطابَقةِ** لا بتغيُّرِ رأيٍ: اليومَ
 * لا يُنقِصُ رفضٌ ترتيباً، ويومَ يُنقِصُه يجبُ أن يتغيَّرَ الجوابُ حيثُ تغيَّرَت
 * المعادلةُ — لا في ملفِّ نصوصٍ يُنسى.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا مبلغَ**: `money.amount` معدومٌ دائماً و`basis` تقولُ لِمَ
 *      (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا هويّةَ راكبٍ في الجدولِ**: لا اسمَ ولا هاتفَ ولا معرِّفاً.
 *   ــ **لا مقارنةً بسائقٍ آخرَ**: لا رُتبةَ ولا متوسّطَ مدينةٍ ولا مِئينٍ.
 *   ــ **لا تاريخَينِ يُرسَلانِ**: المُدّةُ اسمٌ، والنافذةُ تعودُ من الخادمِ.
 */

/** المُدَدُ الثلاثُ — مجالٌ مغلقٌ يُقابِلُ مجالَ النطاقِ والقاعدةِ حرفاً. */
export type ApiActivityPeriod = "day" | "week" | "month";

/**
 * النافذةُ **كما حسبَها الخادمُ**: منطقةُ الزمنِ تُعرَضُ لِيفهمَ السائقُ حدَّ
 * «يومِه» ولا يظنَّ رحلةً ضائعةً حينَ تقعُ بعدَ منتصفِ الليلِ المحليِّ.
 */
export interface ApiActivityWindow {
  readonly period: ApiActivityPeriod;
  readonly timezone: string;
  readonly from: string;
  readonly to: string;
}

/** كسرٌ بمقامِه — و`rate: null` **لم تُقَسْ** لا صفرٌ (`ADR 0023`). */
export interface ApiActivityRatio {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
}

/** ثوانٍ متاحةٌ، و`open` تعني **فترةً ما زالت تجري** فالرقمُ يزيدُ. */
export interface ApiActivityAttendance {
  readonly available_seconds: number;
  readonly open: boolean;
}

export interface ApiActivityRating {
  readonly average: number | null;
  readonly count: number;
  /** حدُّ الثقةِ من `platform_settings` — و`null` تعني **لم يُضبَطْ** لا صفراً. */
  readonly trust_min_count: number | null;
  readonly below_trust: boolean | null;
}

/** عواملُ الترتيبِ الفعليّةُ — أسماؤها من معادلةِ المطابَقةِ لا من نصِّ واجهةٍ. */
export type ApiRankingFactorKey = "PROXIMITY" | "RATING" | "PREFERRED_AREA";

export interface ApiRankingFactor {
  readonly key: ApiRankingFactorKey;
  /** `null` = **لم يُضبَطْ** — ويُفرَّقُ عن صفرٍ يعني «عاملاً مُعطَّلاً بقرارٍ». */
  readonly weight: number | null;
}

/** أساسُ غيابِ المالِ — سببٌ منشورٌ لا حقلٌ مسكوتٌ عنه. */
export type ApiMoneyBasis = "NOT_INTERMEDIATED";

export interface ApiActivityMoney {
  readonly amount: null;
  readonly basis: ApiMoneyBasis;
}

export interface DriverActivitySummaryResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly window: ApiActivityWindow;
  readonly rides: { readonly completed: number };
  readonly attendance: ApiActivityAttendance;
  readonly acceptance: ApiActivityRatio;
  readonly cancellation: ApiActivityRatio;
  readonly rating: ApiActivityRating;
  readonly ranking: {
    readonly factors: readonly ApiRankingFactor[];
    /** **الحقيقةُ من الخادمِ**: هل يُنقِصُ سلوكٌ ترتيباً اليومَ أم لا. */
    readonly behaviour_affects_ranking: boolean;
  };
  readonly money: ApiActivityMoney;
}

/** أساسُ المسافةِ — خطٌّ مستقيمٌ لا طريقٌ مقطوعٌ (`ADR 0117` §٣). */
export type ApiDistanceBasis = "STRAIGHT_LINE";

export interface ApiActivityDistance {
  readonly km: number;
  readonly basis: ApiDistanceBasis;
}

export interface ApiDriverActivityEntry {
  readonly order_id: string;
  readonly service: "transport" | "delivery";
  readonly matched_at: string | null;
  readonly started_at: string | null;
  readonly completed_at: string;
  /** `null` = لا ختمَ بدءٍ — **غيابٌ لا صفرٌ** ولا يُحسَبُ من المطابَقةِ. */
  readonly duration_seconds: number | null;
  readonly distance: ApiActivityDistance | null;
}

export interface DriverActivityEntriesResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly window: ApiActivityWindow;
  /** السقفُ **المُنفَذُ** لا المطلوبُ — فيعلمُ العميلُ أنَّ طلبَه قُصِرَ. */
  readonly limit: number;
  readonly entries: readonly ApiDriverActivityEntry[];
}
