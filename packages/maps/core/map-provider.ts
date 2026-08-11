/**
 * الغرض: واجهة مزوّد الخرائط — تجريد لعرض الخريطة.
 *   الخريطة واجهة فوق البنية التحتية، ليست قلب النظام.
 *   MapLibre هو الافتراضي، Google قابل للإضافة لاحقاً.
 * الحالة: منفّذ فعلياً — المرحلة 1.
 * ينتمي إلى: packages/maps/core
 */

import type { LatLng, MapPoint, Polyline, ProviderName } from "./types.ts";

/** تكوين عرض الخريطة. */
export interface MapViewConfig {
  readonly container: string;
  readonly center: LatLng;
  readonly zoom: number;
  readonly style?: string;
  readonly interactive?: boolean;
}

/**
 * مزوّد عرض الخريطة — يدير العرض البصري فقط.
 * لا يحسب المسارات ولا يخزّن المواقع — تلك مسؤولية طبقات أخرى.
 */
export interface MapRenderer {
  readonly name: ProviderName;

  /** يُنشئ عرض خريطة في الحاوية المحدّدة. */
  createView(config: MapViewConfig): Promise<MapView>;

  /** يحرّر الموارد. */
  destroy(): void;
}

/** عرض خريطة نشط. */
export interface MapView {
  /** يضيف نقطة على الخريطة. */
  addPoint(point: MapPoint): void;

  /** يزيل نقطة بمعرّفها. */
  removePoint(id: string): void;

  /** يحدّث موقع نقطة. */
  updatePoint(id: string, position: LatLng): void;

  /** يرسم مسار على الخريطة. */
  drawPolyline(polyline: Polyline, options?: PolylineOptions): void;

  /** يزيل مساراً. */
  clearPolylines(): void;

  /** يحرّك مركز الخريطة. */
  setCenter(position: LatLng): void;

  /** يضبط مستوى التكبير. */
  setZoom(zoom: number): void;

  /** يلائم الخريطة على مجموعة نقاط. */
  fitBounds(points: readonly LatLng[]): void;
}

export interface PolylineOptions {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
  readonly dashed?: boolean;
}

/** خطأ مزوّد الخريطة. */
export class MapProviderError {
  readonly code = "MAP_PROVIDER_FAILURE" as const;
  constructor(
    readonly provider: ProviderName,
    readonly detail: string,
  ) {}
}
