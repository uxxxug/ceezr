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
 *   ــ **لا رابطَ قراءةٍ موقَّعٍ**: الدَّينُ المُعلَنُ مُنشَطٌ — مسارُ
 *      `GET /v1/driver/vehicle/assets` يُوقِّعُ روابطَ قراءةٍ عبرَ `ReadUrlSigner`
 *      (F12-06 · `ADR 0094`).
 */

/**
 * شكلُ الجوابِ **كما يُرسِلُه الخادمُ حرفاً**: `GET /v1/driver/vehicle` يُعيدُ
 * `DriverVehicle` من `packages/domain/driver/driver-vehicle.ts` بمفاتيحَ
 * `camelCase` ووثائقَ متداخلةٍ (`UX-V2`: كانَ العقدُ هنا `snake_case` فتُقرأُ
 * القيمُ `undefined` على الشاشةِ). والخادمُ مصدرُ الحقيقةِ، فالعميلُ يتبعُه.
 */
export interface ApiVehicleDocument {
  readonly status: string | null;
  readonly expiresAt: string | null;
}

export interface ApiDriverVehicleResponse {
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly vehicleYear: number | null;
  readonly logoObjectPath: string | null;
  readonly barcodeObjectPath: string | null;
  readonly registration: ApiVehicleDocument | null;
  readonly insurance: ApiVehicleDocument | null;
  readonly inspection: ApiVehicleDocument | null;
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
