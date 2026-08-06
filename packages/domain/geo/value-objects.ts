/**
 * الغرض: كائنات القيمة الجغرافية — إحداثيات مُتحقَّق منها ومسافة موجبة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/geo
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch، application/transport، infrastructure/geo
 * ملاحظات مستقبلية: نصف قطر البحث ليس هنا — قيمته في platform_settings.search_radius_km.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { InvalidCoordinatesError, InvalidDistanceError } from "./errors.ts";

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export function makeCoordinates(
  latitude: number,
  longitude: number,
): Result<Coordinates, InvalidCoordinatesError> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return err(new InvalidCoordinatesError(latitude, longitude, "NOT_FINITE"));
  }
  if (latitude < -90 || latitude > 90) {
    return err(new InvalidCoordinatesError(latitude, longitude, "LATITUDE_OUT_OF_RANGE"));
  }
  if (longitude < -180 || longitude > 180) {
    return err(new InvalidCoordinatesError(latitude, longitude, "LONGITUDE_OUT_OF_RANGE"));
  }
  return ok({ latitude, longitude });
}

export type DistanceKm = number;

export function makeDistanceKm(value: number): Result<DistanceKm, InvalidDistanceError> {
  if (!Number.isFinite(value) || value < 0) {
    return err(new InvalidDistanceError(value));
  }
  return ok(value);
}
