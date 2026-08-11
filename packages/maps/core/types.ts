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

/** سائق قريب — نتيجة بحث عن الأقرب. */
export interface NearbyDriver {
  readonly driverId: string;
  readonly position: LatLng;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly heading?: number;
  readonly ratingAverage?: number;
}

/** نتيجة بحث عن الأقرب. */
export interface NearestResult {
  readonly drivers: readonly NearbyDriver[];
}

/** معرّف المزوّد لمعرفة المصدر. */
export type ProviderName = "osrm" | "valhalla" | "google" | "none";
