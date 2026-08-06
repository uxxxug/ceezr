/**
 * الغرض: حساب المسافة الجغرافية ونطاق البحث — منطق خالص بلا أي تبعية خارجية.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/geo
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch (معادلة النقاط)، application/transport
 * ملاحظات مستقبلية: الترشيح الأولي للسائقين يتم في القاعدة عبر PostGIS؛ هذه الدوال
 *   للترتيب والتحقق داخل التطبيق، وليست بديلاً عن استعلام مكاني في القاعدة.
 */

import type { Coordinates, DistanceKm } from "./value-objects.ts";

export const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** المسافة الكبرى الدائرية (Haversine) بين نقطتين بالكيلومتر. */
export function haversineKm(a: Coordinates, b: Coordinates): DistanceKm {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** هل النقطة داخل نصف القطر؟ نصف القطر يأتي من platform_settings دائماً. */
export function isWithinRadiusKm(
  origin: Coordinates,
  target: Coordinates,
  radiusKm: DistanceKm,
): boolean {
  return haversineKm(origin, target) <= radiusKm;
}

/**
 * دالة القرب المعيارية: 1 عند المسافة صفر، و0 عند حدّ نصف القطر أو خارجه.
 * تُستخدم في معادلة نقاط المطابقة (القسم 3.3.2) لتكون كل مكوّنات المعادلة في مدى [0,1].
 */
export function proximityFactor(distanceKm: DistanceKm, radiusKm: DistanceKm): number {
  if (radiusKm <= 0) return 0;
  if (distanceKm <= 0) return 1;
  if (distanceKm >= radiusKm) return 0;
  return 1 - distanceKm / radiusKm;
}

export * from "./errors.ts";
export * from "./value-objects.ts";
export * from "./entity.ts";
