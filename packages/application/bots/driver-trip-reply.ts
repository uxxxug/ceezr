/**
 * الغرض: تحويل مشهد رحلة السائق إلى رسالة تلغرام — نصٌّ يشرح، ودبّوسٌ يُوجّه.
 * الحالة: منفّذ فعلياً — المرحلة ١٢. يستهلكه packages/application/bots/driver-dialog.ts
 *          و packages/application/bots/rating-dialog.ts.
 * ينتمي إلى: packages/application/bots
 * يُتوقع أن يستخدمه لاحقاً: زمن الوصول المتوقّع (المرحلة ١٥) يُضيف سطراً واحداً هنا
 *
 * ## لماذا العرض في مكانٍ واحد لا في ثلاثة
 *
 * السائق يرى رحلته في ثلاثة مواضع: عند قبول الطلب، وعند بدء الرحلة، وعند
 * `/trip`. وصوغُ النصّ في كلٍّ منها كان سيُنتج ثلاث صيغٍ تتباعد مع أول تعديل:
 * يُضاف سطر المسافة في موضعٍ ويُنسى في موضعين، فيشكو السائق من «اختلاف
 * الرسائل» ولا يجد أحدٌ سبباً واحداً يُصلحه. فهذا الملف هو الصيغة الواحدة.
 *
 * ## ولماذا الوسم يُستبدل ولا يُترك فارغاً
 *
 * `TripWaypoint.label` قد يكون `null` (رحلةٌ أُنشئت بإحداثيةٍ بلا اسم). وطباعته
 * كما هو كانت ستُنتج «🟢 الانطلاق: null» — وهو نصٌّ يُفقد الثقة بالبوت كلّه.
 */

import type { DriverTripView, TripWaypoint } from "../../domain/tracking/driver-trip-view.ts";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * الاسم إن وُجد، وإلاّ إحداثيةٌ مقروءة.
 *
 * والتسميات تغيب فعلاً: `orders.pickup_label` و`dropoff_label` كلاهما
 * `is_nullable = YES`، وراكبٌ يُرسل موقعه بلا كتابة اسم هو الحالة الشائعة لا
 * الشاذّة. وكانت الاحتياطيّة نصّاً ثابتاً «نقطة على الخريطة»، فظهرت في اختبار
 * التوصيل بطاقةٌ تقول: الانطلاق «نقطة على الخريطة» والمقصد «نقطة على الخريطة» —
 * سطران لا يُفرَّق بينهما، وهو أسوأ من لا شيء لأنّه يوهم بالإفادة.
 *
 * فتُذكَر الإحداثية بأربع خانات عشرية (نحو ١١ متراً، يكفي للتمييز ولا يُثقل
 * السطر). والدبّوس يبقى هو وسيلة الملاحة؛ هذا السطر للتمييز والقراءة.
 */
function nameOf(point: TripWaypoint, tr: Translate): string {
  const label = point.label?.trim();
  if (label !== undefined && label !== "") return label;
  return tr("driver.trip_waypoint_unnamed", {
    latitude: point.coordinates.latitude.toFixed(4),
    longitude: point.coordinates.longitude.toFixed(4),
  });
}

/** نصّ البطاقة: المرحلة، ثم النقطتان، ثم الوجهة الآن، ثم المسافة الموسومة. */
export function driverTripText(view: DriverTripView, tr: Translate): string {
  const lines = [
    tr("driver.trip_header"),
    view.leg === "TO_PICKUP"
      ? tr("driver.trip_leg_to_pickup")
      : tr("driver.trip_leg_to_destination"),
    tr("driver.trip_pickup_line", { pickup: nameOf(view.pickup, tr) }),
    view.destination === null
      ? tr("driver.trip_destination_unset")
      : tr("driver.trip_destination_line", { destination: nameOf(view.destination, tr) }),
    view.target === null
      ? tr("driver.trip_target_unset")
      : tr("driver.trip_target_line", { target: nameOf(view.target, tr) }),
    /**
     * سطر المسافة يُحذف كلّياً حين لا وجهة: «المسافة غير معروفة» تحت «المقصد غير
     * محدَّد» تكرارٌ لخبرٍ واحد، والسائق يقرأ رسالةً أطول لمعلومةٍ أقل.
     */
    ...(view.target === null
      ? []
      : [
          view.distanceToTargetKm === null
            ? tr("driver.trip_distance_unknown")
            : tr("driver.trip_distance_straight", { km: view.distanceToTargetKm }),
        ]),
  ];
  return lines.join("\n");
}

/**
 * الدبّوس على الوجهة الحالية لا على النقطتين: دبّوسان في رسالةٍ واحدة يجعلان
 * السائق يفتح الخطأ منهما وهو يقود. والوجهة محسومةٌ في الدومين (`target`)
 * فالعرض لا يُقرّر شيئاً هنا.
 */
export function driverTripPin(
  view: DriverTripView,
  tr: Translate,
): { latitude: number; longitude: number; label: string } | undefined {
  /**
   * لا دبّوس بلا وجهة. و`undefined` لا كائنٌ بإحداثيةٍ صفرية: الصفران إحداثيةٌ
   * صالحةٌ في خليج غينيا، فتلغرام يقبلها ويفتح للسائق خريطةً في المحيط.
   */
  if (view.target === null) return undefined;
  return {
    latitude: view.target.coordinates.latitude,
    longitude: view.target.coordinates.longitude,
    label:
      view.leg === "TO_PICKUP" ? tr("driver.trip_pin_pickup") : tr("driver.trip_pin_destination"),
  };
}
