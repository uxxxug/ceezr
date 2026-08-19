/**
 * الغرض: اشتقاقُ حالةِ السائق التشغيلية العشرية التي يقرؤها مشغّلُ العمليات على
 *   الخريطة الحيّة، من الوقائع القائمة وحدها: حالةُ الطلب، وحالةُ جلسةِ التتبّع،
 *   والإتاحة، وقُربُ السائق من الانطلاق أو المقصد.
 * الحالة: منفّذ فعلياً — المرحلة ١٣.
 * ينتمي إلى: packages/domain/tracking
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts (صفحة الخريطة
 *   الحيّة)، و`admin-live.ts` (لقطةُ SSE)، والمرحلة ١٤ (التوزيع يقرأ من نفس المصدر).
 * ملاحظات مستقبلية: المرحلة ١٧ (الأسيجة الجغرافية) قد تُوحّد نصفَ قطر الوصول مع
 *   سياسةِ الأسيجة — يُغيَّر `DEFAULT_OPERATIONS_POLICY` وحده، لا مواضعُ النداء.
 */

import { haversineKm } from "../geo/index.ts";
import type { Coordinates } from "../geo/value-objects.ts";
import {
  DEFAULT_SESSION_POLICY,
  type SessionPolicy,
  sessionStateAt,
  type TrackingSessionFacts,
} from "./session.ts";

/**
 * الحالاتُ العشر التي تظهر لمشغّل العمليات.
 *
 * ## لماذا تُشتَقّ ولا تُخزَّن
 *
 * لا شيءَ من هذه العشر موجودٌ في القاعدة عموداً: `order_status` في القاعدة ستّ
 * قيمٍ فقط (`searching`/`matched`/`in_progress`/`completed`/`cancelled`/`failed`)،
 * ولا جدولَ أحداثِ وصولٍ ولا طابعَ «وصل إلى الانطلاق». فكان أمامي طريقان:
 *
 * ١. إضافةُ عمودٍ أو جدولٍ يُكتب فيه «وصل» و«أقلّ الراكب» — أي **مصدرٌ ثانٍ
 *    للحقيقة** بجوار `orders.status` و`drivers.last_location`، يتباعد عنهما عند
 *    أوّل كتابةٍ تسقط، فيرى المشغّل «عند الانطلاق» لسائقٍ صار في الطريق. وهذا
 *    ممنوعٌ بالقاعدة ٥.
 * ٢. اشتقاقُها دالّةً نقيّةً من الوقائع القائمة. الحالةُ حينئذٍ **لا تكذب أبداً**:
 *    إن ابتعد السائق عن الانطلاق انقلبت من `AT_PICKUP` إلى `TO_PICKUP` من نفسها.
 *
 * واختير الثاني. وثمنُه أن الحالة لحظيّةٌ لا تاريخية: لا يُعرَف منها «متى وصل»،
 * ولا يُدَّعى ذلك. وقياسُ الأزمنة الفعلية للأطوار عملُ المرحلة ٢٤ إن طُلب، ويحتاج
 * تخزيناً — وحينها يُخزَّن **حدثٌ** بطابعه، لا حالةٌ تُنافس الاشتقاق.
 */
export type OperationsStatus =
  | "AVAILABLE"
  | "ASSIGNED"
  | "TO_PICKUP"
  | "AT_PICKUP"
  | "PICKED_UP"
  | "TO_CUSTOMER"
  | "ARRIVED"
  | "COMPLETED"
  | "OFFLINE"
  | "STALE";

/** وقائعُ الرحلة كما هي في `orders` — بلا أيّ حكمٍ مسبق. */
export interface OperationsTripFacts {
  /** قيمةُ `orders.status` نصّاً كما تُقرأ من القاعدة. */
  readonly status: string;
  readonly pickup: Coordinates | null;
  /** `orders.dropoff` يقبل الفراغ في القاعدة (المرحلة ١٢) — فالمقصد قد يغيب. */
  readonly destination: Coordinates | null;
}

