/**
 * الغرض: كائنات القيمة الجغرافية — إحداثيات مُتحقَّق منها ومسافة موجبة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/geo
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch، application/transport، infrastructure/geo
 * ملاحظات مستقبلية: نصف قطر البحث ليس هنا — قيمته في platform_settings.search_radius_km.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { InvalidAreaLabelError, InvalidCoordinatesError, InvalidDistanceError } from "./errors.ts";

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

const MIN_AREA_LABEL_LENGTH = 2;
const MAX_AREA_LABEL_LENGTH = 60;

/**
 * اسم المنطقة المفضّلة — البند 2.4.
 *
 * التحقّق مقصود على الطول والفراغ وحدهما: أسماء الأحياء السعودية تُكتب بالعربية
 * وباللاتينية وبأرقامٍ («حي 12»، «Al Safa»)، وأي نمط أصرم كان سيرفض اسماً
 * صحيحاً كتبه صاحبه بلغته. والاسم للعرض والمراجعة البشرية لا لمطابقةٍ آلية،
 * فلا يُبنى عليه قرار يستحقّ صرامةً أكثر.
 *
 * والسطور المتعدّدة تُطوى إلى مسافة واحدة: اسمٌ بسطرين يُفسد كل جدول يُعرض فيه.
 */
export function parseAreaLabel(raw: string): Result<string, InvalidAreaLabelError> {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length === 0) return err(new InvalidAreaLabelError("empty"));
  if (value.length < MIN_AREA_LABEL_LENGTH) return err(new InvalidAreaLabelError("too_short"));
  if (value.length > MAX_AREA_LABEL_LENGTH) return err(new InvalidAreaLabelError("too_long"));
  return ok(value);
}
