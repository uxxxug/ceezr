/**
 * الغرض: الأرضيّةُ الدوريّة لإعادة عرض الطلبات الباحثة — المرحلة ١٤.
 *
 *   ولماذا مهمّةٌ دوريّةٌ والمحاولةُ الفوريّة موجودةٌ في بوت السائق؟ لأنّ الحدثَ الذي
 *   يوجب إعادةَ العرض ليس «وصل موقعُ سائق» وحده: قد يجدّد سائقٌ اشتراكَه، أو يُوثَّقه
 *   مسؤولٌ من اللوحة، أو تنتهي مهلةُ عرضٍ تجاهله صاحبُه، أو يُنهي سائقٌ رحلتَه فيعود
 *   مؤهّلاً، أو يُغيّر مسؤولٌ نصفَ قطر المدينة فيصير البعيدُ قريباً. فلو كان لكلّ
 *   سببٍ خُطّافُه لَبقيَ ما لا خُطّافَ له — ولا يظهر النقصُ إلا كطلبٍ مات بلا سبب.
 *
 *   والمهمّةُ الدوريّةُ تُغطّي الأسبابَ كلَّها بمسارٍ واحدٍ لأنّها لا تسأل «ما الذي
 *   تغيّر» بل «أيُّ طلبٍ ما زال يبحث» — والسؤالُ الثاني صحيحٌ مهما كان الجواب عن
 *   الأول. وهي كذلك شبكةُ أمانٍ للمحاولة الفوريّة: عمليةٌ تسقط بين حفظِ الموقع
 *   والبثّ تُترك الطلبَ عالقاً، والشوطُ التالي يُدركه.
 *
 * الحالة: منفّذ ومُختبَر على قاعدةٍ حقيقية.
 * ينتمي إلى: apps/workers/src/jobs
 * يستخدمه: apps/workers/src/container.ts
 * ملاحظات مستقبلية: تعدّدُ النسخ آمنٌ بالقفل الموزَّع في المشغّل، وسباقُ القبول
 *   تحكمه `claim_ride` في القاعدة — فلا حاجةَ لقفلٍ على مستوى الطلب.
 */

import {
  type RedispatchDependencies,
  type RedispatchReport,
  redispatchSearchingOrders,
} from "../../../../packages/application/dispatch/redispatch-searching-orders.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export type RedispatchSearchingDeps = RedispatchDependencies;
export type { RedispatchReport };

export function runRedispatchSearching(
  cityId: CityId,
  deps: RedispatchSearchingDeps,
): Promise<Result<RedispatchReport, PortFailureError>> {
  return redispatchSearchingOrders(cityId, deps);
}
