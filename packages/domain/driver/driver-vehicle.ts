/**
 * الغرض: مجالُ مركبةِ السائقِ — بياناتُ المركبةِ الأساسيّةُ ووثائقُها الثلاثُ
 *   (رخصةُ السيرِ، التأمينُ، الفحصُ الفنّيُّ) (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/driver-vehicle.ts`
 *   · `packages/infrastructure/driver/driver-vehicle-store.ts`
 *   · `apps/gateway/src/routes/driver-vehicle.ts`
 *   · `apps/miniapp/src/surfaces/driver/vehicle/*`
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ وثائقُ المركبةِ تُقرأُ من `driver_documents` لا من عمودٍ
 *
 * رخصةُ السيرِ والتأمينُ والفحصُ الفنّيُّ وثائقُ **لها تاريخُ انتهاءٍ**،
 * والقاعدةُ `F3-01` بنت لها جدولاً واحداً بستّةِ أنواعٍ. فنسخُ حالاتِها
 * في أعمدةٍ على `drivers` مصدرُ حقيقةٍ ثانٍ يتخلّفُ، والحجبُ (`F12-14`)
 * يقرأُ من الجدولِ لا من العمودِ. **فتُقرأُ الثلاثُ من `driver_documents`
 * بنوعِها وحالتِها وتاريخِ انتهائِها في نداءِ القراءةِ نفسِه.**
 *
 * ## ولِمَ سنةُ الصنعِ `int` لا `text`
 *
 * السنةُ عددٌ صحيحٌ رباعيُّ الخاناتِ لا نصٌّ، والقاعدةُ تُخزِّنُها `integer`.
 * والتحققُ من مجالِها (١٩٠٠…٢١٠٠) في الطبقةِ لا في القاعدةِ، لأنَّه **شكلٌ
 * لا سياسةٌ**: سنةٌ ليست رقماً عطُبُ صياغةٍ لا يُنفَقُ له ذَهابٌ.
 *
 * ## وما لا يقولُه هذا المجالُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يولِّدُ باركوداً**: توليدُ الباركودِ من الشعارِ عملُ عرضٍ.
 *   ــ **لا يُوقِّعُ روابطَ قراءةٍ**: عرضُ الشعارِ والباركودِ دَينٌ مُعلَنٌ.
 *   ــ **لا يقرأُ صورةَ المركبةِ**: `vehicle_photo_file_id` عمودٌ قائمٌ
 *      من `F3-01`، وقراءتُه برابطٍ موقَّعٍ دَينٌ مُعلَنٌ.
 *   ــ **لا يحسبُ يوماً من ساعةِ العمليّةِ**: الأيّامُ الباقيةُ من القاعدةِ.
 */

/** سنةُ الصنعِ — عددٌ صحيحٌ في مجالٍ معقولٍ. */
export const VEHICLE_YEAR_MIN = 1900;
export const VEHICLE_YEAR_MAX = 2100;

/** أنواعُ المركبةِ المسموحَةُ — من `platform_settings` لا من ثابتٍ. */
export const VEHICLE_TYPES = ["sedan", "suv", "van", "pickup", "motorcycle"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** وثيقةُ المركبةِ — حالةٌ وتاريخُ انتهاءٍ. */
export interface VehicleDocument {
  readonly status: string | null;
  readonly expiresAt: string | null;
}

/** بياناتُ المركبةِ الكاملةُ — تُقرأُ في نداءٍ واحدٍ. */
export interface DriverVehicle {
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly vehicleYear: number | null;
  readonly logoObjectPath: string | null;
  readonly barcodeObjectPath: string | null;
  readonly registration: VehicleDocument | null;
  readonly insurance: VehicleDocument | null;
  readonly inspection: VehicleDocument | null;
}

/** مدخلاتُ تحديثِ بياناتِ المركبةِ الأساسيّةِ. */
export interface VehicleUpdateInput {
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly vehicleYear: number | null;
}

/** نتيجةُ التحقُّقِ من سنةِ الصنعِ. */
export function validateVehicleYear(
  year: number | null,
): { ok: true } | { ok: false; reason: "YEAR_INVALID" } {
  if (year === null) return { ok: true };
  if (!Number.isInteger(year)) return { ok: false, reason: "YEAR_INVALID" };
  if (year < VEHICLE_YEAR_MIN || year > VEHICLE_YEAR_MAX)
    return { ok: false, reason: "YEAR_INVALID" };
  return { ok: true };
}
