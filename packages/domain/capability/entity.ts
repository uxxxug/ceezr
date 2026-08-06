/**
 * الغرض: نوع الخدمة التي فعّلها السائق فعلاً — سائق "مشاوير فقط" لا يستقبل عرض توصيل.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/capability
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch (فلترة المرشحين)، application/capability
 * ملاحظات مستقبلية: أنواع المركبات تتوسّع بلا تعديل هذا المنطق (نص حرّ مُتحقَّق من القاعدة).
 */

import type { CityId, DriverId, ServiceType } from "../../shared/kernel/index.ts";

export interface DriverCapability {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly isEnabled: boolean;
}

/** هل السائق مفعِّل هذه الخدمة الآن؟ */
export function canServe(
  capabilities: readonly DriverCapability[],
  service: ServiceType,
): boolean {
  return capabilities.some((c) => c.service === service && c.isEnabled);
}

/** الخدمات المفعَّلة فعلياً — تُقارن لاحقاً بما تغطيه خطة الاشتراك. */
export function enabledServices(
  capabilities: readonly DriverCapability[],
): readonly ServiceType[] {
  return capabilities.filter((c) => c.isEnabled).map((c) => c.service);
}
