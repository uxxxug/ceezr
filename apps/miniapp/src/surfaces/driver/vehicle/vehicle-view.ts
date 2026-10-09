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

import { isKnownVehicleType } from "../../../system/vehicle-type.ts";
import type { ApiDriverVehicleResponse, ApiVehicleDocument } from "./vehicle-contract.ts";

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

function toDocument(document: ApiVehicleDocument | null | undefined): VehicleDocumentModel | null {
  const status = document?.status ?? null;
  const expiresAt = document?.expiresAt ?? null;
  if (status === null && expiresAt === null) return null;
  return {
    status,
    statusLabelKey: documentLabelKey(status),
    expiresAt,
  };
}

export { isKnownVehicleType } from "../../../system/vehicle-type.ts";

/** جوابُ `null` (لا صفَّ مركبةٍ بعدُ) يُقرأُ مركبةً بلا قيمٍ — لا انهيارَ ولا تخمينَ. */
export function toVehicleDashboard(
  response: ApiDriverVehicleResponse | null,
): VehicleDashboardModel {
  const vehicleType = response?.vehicleType ?? null;
  return {
    vehicleType,
    // العمودُ `drivers.vehicle_type` نصٌّ حرٌّ (تسجيلُ البوتِ يكتبُه بكلماتِ السائقِ)،
    // فالمفتاحُ للأنواعِ المعروفةِ وحدَها، وما عداها يُعرَضُ كما كُتِبَ لا مفتاحاً خاماً.
    vehicleTypeLabelKey:
      vehicleType !== null && isKnownVehicleType(vehicleType)
        ? `driver.vehicle.type.${vehicleType}`
        : null,
    plateNumber: response?.plateNumber ?? null,
    vehicleYear: response?.vehicleYear ?? null,
    logoObjectPath: response?.logoObjectPath ?? null,
    barcodeObjectPath: response?.barcodeObjectPath ?? null,
    registration: toDocument(response?.registration),
    insurance: toDocument(response?.insurance),
    inspection: toDocument(response?.inspection),
  };
}