export interface OperationsFacts {
  /** `null` = لا جلسةَ تتبّعٍ ألبتّة لهذا السائق. */
  readonly session: TrackingSessionFacts | null;
  /** `driver_availability.is_available` — الإتاحةُ المُعلنة، لا المُستنتَجة. */
  readonly isAvailable: boolean;
  /** `drivers.last_location` — الموقعُ القانوني الواحد (ADR 0015). */
  readonly driverLocation: Coordinates | null;
  readonly trip: OperationsTripFacts | null;
}

export interface OperationsPolicy {
  /**
   * نصفُ قطرِ «الوصول»: دونه يُقال إن السائق **عند** النقطة لا متوجّهاً إليها.
   *
   * مئةٌ وخمسون متراً لا رقمٌ اعتباطي: دقّةُ GPS في شوارع المدن عشراتُ الأمتار
   * (وقيدُ القاعدة نفسُه يسمح بـ`last_location_accuracy_m` كبيرة)، فنصفُ قطرٍ
   * أصغر يجعل الحالة ترتجف بين `AT_PICKUP` و`TO_PICKUP` والسائقُ واقفٌ مكانه —
   * وارتجافٌ في شاشةِ إرسالٍ أسوأ من تصنيفٍ أخشن، لأنه يُدرَّب المشغّل على
   * تجاهل اللون. ونصفُ قطرٍ أكبر (٥٠٠م) يُعلن الوصولَ والسائق ما زال شارعين بعيداً.
   */
  readonly arrivalRadiusKm: number;
}

export const DEFAULT_OPERATIONS_POLICY: OperationsPolicy = {
  arrivalRadiusKm: 0.15,
};

/** الرحلةُ حيّةٌ = تُلزم المشغّلَ بمتابعتها الآن. */
function isTripLive(status: string): boolean {
  return status === "matched" || status === "in_progress";
}

function isNear(a: Coordinates | null, b: Coordinates | null, radiusKm: number): boolean {
  if (a === null || b === null) return false;
  return haversineKm(a, b) <= radiusKm;
}

/**
 * الحالةُ التشغيلية للسائق الآن. دالّةٌ **كلّية**: لكلّ تركيبٍ من الوقائع حالةٌ
 * واحدة، فلا يبقى سائقٌ بلا تصنيفٍ على الشاشة.
 *
 * ## ترتيبُ الأولويات، وسببُ كلِّ درجة
 *
 * ١. **`STALE` تتقدّم على كلّ وصفِ مرحلة.** لأن الموقعَ حينها غيرُ جديرٍ بالثقة،
 *    وقولُ `TO_CUSTOMER` لسائقٍ انقطع قبل نصف ساعة ادّعاءُ متابعةٍ لا تجري. وقد
 *    قِيس هذا الخطر فعلاً: جلسةٌ آخرُ إصلاحةٍ فيها قبل ٣٥ دقيقة كانت تظهر للمشغّل
 *    **بلا أيّ فارقٍ** عن سائقٍ يُرسل الآن — فيُسنِد إليه طلباً وقد انصرف.
 *    والحالةُ لا تكتم الرحلة: الصفُّ يحمل الرحلةَ وحالتَها بجوار `STALE`.
 *
 * ٢. **رحلةٌ حيّةٌ بلا جلسة ⇒ `STALE` لا `OFFLINE`.** وهذا أثرُ أخطرِ عيبٍ قيس في
 *    هذه المرحلة: سائقٌ رحلته `in_progress` وجلستُه أُغلقت (سقفُ ١٢ ساعة أو
 *    `EXPIRED`) كان **يغيب عن الخريطة كليّاً** — راكبٌ في سيّارةٍ ولا يستطيع
 *    المشغّل رؤية سائقها ألبتّة. فالرحلةُ الحيّة أقوى سببٍ لإبقاء السائق مرئياً،
 *    ويُوسَم موقعُه غيرَ موثوقٍ لا أن يُحذف صاحبُه.
 *
 * ٣. **`COMPLETED` داخلَ فرع الجلسة الحيّة وحده.** رحلةٌ انتهت وجلستُها أُغلقت
 *    ⇒ السائق يعود إلى وصفِ دوامه (`AVAILABLE`/`OFFLINE`)، لا يُثبَّت «مكتمل»
 *    على الشاشة إلى الأبد.
 *
 * ٤. **`ASSIGNED` = مُسنَدٌ ولا نستطيع وضعَه على مرحلة.** إمّا لأن الجلسة فُتحت
 *    ولم تصل إصلاحةٌ بعد (`CREATED` — وهي لحظةُ القبول تماماً)، أو لأن الموقع أو
 *    نقطةَ الانطلاق مجهولة. وهي أصدقُ من `TO_PICKUP` التي تُفيد أنه يتحرّك فعلاً.
 *
 * ٥. **`PICKED_UP` و`TO_CUSTOMER` كلتاهما `in_progress`** في القاعدة، والفارقُ
 *    بينهما قُربٌ من الانطلاق: من بدأ ولم يبتعد بعد «أقلّ الراكب»، ومن ابتعد
 *    «متوجّهٌ إلى العميل». وهذا اشتقاقٌ من موضعٍ حقيقي لا اختراعُ حدثٍ.
 */
