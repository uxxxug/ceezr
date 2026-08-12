/**
 * الغرض: ما يراه السائق عن رحلته الجارية — دالّةٌ نقيّة تُحوّل وقائع الرحلة إلى مشهدٍ واحد.
 * الحالة: منفّذ فعلياً — المرحلة ١٢. يستهلكه packages/application/tracking/driver-trip-card.ts.
 * ينتمي إلى: packages/domain/tracking
 * يُتوقع أن يستخدمه لاحقاً: خريطة العمليات (المرحلة ١٣) لعرض نفس مرحلة السائق للمشغّل
 *
 * ## المشكلة التي تُحلّ هنا
 *
 * قبل هذه المرحلة كان البوت يقول للسائق: «الطلب لك. توجّه إلى نقطة الانطلاق»
 * ولا يقول له **أين** نقطة الانطلاق. والنقطة موجودةٌ في `orders.pickup` منذ
 * إنشاء الطلب — فالعيب لم يكن في البيانات بل في أنها لم تُعرَض. وقياسُ ذلك
 * بمسبار تنفيذٍ على قاعدةٍ حقيقية: ردّ القبول لا يحمل إحداثيةً ولا وسماً.
 *
 * ## ولماذا `target` واحدة لا نقطتان
 *
 * لأن للسائق في أي لحظةٍ **مقصدٌ واحد**: نقطة الانطلاق قبل أن يُقلّ الراكب،
 * والمقصد بعدها. وعرضُ النقطتين بلا تمييزٍ يجعل قراءة الرسالة عملاً ذهنياً
 * على من يقود سيّارة. فالمشهد يحسم الوجهة، ويُبقي النقطتين مرجعاً.
 *
 * ## ولماذا المقصد قد يكون `null`
 *
 * لأن `orders.dropoff` **يقبل الفراغ في القاعدة** (`is_nullable = YES`)، وهذا
 * ليس عيباً بل سلوك المنتج: راكبٌ يقول «الحرم» انطلاقاً ويحدّد مقصده في
 * السيّارة. وقد كُتبت هذه الدالّة أوّلاً بمقصدٍ إلزامي، فأخفت البطاقة كلّها عن
 * كل رحلةٍ بلا إحداثية مقصد — أي عن أكثر رحلات الاختبارات الحقيقية. أظهرَ ذلك
 * إخفاقُ أربعة اختبارات تكامل، لا مراجعةٌ نظرية.
 *
 * والحلّ إظهار ما يُعرَف والإفصاح عمّا لا يُعرَف: نقطة الانطلاق إلزامٌ في القاعدة
 * (`is_nullable = NO`) فتُعرَض دائماً، والمقصد يُعرض إن وُجد ويُقال «غير محدَّد» إن
 * لم يوجد. وبديلُه — عرض إحداثية صفرية أو كتم البطاقة — إمّا يكذب أو يُصمت.
 *
 * ## ولماذا المسافة مستقيمةٌ موسومة لا مسافة طريق
 *
 * لأن OSRM غير موصولٍ في هذا الإصدار (الخطر R-28)، والمسافة المستقيمة أقصر
 * من الطريق دائماً. فتقديمها بلا وسمٍ يعني رقماً يكذب على السائق بنسبةٍ
 * تتراوح مع شكل الشبكة. و`distanceKind` تجعل الكذب مستحيلاً: من يعرض الرقم
 * يعرف نوعه، ومن يبني عليه زمن وصولٍ (المرحلة ١٥) يراه ولا يُخطئ.
 */

import { haversineKm } from "../geo/index.ts";
import type { Coordinates } from "../geo/value-objects.ts";

/** مرحلة السائق في الرحلة — مشتقّةٌ من حالة الطلب لا مُخزَّنةٌ بجانبها. */
export type DriverTripLeg = "TO_PICKUP" | "TO_DESTINATION";

/** نقطةٌ على الخريطة بوسمها البشري. الوسم قد يكون `null`: الإحداثية هي الإلزام. */
export interface TripWaypoint {
  readonly coordinates: Coordinates;
  readonly label: string | null;
}

/** حالات الطلب التي يكون للسائق فيها رحلةٌ جارية. غيرها لا مشهد له. */
export type DriverTripStatus = "matched" | "in_progress";

export interface DriverTripFacts {
  readonly tripId: string;
  readonly status: DriverTripStatus;
  /** إلزام: `orders.pickup` لا يقبل الفراغ في القاعدة. */
  readonly pickup: TripWaypoint;
  /** `null` = المقصد لم يُحدَّد بعد. حالةٌ مشروعة لا بيانات ناقصة. */
  readonly destination: TripWaypoint | null;
}

/**
 * نوع المسافة المعروضة. `null` في `distanceToTargetKm` تعني: لا موقع للسائق
 * بعد — وهي حالةٌ واقعية (سائقٌ قبل طلباً ثم لم يُرسل موقعاً).
 */
export type DistanceKind = "STRAIGHT_LINE";

export interface DriverTripView {
  readonly tripId: string;
  readonly leg: DriverTripLeg;
  readonly pickup: TripWaypoint;
  readonly destination: TripWaypoint | null;
  /**
   * النقطة التي يقصدها السائق الآن — إحدى النقطتين أعلاه، لا ثالثة. و`null`
   * تعني: مرحلته إلى المقصد والمقصد غير محدَّد بعد. حينها لا دبّوس ولا مسافة،
   * ويُقال ذلك صراحةً بدل أن يُوجَّه إلى نقطةٍ مختلَقة.
   */
  readonly target: TripWaypoint | null;
  readonly driverLocation: Coordinates | null;
  readonly distanceToTargetKm: number | null;
  readonly distanceKind: DistanceKind;
}

/**
 * المرحلة تُشتقّ من حالة الطلب ولا تُخزَّن: حقلٌ ثانٍ للمرحلة كان سيصير مصدراً
 * ثانياً للحقيقة يتعارض مع `orders.status` عند أول تحديثٍ يسقط (القاعدة ٥).
 */
export function legOf(status: DriverTripStatus): DriverTripLeg {
  return status === "matched" ? "TO_PICKUP" : "TO_DESTINATION";
}

export function driverTripView(
  facts: DriverTripFacts,
  driverLocation: Coordinates | null,
): DriverTripView {
  const leg = legOf(facts.status);
  const target: TripWaypoint | null = leg === "TO_PICKUP" ? facts.pickup : facts.destination;
  /**
   * التقريب إلى منزلةٍ واحدة يقع هنا لا في طبقة العرض: رقمٌ بأربع عشرياتٍ
   * يُعرَض على سائق يقود ليس معلومةً بل ضجيج. والمنزلة الواحدة كافيةٌ لقرارٍ
   * مداه كيلومترات، ودقّة أعلى من ذلك تكذب أصلاً مع مسافةٍ مستقيمة.
   */
  const distanceToTargetKm =
    driverLocation === null || target === null
      ? null
      : Math.round(haversineKm(driverLocation, target.coordinates) * 10) / 10;

  return {
    tripId: facts.tripId,
    leg,
    pickup: facts.pickup,
    destination: facts.destination,
    target,
    driverLocation,
    distanceToTargetKm,
    distanceKind: "STRAIGHT_LINE",
  };
}
