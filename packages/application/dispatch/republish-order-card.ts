/**
 * الغرض: إعادة نشر بطاقة الطلب في قروب غير المشتركين بعد نفاد الثلاثة (الخطوة 5 من القسم 3.4).
 *   لا منطق جديد هنا: ترقيم الدورة واستبعاد سائقي الدورة السابقة كلاهما داخل الدالة
 *   open_unsubscribed_cycle، فإعادة النشر هي النشر نفسه بدورة تالية — والتسمية المستقلة
 *   موجودة لأن نيّة المتصل مختلفة، لا لأن السلوك مختلف.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 * ملاحظات مستقبلية: إن اختلفت البطاقة المعادة عن الأولى (تنبيه «طلب معاد») تُضاف هنا لا في النشر.
 */

import type { OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import {
  type PublishReport,
  type PublishToUnsubscribedGroupDependencies,
  type PublishToUnsubscribedGroupError,
  publishToUnsubscribedGroup,
} from "./publish-to-unsubscribed-group.ts";

export type RepublishReport = PublishReport;
export type RepublishError = PublishToUnsubscribedGroupError;
export type RepublishDependencies = PublishToUnsubscribedGroupDependencies;

/**
 * يُعيد نشر البطاقة. يفشل بسبب CYCLES_EXHAUSTED عندما يبلغ العدد سقف المدينة،
 * وعندها يقرّر المتصل التصعيد — القرار ليس هنا لأن هذه الدالة لا تعرف قروب الإسناد.
 */
export async function republishOrderCard(
  input: { readonly orderId: OrderId },
  deps: RepublishDependencies,
): Promise<Result<RepublishReport, RepublishError>> {
  return publishToUnsubscribedGroup(input, deps);
}
