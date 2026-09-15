/**
 * الغرض: نطاقُ حصيلةِ السائقِ وأدائِه — **النسبةُ كسرٌ لهُ مقامٌ**، والتقييمُ
 *   عدَدٌ معَ ثقتِه، والمالُ **طبقةٌ غائبةٌ بإعلانٍ** لا صفرٌ (`F3-05` · `SD-06`
 *   · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/infrastructure/driver/driver-activity-store.ts` ·
 *   `apps/gateway/src/routes/driver-activity.ts` ·
 *   `apps/miniapp/src/surfaces/driver/activity/*`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` (الاشتراكُ) يعرضُ سجلَّ مدفوعاتٍ بنفسِ
 *   حكمِ النافذةِ — فلا اسمَ ثانياً لمُدّةِ التقريرِ.
 * يحرسُه: scripts/check-driver-activity-contract.ts ·
 *   tests/unit/driver-activity.test.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ النسبةُ `{numerator, denominator, rate}` ولا رقمٌ واحدٌ
 *
 * «نسبةُ قبولِك ٠٪» تُقرأُ حكماً على سائقٍ **لم يُعرَضْ عليه شيءٌ أصلاً**، و
 * «١٠٠٪» من عرضٍ واحدٍ تُقرأُ انتظاماً. والرقمُ الواحدُ يُخفي المقامَ فيُخفي
 * الفرقَ، وقد يُبنى عليه قرارُ حجبٍ أو تحفيزٍ. فالمقامُ **يُنشَرُ دائماً**، و
 * `rate = null` عندَ مقامٍ صفرٍ — **لا صفرٌ ولا قسمةٌ على صفرٍ**.
 *
 * ## ولِمَ لا مالَ في «حصيلتي»
 *
 * لا عمودَ أجرةٍ في المخطَّطِ، والمنصّةُ لا تتوسّطُ نقداً (`ADR 0039` §٤ ·
 * `DEC-11`). فمجموعُ الأرباحِ **غيرُ معلومٍ ولا يُشتَقُّ**، ونصُّ `SD-06` يمنعُ
 * «الوعودَ غيرَ المحسوبةِ» بحرفِه. فالمالُ مفتاحٌ **مُعلَنُ الغيابِ بسببِه**
 * (`NOT_INTERMEDIATED`) كما فُعِلَ بالتقديرِ في `F3-02` (`ADR 0117` §٣).
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — النافذةُ حقيقةُ
 *      خادمٍ تُقرأُ كما قالَها، ولا تُحسَبُ ههنا ولا في شاشةٍ.
 *   ــ **لا يحسبُ نسبةً من نسبةٍ**: كلُّ كسرٍ من صفوفِه الأصليّةِ في الخادمِ،
 *      وههنا **قراءةٌ ووَسْمٌ** فحسب.
 *   ــ **لا يُصنِّفُ سائقاً ولا يُعطيهِ درجةً ولا وسماً تحفيزيّاً**: «ممتازٌ» و
 *      «ضعيفٌ» أحكامٌ لا يُنشِئُها عرضُ أرقامٍ، ولو أُنشِئَت ههنا لَصارَت حقيقةً
 *      ثانيةً بجانبِ معادلةِ الإسنادِ.
 *   ــ **لا يعرفُ أجرةً ولا وسيلةَ دفعٍ ولا خانةً لهما**.
 *   ــ **لا يحملُ هويّةَ راكبٍ ألبتّةَ**: لا اسمَ ولا هاتفَ ولا معرِّفاً — جدولُ
 *      الرحلاتِ سجلُّ السائقِ عن نفسِه لا عن الناسِ.
 */

import type { ServiceType } from "../../shared/kernel/index.ts";

/** مُدَدُ التقريرِ — **مجالٌ مغلقٌ**، والخادمُ يحسبُ حدودَها لا العميلُ. */
export const ACTIVITY_PERIODS = ["day", "week", "month"] as const;

export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

export function isActivityPeriod(value: unknown): value is ActivityPeriod {
  return typeof value === "string" && (ACTIVITY_PERIODS as readonly string[]).includes(value);
}

/**
 * حدُّ النافذةِ **كما قالَه الخادمُ**: `[from, to)` ومنطقةُ زمنِ المدينةِ معَه.
 *
 * ومنطقةُ الزمنِ تُنشَرُ **لتُعرَضَ** لا لتُحسَبَ بها الشاشةُ: سائقٌ يقرأُ
 * «يومُك بتوقيتِ جدّةَ» يفهمُ لِمَ رحلةُ الثانيةِ صباحاً في يومِ أمسِ.
 */
export interface ActivityWindow {
  readonly period: ActivityPeriod;
  readonly timezone: string;
  readonly from: string;
  readonly to: string;
}

