/**
 * الغرض: شكلُ ردَّي `GET /v1/rides/:id/summary` و`POST /v1/rides/:id/rating`
 *   كما يقرأُهما العميلُ — أنواعٌ لا منطقٌ (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/summary
 * يُستخدم من: `ride-summary-api.ts` و`ride-summary-view.ts` و`RideSummaryScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (مشاركةُ الرحلةِ) تقرأُ الملخَّصَ نفسَه.
 *
 * ## لماذا الحالةُ نصٌّ لا اتّحادٌ مُغلَقٌ
 *
 * كما في `F2-06`: الخادمُ ينشرُ ما في القاعدةِ، والقاعدةُ تكبرُ بحالةٍ جديدةٍ
 * قبلَ أن يُنشَرَ عميلٌ جديدٌ. فنوعٌ مُغلَقٌ ههنا يعني شاشةً **بيضاءَ** عندَ
 * أوّلِ حالةٍ لم تكنْ معروفةً حينَ البناءِ.
 *
 * ## ولماذا المدّةُ والوترُ اتّحادانِ بحكمٍ لا رقمانِ اختياريّانِ
 *
 * `{ known: false, reason }` يُجبِرُ الشاشةَ على قراءةِ السببِ قبلَ الرسمِ. ولو
 * كانا رقمَينِ اختياريَّينِ لَكتبَ مبرمجٌ `duration?.totalSeconds ?? 0` فعُرِضَ
 * **صفرٌ** — و«٠ ثانيةً» تُقرأُ رحلةً لحظيّةً و«٠ متراً» تُقرأُ «لم تتحرَّكْ».
 *
 * ## ولماذا اسمُ الحقلِ `straightLine` في العقدِ نفسِه
 *
 * لا أثرَ مسارٍ في القاعدةِ، فالرقمُ وترُ خطٍّ بينَ نقطتَينِ لا مقطوعٌ. والاسمُ
 * يقولُ ذلكَ ههنا كي لا يُسمّيَه أحدٌ «المسافةَ» بعدَ حدودٍ.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا حقلَ أجرةٍ ولا مبلغٍ ولا وسيلةِ دفعٍ ولا إكراميّةٍ ولا خانةً لها** —
 *      مُجمَّدةٌ بـ`ADR 0039` §٤ (`DEC-11` · `م13-7`).
 *   ــ **لا موقعَ سائقٍ**: الرحلةُ انتهت فلا موضعَ يُتابَعُ.
 *   ــ **لا تذكرةَ دعمٍ**: غيابٌ مُصرَّحٌ بلا زرٍّ (`open_support_ticket` قائمةٌ
 *      ولها مُنادونَ، ووصلُها بهذا السطحِ خارجَ النطاقِ المحجوزِ).
 */

/** حالةُ الرحلةِ كما نشرَتها القاعدةُ — نصٌّ يُصنَّفُ في نموذجِ العرضِ. */
export type ApiRideSummaryStatus = string;

export interface ApiRideSummaryDriver {
  /** الاسمُ الأوّلُ وحدَه: يكفي للتعرُّفِ ولا يُفشي هويّةً كاملةً. */
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ — ولا يُستبدَلُ بصفرٍ ولا بخمسةٍ. */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export type ApiRideDuration =
  | {
      readonly known: true;
      readonly totalSeconds: number;
      readonly minutes: number;
      readonly seconds: number;
    }
  | { readonly known: false; readonly reason: string };

export type ApiStraightLine =
  | { readonly known: true; readonly meters: number }
  | { readonly known: false; readonly reason: string };

export interface ApiRideSummaryRider {
  /** الاسمُ الأوّلُ وحدَه — كما في بطاقةِ السائقِ. */
  readonly firstName: string | null;
  /** `null` = لا تقييمَ بعدُ. */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export interface ApiRideRatingState {
  /** تصنيفُ النطاقِ — يُترجَمُ نصّاً. */
  readonly eligibility: string;
  /** حكمُ القاعدةِ — **هوَ المُلزِمُ**، ويُقرأُ معَ التصنيفِ لا بدلاً منه. */
  readonly canRate: boolean;
  readonly alreadyRated: boolean;
  /** اتّجاهُ التقييمِ — `rider_to_driver` أو `driver_to_rider`. */
  readonly direction: string;
  readonly windowHours: number;
  readonly windowClosed: boolean;
}

export type RideSummaryResponse =
  | {
      readonly ok: true;
      readonly found: true;
      readonly orderId: string;
      readonly status: ApiRideSummaryStatus;
      readonly service: string;
      /** لافتةُ المكانِ — `null` غيابٌ لا نصٌّ فارغٌ. */
      readonly pickupLabel: string | null;
      readonly dropoffLabel: string | null;
      readonly createdAt: string;
      readonly matchedAt: string | null;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
      readonly duration: ApiRideDuration;
      readonly straightLine: ApiStraightLine;
      readonly driver: ApiRideSummaryDriver | null;
      readonly rider: ApiRideSummaryRider | null;
      readonly rating: ApiRideRatingState;
    }
  | { readonly ok: true; readonly found: false; readonly refusal: string };

export type RideRatingResponse =
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly ratingId: string;
      readonly stars: number;
      readonly tags: readonly string[];
    }
  | { readonly ok: true; readonly accepted: false; readonly refusal: string };
