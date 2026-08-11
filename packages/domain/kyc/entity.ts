/**
 * الغرض: اكتمال ملفّ السائق التوثيقي — ما الناقص بالضبط، لا مجرّد "ناقص".
 *   القرار هنا لأن "ما الذي يجعل السائق قابلاً للتوثيق" قاعدة عمل لا تفصيل عرض.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: domain/kyc
 * يستخدمه: application/bots/driver-dialog، لوحة الإدارة
 * ملاحظات مستقبلية: عند إضافة رخصة القيادة وتأمين المركبة تُضاف هنا وحدها،
 *   فتنتقل تلقائياً إلى البوت والإدارة بلا تعديل فيهما.
 */

/** حقول الملفّ التوثيقي كما هي مخزَّنة — أي منها قد يكون غائباً. */
export interface DriverKycProfile {
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly nationalId: string | null;
  readonly vehiclePhotoFileId: string | null;
}

export const KYC_FIELDS = ["vehicle_type", "plate_number", "national_id", "vehicle_photo"] as const;
export type KycField = (typeof KYC_FIELDS)[number];

/**
 * ما ينقص الملفّ. تُعاد القائمة لا قيمة منطقية واحدة عمداً: قول "ملفّك ناقص"
 * لسائقٍ لا يعرف أيّ حقلٍ يعني تركه يخمّن، وهو نفس عطب "أنت الآن متاح" الذي
 * أخفى عنه سبب عدم وصول الطلبات. من يُمنَع يجب أن يُقال له ما يفعل بالضبط.
 */
export function missingKycFields(profile: DriverKycProfile): readonly KycField[] {
  const missing: KycField[] = [];
  if (isBlank(profile.vehicleType)) missing.push("vehicle_type");
  if (isBlank(profile.plateNumber)) missing.push("plate_number");
  if (isBlank(profile.nationalId)) missing.push("national_id");
  if (isBlank(profile.vehiclePhotoFileId)) missing.push("vehicle_photo");
  return missing;
}

export function isKycComplete(profile: DriverKycProfile): boolean {
  return missingKycFields(profile).length === 0;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}
