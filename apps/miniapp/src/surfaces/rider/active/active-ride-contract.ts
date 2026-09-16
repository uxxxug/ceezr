/**
 * الغرض: شكلُ ردِّ `GET /v1/rides/:id` كما يقرأُه العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F2-06` · `SR-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `active-ride-api.ts` و`active-ride-view.ts` و`ActiveRideScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ الإنهاءِ والتقييمِ (`F2-07`) تقرأُ `completedAt`
 *   من هذا الردِّ نفسِه ولا تُنشِئُ مساراً ثانياً للقراءةِ.
 *
 * ## لماذا الحالةُ نصٌّ لا اتّحادٌ مُغلَقٌ
 *
 * الخادمُ ينشرُ ما في القاعدةِ، والقاعدةُ تكبرُ بحالةٍ جديدةٍ قبلَ أن يُنشَرَ
 * عميلٌ جديدٌ. فنوعٌ مُغلَقٌ ههنا يعني شاشةً **بيضاءَ** عندَ أوّلِ حالةٍ لم تكنْ
 * معروفةً حينَ البناءِ. والنصُّ يُترجَمُ بمفتاحٍ عامٍّ فيبقى المعروضُ صادقاً.
 *
 * ## ولماذا موقعُ السائقِ اتّحادٌ بحكمٍ لا حقلٌ اختياريٌّ
 *
 * `{ show: false, reason }` يُجبِرُ الشاشةَ على قراءةِ السببِ قبلَ الرسمِ. ولو
 * كانَ الموقعُ حقلاً اختياريّاً لَرسمَ مبرمجٌ `position?.lat` ونسيَ العُمرَ —
 * و`BUG-001` يقولُ إنَّ إحداثيّةً بلا عُمرٍ قد تكونُ قديمةً بلا أن تُعلِنَ ذلكَ.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا سعرَ ولا عقوبةَ إلغاءٍ**: مُجمَّدةٌ بـ`ADR 0039` §٤ (`DEC-11` · `م13-7`).
 *   ــ **لا رقمَ هاتفٍ ولا رمزَ مشاركةٍ ولا طوارئَ**: `F2-09` و`F2-10`.
 */

/** حالةُ الرحلةِ كما نشرَتها القاعدةُ — نصٌّ يُصنَّفُ في نموذجِ العرضِ. */
export type ApiActiveRideStatus = string;

export interface ApiActiveRidePoint {
  readonly lat: number;
  readonly lng: number;
  readonly label: string | null;
}

export interface ApiActiveRideDriver {
  /** الاسمُ الأوّلُ وحدَه: يكفي للتعرُّفِ ولا يُفشي هويّةً كاملةً. */
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ — ولا يُستبدَلُ بصفرٍ ولا بخمسةٍ. */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export type ApiActiveRidePosition =
  | {
      readonly show: true;
      readonly lat: number;
      readonly lng: number;
      /** عُمرُ القراءةِ بالثواني — يُرسَمُ معَ النقطةِ دائماً. */
      readonly ageSeconds: number;
    }
  | {
      readonly show: false;
      readonly reason: string;
      readonly ageSeconds: number | null;
    };

export type ApiActiveRideEta =
  | { readonly kind: "ROUTED"; readonly minutes: number; readonly source: string }
  | { readonly kind: "UNAVAILABLE"; readonly reason: string };

export type ActiveRideResponse =
  | {
      readonly ok: true;
      readonly found: true;
      readonly orderId: string;
      readonly status: ApiActiveRideStatus;
      readonly service: string;
      readonly phase: string;
      readonly pickup: ApiActiveRidePoint;
      /** `null` جائزٌ: عمودُ الوجهةِ في القاعدةِ يقبلُ العَدَمَ. */
      readonly dropoff: ApiActiveRidePoint | null;
      readonly createdAt: string;
      readonly matchedAt: string | null;
      readonly startedAt: string | null;
      readonly arrivedAt: string | null;
      readonly completedAt: string | null;
      readonly elapsedSeconds: number;
      readonly cancelPolicy: string;
      readonly driver: ApiActiveRideDriver | null;
      readonly position: ApiActiveRidePosition | null;
      readonly eta: ApiActiveRideEta | null;
    }
  | { readonly ok: true; readonly found: false; readonly refusal: string };
