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

/** نتيجة حساب المسار. */
export interface RouteResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: Polyline;
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
