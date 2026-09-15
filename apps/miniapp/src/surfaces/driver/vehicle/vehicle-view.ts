/**
 * الغرض: نموذجُ عرضِ مركبةِ السائقِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ
 *   نصٍّ معروضةٍ، **بلا JSX وبلا شبكةٍ وبلا ساعةٍ** (`F3-07`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/vehicle
 * يُستخدم من: `VehicleScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يحرسُه: scripts/check-driver-vehicle-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()`.
 *   ــ **لا يُخفي حقلاً غابَ**: «غيرُ معروفٍ» يُقالُ صراحةً لا يُمسَحُ.
 */

import type { ApiDriverVehicleResponse } from "./vehicle-contract.ts";

const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "VEHICLE_STORE_NOT_AVAILABLE",
  "YEAR_INVALID",
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "CITY_NOT_READY",
]);

export function vehicleErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? `driver.vehicle.error.${code}` : "driver.vehicle.error.UNKNOWN";
}

export function isRetryableVehicleError(code: string): boolean {
  return (
    code === "VEHICLE_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE" || code === "UNKNOWN"
  );
}

export interface VehicleDocumentModel {
  readonly status: string | null;
  readonly statusLabelKey: string | null;
  readonly expiresAt: string | null;
}

export interface VehicleDashboardModel {
  readonly vehicleType: string | null;
  readonly vehicleTypeLabelKey: string | null;
  readonly plateNumber: string | null;
  readonly vehicleYear: number | null;
  readonly logoObjectPath: string | null;
  readonly barcodeObjectPath: string | null;
  readonly registration: VehicleDocumentModel | null;
  readonly insurance: VehicleDocumentModel | null;
  readonly inspection: VehicleDocumentModel | null;
}

function documentLabelKey(status: string | null): string | null {
  if (status === null) return null;
  return `driver.vehicle.document.status.${status}`;
}

function toDocument(status: string | null, expiresAt: string | null): VehicleDocumentModel | null {
  if (status === null && expiresAt === null) return null;
  return {
    status,
    statusLabelKey: documentLabelKey(status),
    expiresAt,
  };
}

export function toVehicleDashboard(response: ApiDriverVehicleResponse): VehicleDashboardModel {
  return {
    vehicleType: response.vehicle_type,
    vehicleTypeLabelKey:
      response.vehicle_type === null ? null : `driver.vehicle.type.${response.vehicle_type}`,
    plateNumber: response.plate_number,
    vehicleYear: response.vehicle_year,
    logoObjectPath: response.logo_object_path,
    barcodeObjectPath: response.barcode_object_path,
    registration: toDocument(response.registration_status, response.registration_expires_at),
    insurance: toDocument(response.insurance_status, response.insurance_expires_at),
    inspection: toDocument(response.inspection_status, response.inspection_expires_at),
  };
}
