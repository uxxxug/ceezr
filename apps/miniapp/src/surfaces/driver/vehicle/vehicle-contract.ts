/**
 * الغرض: شكلُ ردِّ مركبةِ السائقِ كما يقرؤه العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/vehicle
 * يُستخدم من: `vehicle-api.ts` · `vehicle-view.ts` · `VehicleScreen.tsx`
 * يحرسُه: scripts/check-driver-vehicle-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا هويّةَ راكبٍ**: لا اسمَ ولا هاتفَ.
 *   ــ **لا مقارنةً بسائقٍ آخرَ**: لا رُتبةَ ولا متوسّطَ.
 *   ــ **لا رابطَ قراءةٍ موقَّعٍ**: عرضُ الشعارِ والباركودِ دَينٌ مُعلَنٌ.
 */

export interface ApiVehicleDocument {
  readonly status: string | null;
  readonly expires_at: string | null;
}

export interface ApiDriverVehicleResponse {
  readonly vehicle_type: string | null;
  readonly plate_number: string | null;
  readonly vehicle_year: number | null;
  readonly logo_object_path: string | null;
  readonly barcode_object_path: string | null;
  readonly registration_status: string | null;
  readonly registration_expires_at: string | null;
  readonly insurance_status: string | null;
  readonly insurance_expires_at: string | null;
  readonly inspection_status: string | null;
  readonly inspection_expires_at: string | null;
}

export interface ApiDriverVehicleUpdateResponse {
  readonly ok: true;
}

export interface ApiDriverVehicleAssetsResponse {
  readonly ok: true;
}

/** روابطُ قراءةٍ موقَّعةٌ للشعارِ والباركودِ — من `GET /v1/driver/vehicle/assets`. */
export interface ApiDriverVehicleAssetsReadResponse {
  readonly logoReadUrl: string | null;
  readonly barcodeReadUrl: string | null;
}