/**
 * كسرٌ **بمقامِه**. و`rate` مقروءةٌ من الخادمِ لا محسوبةً ههنا: قسمةٌ في العميلِ
 * وقسمةٌ في الخادمِ حقيقتانِ تفترقانِ في التدويرِ.
 */
export interface ActivityRatio {
  readonly numerator: number;
  readonly denominator: number;
  /** `null` **عندَ مقامٍ صفرٍ** — لا صفرٌ يُقرأُ حكماً. */
  readonly rate: number | null;
}

/** تقييمٌ **تراكميٌّ** بعدَدِه وحدِّ ثقتِه — هوَ الرقمُ الذي يقرأُه الإسنادُ. */
export interface ActivityRating {
  /** `null` = **لا تقييمَ بعدُ** لا «صفرُ نجومٍ». */
  readonly average: number | null;
  readonly count: number;
  /** حدُّ الثقةِ من إعدادِ المدينةِ، و`null` إن لم يُضبَطْ. */
  readonly trustMinCount: number | null;
  /** `null` حينَ لا حدَّ مضبوطاً — **لا يُفترَضُ حدٌّ ولا يُزعَمُ اجتيازُه**. */
  readonly belowTrust: boolean | null;
}

/** تواجدٌ بالثواني، و`open` تقولُ إنَّ الرقمَ **ما زالَ يزيدُ**. */
export interface ActivityAttendance {
  readonly availableSeconds: number;
  readonly open: boolean;
}

/**
 * عاملُ ترتيبٍ **فعليٌّ** بوزنِه من إعدادِ المدينةِ. و`weight = null` تعني «لم
 * يُضبَطْ» لا «صفرٌ»: صفرٌ قرارُ مُشغِّلٍ بتعطيلِ العاملِ، والغيابُ إعدادٌ ناقصٌ.
 */
export const RANKING_FACTORS = ["PROXIMITY", "RATING", "PREFERRED_AREA"] as const;

export type RankingFactorKey = (typeof RANKING_FACTORS)[number];

export function isRankingFactorKey(value: unknown): value is RankingFactorKey {
  return typeof value === "string" && (RANKING_FACTORS as readonly string[]).includes(value);
}

export interface RankingFactor {
  readonly key: RankingFactorKey;
  readonly weight: number | null;
}

/**
 * أساسُ المالِ — **مجالٌ مغلقٌ بقيمةٍ واحدةٍ اليومَ**، والقيمةُ اسمُ السببِ لا
 * نصٌّ للعرضِ. ولو صارَ للمنصّةِ وسيطُ دفعٍ لَأُضيفَ أساسٌ ثانٍ ههنا **فيُسقِطُ
 * المُترجِمُ** كلَّ قارئٍ لم يُحرَّرْ.
 */
export const MONEY_BASES = ["NOT_INTERMEDIATED"] as const;

export type MoneyBasis = (typeof MONEY_BASES)[number];

export function isMoneyBasis(value: unknown): value is MoneyBasis {
  return typeof value === "string" && (MONEY_BASES as readonly string[]).includes(value);
}

/**
 * حصيلةٌ ماليّةٌ **مُعلَنةُ الغيابِ**: `amount` معدومٌ **دائماً** اليومَ، و
 * `basis` يقولُ لِمَ. ووجودُ الحقلِ خيرٌ من حذفِه: حقلٌ معدومٌ بسببٍ منشورٍ
 * يُعرَضُ نصّاً صادقاً، وحقلٌ محذوفٌ يجعلُ الشاشةَ تخترعُ صفراً.
 */
export interface ActivityMoney {
  readonly amount: null;
  readonly basis: MoneyBasis;
}

export interface DriverActivitySummary {
  readonly serverTime: string;
  readonly window: ActivityWindow;
  readonly ridesCompleted: number;
  readonly attendance: ActivityAttendance;
  readonly acceptance: ActivityRatio;
  readonly cancellation: ActivityRatio;
  readonly rating: ActivityRating;
  readonly rankingFactors: readonly RankingFactor[];
  /**
   * **الحقيقةُ كما هيَ**: معادلةُ النقاطِ اليومَ ثلاثةُ عواملَ، ولا نسبةَ قبولٍ
   * ولا إلغاءٍ فيها. فالمفتاحُ يُنشَرُ من الخادمِ **ولا يُكتَبُ نصّاً في شاشةٍ**:
   * يومَ يُضافُ عاملٌ سلوكيٌّ يُقلَبُ في موضعٍ واحدٍ.
   */
  readonly behaviourAffectsRanking: boolean;
  readonly money: ActivityMoney;
}

/** مسافةٌ **موسومةٌ بأساسِها** — خطٌّ مستقيمٌ لا طريقٌ مقطوعٌ (`ADR 0117` §٣). */
export const DISTANCE_BASES = ["STRAIGHT_LINE"] as const;

