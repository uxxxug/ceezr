/**
 * الغرض: الموقع الأخير المعروف للسائق وصلاحيته الزمنية.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/geo
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch (استبعاد المواقع القديمة)، infrastructure/geo
 * ملاحظات مستقبلية: مدة صلاحية الموقع قيمة في platform_settings عند تفعيل تحديث الموقع الحيّ.
 */

import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import type { Coordinates } from "./value-objects.ts";

export interface DriverLocation {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly at: Coordinates;
  readonly recordedAt: Date;
}

/** هل الموقع حديث بما يكفي للاعتماد عليه في المطابقة؟ */
export function isLocationFresh(
  location: DriverLocation,
  now: Date,
  maxAgeSeconds: number,
): boolean {
  const ageSeconds = (now.getTime() - location.recordedAt.getTime()) / 1000;
  return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}
