/**
 * الغرض: عقدُ ملخَّصِ الرحلةِ المنتهيةِ وتقييمِها بينَ طبقةِ التطبيقِ والقاعدةِ —
 *   وقائعُ الملخَّصِ وحالةُ التقييمِ وأمرُ إرسالِ التقييمِ بوسومِه، **بلا حكمٍ
 *   وبلا نصٍّ معروضٍ** (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `read-ride-summary.ts` · `submit-ride-rating.ts` ·
 *   `infrastructure/transport/ride-summary-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-09` (تقييمُ السائقِ للراكبِ) يُعيدُ استعمالَ
 *   `RideRatingCommand` بلا حرفٍ جديدٍ — الاتّجاهُ يُستنتَجُ في القاعدةِ من
 *   هويّةِ المُقيِّمِ ولا يُمرَّرُ ههنا.
 * ملاحظات مستقبلية: **لا حقلَ أجرةٍ ولا مبلغٍ ولا وسيلةِ دفعٍ ولا خانةً لها**
 *   قبلَ `DEC-11` (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا عقدٌ رابعٌ ولم يُوسَّعْ عقدُ `F2-06`
 *
 * عقدُ `F2-06` عقدُ **المُتابَعةِ**: بطاقةُ سائقٍ وموقعٌ بعُمرِه، يُقرأُ كلَّ
 * دقيقةٍ. وهذا عقدُ **الخِتامِ**: مدّةٌ ووترُ خطٍّ مستقيمٍ وحالةُ تقييمٍ، يُقرأُ
 * مرّةً **ولا موقعَ فيه**. ولو زِيدَت حقولُ الخِتامِ إلى لقطةِ النشطةِ لَحمَلَ
 * كلُّ استفسارٍ دوريٍّ حسابَ مسافةٍ لا يُعرَضُ، **ولَبقيَ موقعُ السائقِ حقلاً في
 * ردٍّ لرحلةٍ انتهت** فرسمَه عميلٌ حاضراً.
 *
 * ## ولماذا المدّةُ **عددُ ثوانٍ محسوبٌ** لا ختمانِ يُطرَحانِ عندَ القارئِ
 *
 * لأنَّ القاعدةَ وحدَها تملكُ ساعةً واحدةً للختمَينِ. وقد يُرسَلُ الختمانِ
 * (وهما مُرسَلانِ ههنا للعرضِ) لكنَّ **المدّةَ المُعتَمَدةَ** واحدةٌ محسوبةٌ
 * هناك: لو حسبَها كلُّ قارئٍ بنفسِه لَاختلفَ رقمُ الشاشةِ عن رقمِ التقريرِ.
 * و`null` تعني **غيابَ ختمٍ** لا صفرَ ثوانٍ.
 *
 * ## ولماذا `straightLineMeters` بهذا الاسمِ في العقدِ نفسِه
 *
 * لا أثرَ مسارٍ في المخطَّطِ، فالمقطوعُ **غيرُ مُقاسٍ**. والاسمُ يقولُ ما هوَ
 * **في العقدِ** كي لا يُسمّيَه سطحٌ «المسافةَ» بعدَ حدودٍ. وحاجزٌ ساكنٌ يفرضُه.
 *
 * ## وما لا يفعلُه هذا العقدُ عن قصدٍ
 *
 *   ــ **لا موقعَ سائقٍ ولا عُمرَ موقعٍ** — الرحلةُ انتهت.
 *   ــ **لا رقمَ هاتفٍ ولا صورةَ سائقٍ** — لا عمودَ لهما (كما في `F2-06`).
 *   ــ **لا تذكرةَ دعمٍ**: `open_support_ticket` قائمةٌ في القاعدةِ ولها
 *      مُنادونَ (`application/dispute/open-dispute.ts`)، ووصلُها بهذا السطحِ
 *      **خارجَ النطاقِ المحجوزِ** فهيَ غيابٌ مُصرَّحٌ بلا زرٍّ.
 *   ــ **لا حكمَ أهليّةٍ**: الوقائعُ ههنا (`alreadyRated` · `windowClosed`)
 *      والتصنيفُ في النطاقِ.
 */

import type { RatingTag } from "../../domain/transport/ride-summary.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RideStoreFailure } from "./ride-request-ports.ts";

