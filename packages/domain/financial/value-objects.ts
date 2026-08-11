/**
 * الغرض: كائنات القيمة الثابتة لوحدة financial — حالات معاملة الدفع وأنواع دفتر الأستاذ.
 *   الكيانات نفسها في entity.ts؛ هذا الملف للأنواع المساعدة وحدها التي قد تستقلّ
 *   عن الكيان لاحقاً (مثل توقيع مزوّد الدفع).
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: domain/financial
 */

export type { PaymentTransactionStatus, LedgerEntryType } from "./entity.ts";
