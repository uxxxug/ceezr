/**
 * الغرض: أخطاء العمل المتوقعة لوحدة geo — تُعاد عبر Result بلا throw.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/geo
 * يُتوقع أن يستخدمه لاحقاً: application/*، apps/gateway
 * ملاحظات مستقبلية: أي خطأ جديد يُضاف كصنف، ولا يُعاد كنص حرّ.
 */

export type InvalidCoordinatesReason =
  | "NOT_FINITE"
  | "LATITUDE_OUT_OF_RANGE"
  | "LONGITUDE_OUT_OF_RANGE";

export class InvalidCoordinatesError {
  readonly code = "INVALID_COORDINATES" as const;
  constructor(
    readonly latitude: number,
    readonly longitude: number,
    readonly reason: InvalidCoordinatesReason,
  ) {}
}

export class InvalidDistanceError {
  readonly code = "INVALID_DISTANCE" as const;
  constructor(readonly value: number) {}
}

/** اسم منطقة مرفوض — البند 2.4. */
export class InvalidAreaLabelError {
  readonly code = "INVALID_AREA_LABEL" as const;
  constructor(readonly reason: "empty" | "too_short" | "too_long") {}
}

export type GeoError = InvalidCoordinatesError | InvalidDistanceError | InvalidAreaLabelError;