export function operationsStatusOf(
  facts: OperationsFacts,
  nowMs: number,
  policy: OperationsPolicy = DEFAULT_OPERATIONS_POLICY,
  sessionPolicy: SessionPolicy = DEFAULT_SESSION_POLICY,
): OperationsStatus {
  const tripLive = facts.trip !== null && isTripLive(facts.trip.status);

  const sessionState =
    facts.session === null ? "ENDED" : sessionStateAt(facts.session, nowMs, sessionPolicy);

  // (١) و(٢): لا موقعَ موثوق ⇒ لا ادّعاءَ مرحلة.
  if (sessionState === "STALE") return "STALE";
  if (sessionState === "ENDED") return tripLive ? "STALE" : dutyStatus(facts.isAvailable);

  // من هنا: الجلسةُ مفتوحةٌ وحديثة (`ACTIVE`) أو فُتحت ولم تصل إصلاحةٌ (`CREATED`).
  if (facts.trip === null || !tripLive) {
    // (٣) رحلةٌ اكتملت وجلستُها ما زالت مفتوحة: لحظةُ ما بعد التسليم.
    if (facts.trip !== null && facts.trip.status === "completed") return "COMPLETED";
    // ملغاةٌ أو فاشلةٌ أو باحثة: لم تعد تُلزم السائقَ بشيء، فيُوصَف بدوامه.
    return dutyStatus(facts.isAvailable);
  }

  const { driverLocation } = facts;

  // (٤) مُسنَدٌ ولا يُمكن وضعُه على مرحلة.
  if (driverLocation === null || sessionState === "CREATED") return "ASSIGNED";

  if (facts.trip.status === "matched") {
    if (facts.trip.pickup === null) return "ASSIGNED";
    return isNear(driverLocation, facts.trip.pickup, policy.arrivalRadiusKm)
      ? "AT_PICKUP"
      : "TO_PICKUP";
  }

  // in_progress
  if (isNear(driverLocation, facts.trip.destination, policy.arrivalRadiusKm)) return "ARRIVED";
  // (٥) بدأ ولم يبتعد عن الانطلاق بعد.
  if (isNear(driverLocation, facts.trip.pickup, policy.arrivalRadiusKm)) return "PICKED_UP";
  // لا مقصدَ معروف ⇒ لا يُقال «متوجّهٌ إلى العميل» بثقةٍ أكبر من المعلوم، لكنه
  // ابتعد عن الانطلاق فعلاً، والرحلةُ جارية. و`TO_CUSTOMER` هي الوصفُ الصحيح
  // للاتّجاه، والمقصدُ المجهول يُبيَّن في الصفّ لا في الحالة.
  return "TO_CUSTOMER";
}

function dutyStatus(isAvailable: boolean): OperationsStatus {
  return isAvailable ? "AVAILABLE" : "OFFLINE";
}

/**
 * هل الحالةُ تُلزم المشغّلَ بالنظر الآن؟
 *
 * تُستعمل لعدّاداتِ رأسِ الصفحة: `STALE` و`ASSIGNED` هما ما يستدعي تدخّلاً —
 * الأولى لأن سائقاً على رحلةٍ لا يُرى، والثانية لأن مُسنَداً لم يتحرّك بعد.
 */
export function needsAttention(status: OperationsStatus): boolean {
  return status === "STALE" || status === "ASSIGNED";
}