export type DistanceBasis = (typeof DISTANCE_BASES)[number];

export function isDistanceBasis(value: unknown): value is DistanceBasis {
  return typeof value === "string" && (DISTANCE_BASES as readonly string[]).includes(value);
}

export interface ActivityDistance {
  readonly km: number;
  readonly basis: DistanceBasis;
}

/** صفٌّ في الجدولِ التفصيليِّ — رحلةٌ **مُكتمِلةٌ** بأختامِها. */
export interface DriverActivityEntry {
  readonly orderId: string;
  readonly service: ServiceType;
  readonly matchedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string;
  /** `null` = **ختمُ البدءِ غائبٌ** لا «رحلةٌ لحظيّةٌ». */
  readonly durationSeconds: number | null;
  /** `null` = **لا مسافةَ مقيسةً** لا صفرُ كيلومترٍ. */
  readonly distance: ActivityDistance | null;
}

export interface DriverActivityLog {
  readonly serverTime: string;
  readonly window: ActivityWindow;
  readonly limit: number;
  readonly entries: readonly DriverActivityEntry[];
}

/**
 * وَسْمُ الكسرِ للعرضِ — **دالّةٌ نقيّةٌ** تُقاسُ بلا شاشةٍ.
 *
 * و`UNMEASURED` ليسَ تجميلاً: هوَ الفرقُ بينَ «لم يُعرَضْ عليكَ شيءٌ» و«عُرِضَ
 * ورفضتَ». والشاشةُ تختارُ نصَّها بهذا الوَسْمِ لا بمقارنةِ أرقامٍ في نفسِها.
 */
export type RatioVerdict = "UNMEASURED" | "MEASURED";

export function ratioVerdict(ratio: ActivityRatio): RatioVerdict {
  return ratio.denominator <= 0 || ratio.rate === null ? "UNMEASURED" : "MEASURED";
}

/**
 * نسبةٌ مئويّةٌ **مُدوَّرةٌ للعرضِ**، أو `null` إن كانت غيرَ مقيسةٍ.
 *
 * والتدويرُ ههنا **للعرضِ وحدَه** ولا يُعادُ إدخالُه في حسابٍ: رقمٌ مُدوَّرٌ
 * يُجمَعُ ثمَّ يُقارَنُ يُنتِجُ مجاميعَ لا تُطابِقُ مصادرَها.
 */
export function ratioPercent(ratio: ActivityRatio): number | null {
  if (ratioVerdict(ratio) === "UNMEASURED" || ratio.rate === null) return null;
  return Math.round(ratio.rate * 1000) / 10;
}

/**
 * ثوانٍ ⇒ `{hours, minutes}` — **بلا تدويرٍ إلى أقربِ ساعةٍ**: سائقٌ عملَ ساعةً
 * وخمسينَ دقيقةً لا يُقالُ له «ساعتانِ». والسالبُ يُقرأُ صفراً لأنَّه مستحيلٌ في
 * مصدرِه، فلا يُعرَضُ ناقصاً يُفسِّرُه السائقُ عطباً.
 */
export function splitAttendance(seconds: number): {
  readonly hours: number;
  readonly minutes: number;
} {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return { hours: Math.floor(safe / 3600), minutes: Math.floor((safe % 3600) / 60) };
}

/**
 * وَسْمُ التقييمِ للعرضِ — ثلاثُ حالاتٍ **مُسمّاةٌ** لا فرعانِ:
 *
 *   ــ `NONE`: لا تقييمَ بعدُ — والإسنادُ يُعطيهِ القيمةَ الافتراضيّةَ للمدينةِ،
 *      فلا يُقالُ له «صفرٌ» ولا يُخوَّفُ.
 *   ــ `BELOW_TRUST`: لهُ متوسّطٌ ولكن دونَ حدِّ الثقةِ — **يُعرَضُ ويُقالُ عنه
 *      أنَّه لم يستقرَّ**، ولا يُحجَبُ (حجبُه يجعلُ السائقَ يظنُّ أنَّ شيئاً
 *      يُخفى عنه).
 *   ــ `TRUSTED`: بلغَ الحدَّ.
 */
export type RatingVerdict = "NONE" | "BELOW_TRUST" | "TRUSTED";

export function ratingVerdict(rating: ActivityRating): RatingVerdict {
  if (rating.count <= 0 || rating.average === null) return "NONE";
  // حدٌّ غيرُ مضبوطٍ **لا يُفترَضُ**: يُقرأُ «موثوقاً» بما هوَ، ولا يُخترَعُ حدٌّ
  // في العميلِ يُقالُ للسائقِ إنَّ تقييمَه غيرُ مستقرٍّ بحكمٍ لم يقلْه أحدٌ.
  if (rating.belowTrust === true) return "BELOW_TRUST";
  return "TRUSTED";
}
