/**
 * الغرض: نصُّ نوعِ المركبةِ بلغةِ القارئِ لا رمزَ القاعدةِ الخامَ (`UX-V2`).
 * الحالة: منفّذ فعلياً — إعادةُ تصميمِ الواجهاتِ `UX-V2` (`ADR 0248`).
 * ينتمي إلى: apps/miniapp/src/system
 * يُتوقع أن يستخدمه لاحقاً: كلُّ شاشةٍ تعرضُ مركبةَ السائقِ (الرحلةُ النشطةُ،
 *   تفاصيلُ الرحلةِ، الملخّصُ، مركبتي).
 * ملاحظات مستقبلية: المفاتيحُ `vehicle.type.*` في النواة (يقرؤها الراكبُ والسائق)؛ القائمةُ تطابقُ `VEHICLE_TYPES` في `packages/domain/driver/driver-vehicle.ts`؛
 *   نوعٌ خارجَها (قيمةٌ قديمةٌ حرّةٌ) يُعرَضُ كما كُتِبَ — لا مفتاحاً خاماً ولا تخميناً.
 */

export const KNOWN_VEHICLE_TYPES = ["sedan", "suv", "van", "pickup", "motorcycle"] as const;

export function isKnownVehicleType(value: string): boolean {
  return (KNOWN_VEHICLE_TYPES as readonly string[]).includes(value);
}

/** `sedan` ⇒ «سيدان»؛ وقيمةٌ غيرُ معروفةٍ تبقى نصَّها، و`null` تبقى `null`. */
export function vehicleTypeText(t: (key: string) => string, raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  return isKnownVehicleType(raw) ? t(`vehicle.type.${raw}`) : raw;
}
