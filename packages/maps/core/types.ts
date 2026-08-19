/**
 * الغرض: الأنواع المشتركة لطبقة الخرائط والتوجيه.
 *   إحداثيات، مسارات، نقاط اهتمام — بلا أي اعتماد على مزوّد بعينه.
 * الحالة: منفّذ فعلياً — المرحلة 1.
 * ينتمي إلى: packages/maps/core
 */

/** إحداثيات جغرافية (WGS84). */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** نقطة بمعلومات إضافية للعرض على الخريطة. */
export interface MapPoint {
  readonly id: string;
  readonly position: LatLng;
  readonly label?: string;
  readonly type?: "driver" | "pickup" | "dropoff" | "customer" | "driver_home";
}

/** خط مسار (Polyline) — سلسلة نقاط. */
export interface Polyline {
  readonly points: readonly LatLng[];
  readonly encoded?: string;
}

/**
 * مقدارُ إلصاقِ طرفَي المسار بالطريق — اتحادٌ مُميَّزٌ لا رقمان اختياريّان.
 *
 * ## المشكلة التي يُحلّها (قِيست في المرحلة ١٥ على محرّك OSRM حقيقي)
 *
 * محرّكُ التوجيه لا يرفض الإحداثيةَ البعيدةَ عن الطريق، بل **يُلصقها بأقرب طريقٍ
 * يعرفه ثمّ يُجيب بثقة**. وقياسُه بالأرقام: إحداثيةٌ في البحر الأحمر
 * (21.55, 38.6) أعادت `code: "Ok"` ومدّةً ٥٦ دقيقةً ومسافةً ٦١.٦ كم — ومقدارُ
 * الإلصاق **٥١.٧ كم**. وإحداثيةٌ في مصر أعادت `Ok` و١٣٧٣ دقيقة بإلصاقِ ٢.٥ كم.
 * فالجوابُ في الحالتين لا يخصّ الموضعَ المسؤولَ عنه أصلاً، ولا شيءَ في النتيجة
 * يقول ذلك: `distanceMeters` و`durationSeconds` أرقامٌ سليمةُ الشكل تماماً.
 *
 * وكان `route()` يُسقط `waypoints[].distance` من ردّ OSRM إسقاطاً كاملاً — وهو
 * الحقلُ الذي يحمل هذا المقدار. فالمعلومةُ كانت تصل من المحرّك وتُرمى قبل أن
 * يراها أحد. ولذلك لم يكن لأيّ مستهلكٍ سبيلٌ إلى التمييز بين «٥٦ دقيقةً إلى
 * العميل» و«٥٦ دقيقةً إلى طريقٍ يبعد عنه ٥١ كم».
 *
 * ## ولماذا اتحادٌ لا `originSnapMeters?: number`
 *
 * لأنّ الحقلَ الاختياريّ يدعو إلى `?? 0`، وصفرٌ هنا يعني «مُلصَقٌ تماماً على
 * الطريق» — أي **أقوى** توكيدٍ ممكن، يُكتب في موضع «لا أعلم». وهي نفس العلّة
 * المُصلَحة في `DistanceMatrixElement`. وبالاتحاد لا يستطيع مستهلكٌ قراءةَ رقمٍ
 * قبل أن يفحص `known`، والمُصرِّفُ يمنعه.
 *
 * و`known: false` حالةٌ واقعيّةٌ لا احتياط: خادمٌ أو وسيطٌ يردّ مساراً بلا
 * `waypoints` موجودٌ فعلاً، وحينها الصوابُ أن يُقال «لا أعلم» لا أن يُخترع صفر.
 */
export type RouteSnap =
  | {
      readonly known: true;
      /** بُعد نقطة البداية المطلوبة عن الطريق الذي حُسب منه المسار، بالمتر. */
      readonly originMeters: number;
      /** بُعد نقطة النهاية المطلوبة عن الطريق الذي حُسب إليه المسار، بالمتر. */
      readonly destinationMeters: number;
    }
  | { readonly known: false };

/** نتيجة حساب المسار. */
export interface RouteResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: Polyline;
  /**
   * إلزاميٌّ لا اختياريّ: من يحسب زمنَ وصولٍ يجب أن يمرّ على هذا الحقل، وحقلٌ
   * اختياريٌّ كان يُنسى بلا أن يُنبّه المُصرِّف — وهو بالضبط ما وقع قبل المرحلة ١٥.
   */
  readonly snap: RouteSnap;
  readonly legs?: readonly RouteLeg[];
}

/** ساق المسار (مقطع بين نقطتين). */
export interface RouteLeg {
  readonly start: LatLng;
  readonly end: LatLng;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly steps?: readonly RouteStep[];
}

/** خطوة داخل مقطع المسار. */
export interface RouteStep {
  readonly instruction: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly maneuver?: "left" | "right" | "straight" | "uturn" | "arrive" | "depart";
}

/**
 * نقطةٌ مُلتصقة بشبكة الطرق — المرحلة ٨.
 *
 * ## لماذا حُذف `NearbyDriver` من هنا
 *
 * كان هذا النوع `NearbyDriver` بحقلٍ اسمه `driverId`، ومزوّد OSRM يملؤه
 * بـ`` `nearest-${i}` `` — أي **مُعرِّفات سائقين مختلقة**. و`/nearest` في OSRM
 * لا يعرف السائقين ولا يستطيع: هو يُلصق إحداثيةً بأقرب حرفِ طريق ويعيد النقطة
 * الملتصقة. فالنوع كان يَعِد بشيءٍ لا يملكه المزوّد، والتسمية وحدها كانت تكفي
 * لأن يبني عليها مستهلكٌ مستقبلي بثّاً إلى «سائقٍ» اسمه `nearest-0`.
 *
 * ومصدر الحقيقة لسؤال «من السائقون القريبون؟» هو `drivers.last_location`
 * (ADR-0015) عبر مسار المرشّحين في الإسناد — لا خدمةُ توجيهٍ خارجية. وترك
 * النوع باسمه القديم كان يعني مصدراً ثانياً لنفس السؤال، أحدُهما كاذب.
 *
 * ولم يُحذف `nearest` نفسه: إلصاقُ نقطةٍ بالطريق وظيفةٌ حقيقية ونافعة (تصحيح
 * نقطة التقاطٍ سقطت داخل مبنى). الذي حُذف هو ادّعاء أنها تعرف سائقاً.
 */
export interface SnappedPoint {
  /** الإحداثية بعد الإلصاق بأقرب حرف طريق. */
  readonly position: LatLng;
  /** بُعد النقطة الأصلية عن الطريق بالمتر — لا مسافةَ قيادةٍ إلى أحد. */
  readonly offsetMeters: number;
  /** اسم الطريق إن أعاده المزوّد. */
  readonly roadName?: string;
}

/** نتيجة الإلصاق: النقاط مرتَّبة كما أعادها المزوّد، الأقرب أولاً. */
export interface NearestResult {
  readonly points: readonly SnappedPoint[];
}

/** معرّف المزوّد لمعرفة المصدر. */
export type ProviderName = "osrm" | "valhalla" | "google" | "none";
