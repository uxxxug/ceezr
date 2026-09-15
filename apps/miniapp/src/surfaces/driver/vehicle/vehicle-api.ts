/**
 * الغرض: نداءاتُ مركبةِ السائقِ — قراءةٌ وتحديثٌ (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/vehicle
 * يُستخدم من: `VehicleScreen.tsx`
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِلُ معرِّفَ سائقٍ**: الهويّةُ في الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُخزِّنُ جواباً محلّيّاً**: لوحٌ مخزَّنٌ يُقرأُ حالاً لا حالاً.
 *   ــ **لا ترفعُ بايتاً**: رفعُ الشعارِ والباركودِ يمرُّ عبرَ `F3-01`.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiDriverVehicleAssetsResponse,
  ApiDriverVehicleResponse,
  ApiDriverVehicleUpdateResponse,
} from "./vehicle-contract.ts";

export type * from "./vehicle-contract.ts";

export function readDriverVehicle(): Promise<ApiDriverVehicleResponse> {
  return apiFetch<ApiDriverVehicleResponse>("/v1/driver/vehicle", {
    method: "GET",
  });
}

export function updateDriverVehicle(
  vehicleType: string | null,
  plateNumber: string | null,
  vehicleYear: number | null,
): Promise<ApiDriverVehicleUpdateResponse> {
  return apiFetch<ApiDriverVehicleUpdateResponse>("/v1/driver/vehicle", {
    method: "PATCH",
    body: JSON.stringify({ vehicleType, plateNumber, vehicleYear }),
  });
}

export function updateDriverVehicleAssets(
  logoObjectPath: string | null,
  barcodeObjectPath: string | null,
): Promise<ApiDriverVehicleAssetsResponse> {
  return apiFetch<ApiDriverVehicleAssetsResponse>("/v1/driver/vehicle/assets", {
    method: "POST",
    body: JSON.stringify({ logoObjectPath, barcodeObjectPath }),
  });
}