/** بطاقةُ السائقِ في الملخَّصِ — **بلا موقعٍ**. */
export interface RideSummaryDriver {
  /** الاسمُ الأوّلُ وحدَه — و`null` غيابٌ لا نصٌّ فارغٌ. */
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ. **ولا يُستبدَلُ برقمٍ افتراضيٍّ.** */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

/** وقائعُ حالةِ التقييمِ كما قاسَتها القاعدةُ **بساعتِها**. */
export interface RideSummaryRatingState {
  readonly alreadyRated: boolean;
  /** طولُ النافذةِ بالساعاتِ كما قُرِئَ من الإعدادِ (أو بديلِه المُصرَّحِ). */
  readonly windowHours: number;
  readonly windowClosed: boolean;
  /** حكمُ القاعدةِ نفسِها — يُقابَلُ بحكمِ النطاقِ ولا يُستبدَلُ به. */
  readonly canRate: boolean;
}

export interface RideSummaryState {
  readonly orderId: string;
  /** نصٌّ لا اتّحادٌ مُغلَقٌ: حالةٌ جديدةٌ في القاعدةِ لا تُسقِطُ قارئاً. */
  readonly status: string;
  readonly service: string;
  /** لافتةُ المكانِ كما اختارَها الراكبُ — و`null` غيابٌ لا نصٌّ فارغٌ. */
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAtMs: number;
  readonly matchedAtMs: number | null;
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  /** مدّةُ الرحلةِ بالثواني كما حسبَتها القاعدةُ — `null` = **غيابُ ختمٍ**. */
  readonly durationSeconds: number | null;
  /** وترُ الخطِّ المستقيمِ بالأمتارِ — `null` = **لا وجهةَ**، لا صفرَ. */
  readonly straightLineMeters: number | null;
  readonly driver: RideSummaryDriver | null;
  readonly rating: RideSummaryRatingState;
}

export type RideSummaryRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";

export type RideSummaryVerdict =
  | { readonly found: true; readonly state: RideSummaryState }
  | { readonly found: false; readonly refusal: RideSummaryRefusal };

export interface RideSummaryReader {
  read(input: {
    /** نصٌّ لا عددٌ — `bigint` تلغرامَ لا يُمرُّ في `number` جاواسكربت. */
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideSummaryVerdict, RideStoreFailure>>;
}

/**
 * رفضُ التقييمِ — **رموزُ القاعدةِ نفسُها** لا تصنيفٌ جديدٌ.
 *
 * ولا يُطوى شيءٌ منها في «عطبٍ»: `ALREADY_RATED` و`RATING_WINDOW_CLOSED`
 * و`ORDER_NOT_COMPLETED` **أجوبةٌ صحيحةٌ** تُقالُ للراكبِ نصّاً، وطيُّها في
 * `STORE_ERROR` يجعلُه يُعيدُ المحاولةَ بلا أملٍ.
 */
export type RideRatingRefusal =
  | "STARS_OUT_OF_RANGE"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_COMPLETED"
  | "RATER_NOT_PARTY_TO_ORDER"
  | "RATING_WINDOW_CLOSED"
  | "ALREADY_RATED"
  | "UNKNOWN_RATING_TAG"
  | "TOO_MANY_RATING_TAGS"
  | "DUPLICATE_RATING_TAG"
  | "COMMENT_TOO_LONG";

export interface SubmittedRating {
  readonly ratingId: string;
  readonly direction: string;
  readonly stars: number;
  readonly tags: readonly RatingTag[];
}

export type RideRatingVerdict =
  | { readonly accepted: true; readonly rating: SubmittedRating }
  | { readonly accepted: false; readonly refusal: RideRatingRefusal };

export interface RideRatingCommand {
  submit(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly stars: number;
    /** `null` غيابٌ لا نصٌّ فارغٌ — والقاعدةُ تُجرِّدُ الفراغَ وتُعدِمُه. */
    readonly comment: string | null;
    /** مصفوفةٌ فارغةٌ = لا وسومَ؛ والقاعدةُ تُحوِّلُها إلى `null`. */
    readonly tags: readonly RatingTag[];
  }): Promise<Result<RideRatingVerdict, RideStoreFailure>>;
}
