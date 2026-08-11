/**
 * الغرض: واجهة مزوّد التوجيه (Routing) — تجريد صرف.
 *   أيّ مزوّد (OSRM، Valhalla، Google) يُحقن عبر هذه الواجهة.
 *   تبديل المزوّد لا يُغيّر أي كود أعلى.
 * الحالة: منفّذ فعلياً — المرحلة 1.
 * ينتمي إلى: packages/maps/core
 */

import type { LatLng, NearestResult, ProviderName, RouteResult } from "./types.ts";

/** خيارات حساب المسار. */
export interface RouteOptions {
  /** نقطة البداية. */
  readonly origin: LatLng;
  /** نقطة النهاية. */
  readonly destination: LatLng;
  /** نقاط وسيطة اختيارية. */
  readonly waypoints?: readonly LatLng[];
  /** وضع التنقّل. */
  readonly profile?: "driving" | "walking" | "cycling";
  /** هل نريد خطوات تفصيلية؟ */
  readonly steps?: boolean;
}

/** خيارات البحث عن الأقرب. */
export interface NearestOptions {
  /** الموقع المرجعي. */
  readonly point: LatLng;
  /** عدد النتائج المطلوبة. */
  readonly count?: number;
  /** نصف قطر البحث بالمتر. */
  readonly radiusMeters?: number;
}

/**
 * مزوّد التوجيه — يوفّر: حساب المسار، البحث عن الأقرب، مصفوفة المسافات.
 * لا يحتوي على أي حالة (stateless) — كل استدعاء مستقل.
 */
export interface RoutingProvider {
  readonly name: ProviderName;

  /** يحسب المسار بين نقطتين (أو أكثر). */
  route(options: RouteOptions): Promise<Result<RouteResult, RoutingError>>;

  /** يبحث عن أقرب النقاط/السائقين لموقع معيّن. */
  nearest(options: NearestOptions): Promise<Result<NearestResult, RoutingError>>;

  /** يحسب مصفوفة مسافات/أزمنة بين مجموعة مصادر ووجهات. */
  table(
    sources: readonly LatLng[],
    destinations: readonly LatLng[],
  ): Promise<Result<DistanceMatrix, RoutingError>>;
}

/** نتيجة مصفوفة المسافات. */
export interface DistanceMatrix {
  readonly rows: readonly DistanceMatrixRow[];
}

export interface DistanceMatrixRow {
  readonly elements: readonly DistanceMatrixElement[];
}

export interface DistanceMatrixElement {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly status: "ok" | "no_route";
}

/** خطأ من مزوّد التوجيه. */
export class RoutingError {
  readonly code = "ROUTING_FAILURE" as const;
  constructor(
    readonly provider: ProviderName,
    readonly detail: string,
  ) {}
}

import type { Result } from "../../shared/result/index.ts";
