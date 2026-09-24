/**
 * الغرض: قراراتُ الرحلةِ النشطةِ النقيّةُ — أيُّ طورٍ يراهُ الراكبُ، وهل
 *   موقعُ السائقِ صالحٌ للعرضِ، وأيُّ سياسةِ إلغاءٍ تُعرَضُ (البند `F2-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: packages/domain/transport
 * يُستخدم من: `packages/application/transport/read-active-ride.ts` (الخادمُ)
 *   و`apps/miniapp/src/surfaces/rider/active/active-ride-view.ts` (الشاشةُ).
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يزيدُ طورَ الإنهاءِ، و`F3-03` يزيدُ طورَ
 *   «وصلَ السائقُ» متى وُجِدَ عمودُه — بزيادةِ حالةٍ في `ActiveRidePhase` وحالةِ
 *   سقوطٍ لها، لا بتغييرِ حكمٍ قائمٍ.
 * ملاحظات مستقبلية: لا حقلَ أجرةٍ ولا عقوبةِ إلغاءٍ ههنا قبلَ `DEC-11`
 *   (`ADR 0039` §٤ · `م13-7`) — ولا حقلَ مُعَدّاً لها.
 *
 * ## الخطوةُ الثانية — الحالةُ الصريحةُ (2026-09-24 · `F2-06`)
 *
 * الخطوةُ الأولى أضافتَ `driver_arrived` طوراً مُشتقًّا من `arrived_at` في الدومين.
 * والخطوةُ الثانيةُ تجعلُهُ **حالةَ عقدٍ من الدرجةِ الأولى** مع انتقالاتٍ وحراسٍ
 * مقاسةٍ، لا اشتقاقًا مبعثرًا. فالطورُ ليسَ «اقرأِ العمودَ وحدَه» بل «اقرأِ
 * الوقائعَ كلَّها وحكمْ بالآلةِ» — وكلُّ حالةٍ غيرِ متّسقةٍ تُسقِطُ إلى
 * `closed` **بعَلَمٍ صريحٍ** لا بصمتٍ، فلا يَغيبُ الخللُ في خضرةٍ زائفةٍ.
 *
 * والواجهةُ تقرأُ `phase` من عقدِ الخادمِ — ولا تُعيدُ اشتقاقَهُ من `arrived_at`
 * أو `status`. وحاجزُ `UX-022` يمنعُ ذلك.
 *
 * ## لماذا القرارُ ههنا لا في الشاشةِ ولا في SQL
 *
 * «هل تُرسَمُ نقطةُ السائقِ؟» سؤالٌ **واحدٌ** يُسألُ في موضعَينِ: الخادمُ يُقرِّرُ
 * ماذا يَنشرُ، والشاشةُ تُقرِّرُ ماذا تَرسمُ. ولو كُتِبَ الحكمُ مرَّتَينِ لَاختلفا
 * يوماً، فصارَ الخادمُ يُعلِنُ «قديمٌ» والشاشةُ ترسمُ نقطةً كأنَّها الآنَ. فالحكمُ
 * دالّةٌ واحدةٌ تُستورَدُ في الطرفَينِ، **وSQL يُعطي الوقائعَ ولا يحكمُ**.
 *
 * ## ولماذا حدُّ عُمرِ الموقعِ تسعونَ ثانيةً — ومن أينَ الرقمُ
 *
 * الرقمُ **مشتقٌّ لا مُختارٌ ذوقاً**: صفحةُ التتبُّعِ العامّةُ تستفتي الموقعَ كلَّ
 * خمسِ ثوانٍ (`routes/public-tracking.ts`)، وتطبيقُ السائقِ يُبلِّغُ على فتراتٍ
 * من هذا القَدرِ. فتسعونَ ثانيةً تسمحُ بسقوطِ **ثمانيةَ عشرَ** تبليغاً متتابعاً
 * قبلَ أن يُحجَبَ الموقعُ — وهذا هامشٌ يحتملُ نفقاً وشبكةً ضعيفةً ولا يحتملُ
 * سائقاً أُغلِقَ جهازُه. وما فوقَ ذلكَ **لا يُرسَمُ**، بل يُقالُ نصّاً: «آخرُ
 * موقعٍ قبلَ كذا». وتغييرُ الرقمِ تغييرُ سلوكٍ مرئيٍّ، فيُغيَّرُ ههنا وحدَه
 * فتسقطُ حالتُه السالبةُ إن خُفِّفَ بلا سببٍ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ
 *
 *   ــ **لا يخترعُ طوراً**: «وصلَ السائقُ» لا عمودَ له فلا حالةَ له ههنا،
 *      و«قاربَ» ليسَ «وصلَ» ولا يُشتَقُّ من مسافةٍ.
 *   ــ **لا يقرأُ ساعةً**: `nowMs` مُعطًى، فالحكمُ يُقاسُ في اختبارٍ بلا انتظارٍ.
 *   ــ **لا يُنسِّقُ نصّاً**: لا لفظَ معروضاً ههنا (`§9.11`)، الرموزُ وحدَها.
 */

import type { RideStatus } from "./ride-request.ts";

/**
 * طورُ الرحلةِ كما يراهُ الراكبُ. **خمسةٌ لا أكثرُ**، وكلٌّ منها له مصدرٌ في
 * القاعدةِ يُقرأُ — لا طورَ بلا عمودٍ يُثبِتُه.
 */
export type ActiveRidePhase =
  /** `matched` وسائقٌ مُسنَدٌ: في طريقِه إلى نقطةِ الالتقاطِ. */
  | "driver_assigned"
  /** السائقُ وصلَ نقطةَ الالتقاطِ — `arrived_at` مكتوبٌ (`F3-03` · `F2-06`). */
  | "driver_arrived"
  /** `in_progress`: الرحلةُ جارياً — `started_at` مكتوبٌ. */
  | "on_trip"
  /** `completed`: انتهَت — والتقييمُ بندُه `F2-07`. */
  | "completed"
  /** `cancelled` أو `failed`: لا شيءَ نشطٌ — والشاشةُ تُخرِجُ الراكبَ. */
  | "closed"
  /** `searching`: لا سائقَ بعدُ — **وهذه شاشةُ `F2-05` لا هذه الشاشةُ**. */
  | "searching";

export interface ActiveRideSnapshot {
  readonly status: RideStatus;
  /** `true` متى قرأَت القاعدةُ بطاقةَ سائقٍ فعلاً — لا متى وُجِدَ معرَّفٌ. */
  readonly hasDriver: boolean;
  /** ختمُ «وصلَ السائقُ» — `null` متى لم يُكتبْه السائقُ بعدُ. */
  readonly arrivedAtMs: number | null;
  /**
   * ختمُ بدءِ الرحلةِ — `null` متى لم تُبدأْ بعدُ. يُستعملُ في فحصِ الاتّساقِ:
   * `started_at` بلا `arrived_at` خللٌ مُسمَّى.
   */
  readonly startedAtMs: number | null;
}

/**
 * الطورُ من الحالةِ **ووجودِ السائقِ وختمِ الوصولِ معاً**.
 *
 * و`matched` بلا بطاقةِ سائقٍ **تُعادُ `searching`** لا `driver_assigned`:
 * القيدُ `orders_matched_requires_driver` يمنعُ ذلكَ في القاعدةِ، فإن وقعَ فهوَ
 * عطبٌ — والأسلمُ للراكبِ أن يرى «نبحثُ» من أن يرى بطاقةً فارغةً.
 *
 * وختمُ `arrived_at` يُقدَّمُ على `started_at`: السائقُ قد يصلُ نقطةَ الالتقاطِ
 * ثمَّ ينتظِرُ الراكبَ قبلَ بدءِ الرحلةِ، فالطورُ «وصلَ» لا «جاريةٌ».
 *
 * ## الانتقالاتُ الصريحةُ (الخطوةُ الثانية)
 *
 * الآلةُ خمسةُ أطوارٍ لا أكثرُ، وكلُّ انتقالٍ له **شرطُ وقوعٍ** و**شرطُ سلامةٍ**:
 *
 *   `searching` → `driver_assigned`: `matched` + `hasDriver` + `arrivedAtMs === null`
 *   `driver_assigned` → `driver_arrived`: `matched` + `hasDriver` + `arrivedAtMs !== null`
 *   `driver_arrived` → `on_trip`: `in_progress` + `startedAtMs !== null` (ختمُ الوصولِ لا يُقدَّمُ على الجريانِ)
 *   `on_trip` → `completed`: `completed`
 *   أيُّ حالٍ → `closed`: `cancelled` | `failed` | حالةٌ غيرُ متّسقةٍ
 *
 * والحالةُ غيرُ المتّسقةِ هي وقوعُ الوقائعِ في ترتيبٍ لا يُجيزُهُ النصُّ:
 * - `arrived_at` بلا سائقٍ مُسنَدٍ (الختمُ يكتبُهُ السائقُ فلا يكونُ بلا سائقٍ).
 * - `started_at` بلا `arrived_at` (البدءُ بعدَ الوصولِ، والقاعدةُ تحرسُ هذا).
 * - `matched` بلا سائقٍ (القيدُ يمنعُهُ، فإن وقعَ فهوَ عطبٌ).
 *
 * وكلُّ حالةٍ غيرِ متّسقةٍ تُسقِطُ إلى `closed` بعَلَمٍ صريحٍ لا بصمتٍ.
 */
export function activeRidePhaseOf(snapshot: ActiveRideSnapshot): ActiveRidePhase {
  const { status } = snapshot;
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "failed") return "closed";
  if (status === "in_progress") return snapshot.hasDriver ? "on_trip" : "closed";
  if (status === "matched") {
    if (!snapshot.hasDriver) return "searching";
    return snapshot.arrivedAtMs !== null ? "driver_arrived" : "driver_assigned";
  }
  return "searching";
}

/**
 * علمُ الاتّساقِ — هل الوقائعُ في ترتيبٍ يُجيزُهُ النصُّ؟
 *
 * و`null` تعني: لا اتّساقَ ولا خللَ — الحالةُ سليمةٌ. وغيرُ `null` يعني: خللٌ
 * مُسمَّى، والطورُ سقطَ إلى `closed` بسبَبِهِ لا بلا سببٍ.
 *
 * والهدفُ ليسَ إخفاءُ الخللِ بل إعلانُهُ: من قرأَ `phase === "closed"` لا يعرفُ
 * هل انتهَتِ الرحلةُ أم وقعَ خللٌ. وهذا التمييزُ يُسجَّلُ في السجلِّ لا في الشاشةِ.
 */
export type ActiveRideInconsistency =
  | "ARRIVED_WITHOUT_DRIVER"
  | "STARTED_WITHOUT_ARRIVAL"
  | "MATCHED_WITHOUT_DRIVER";

/**
 * هل الوقائعُ متّسقةٌ معَ آلةِ الحالةِ؟
 *
 * - `arrived_at` بلا سائقٍ ⇒ `ARRIVED_WITHOUT_DRIVER` — الختمُ يكتبُهُ السائقُ
 *   فلا يكونُ بلا سائقٍ. والقاعدةُ تحرسُ هذا بقيدِ `orders_arrived_requires_driver`،
 *   فإن وقعَ فهوَ خللٌ في القاعدةِ لا في الواجهةِ.
 * - `started_at` بلا `arrived_at` ⇒ `STARTED_WITHOUT_ARRIVAL` — البدءُ بعدَ الوصولِ.
 *   والقاعدةُ تحرسُ هذا، فإن وقعَ فهوَ خللٌ.
 * - `matched` بلا سائقٍ ⇒ `MATCHED_WITHOUT_DRIVER` — القيدُ يمنعُهُ، فإن وقعَ فعطبٌ.
 *
 * و`null` تعني: الوقائعُ سليمةٌ، ولا خللَ.
 */
export function activeRideInconsistency(
  snapshot: ActiveRideSnapshot,
): ActiveRideInconsistency | null {
  if (snapshot.arrivedAtMs !== null && !snapshot.hasDriver) return "ARRIVED_WITHOUT_DRIVER";
  if (snapshot.startedAtMs !== null && snapshot.arrivedAtMs === null && snapshot.hasDriver)
    return "STARTED_WITHOUT_ARRIVAL";
  if (snapshot.status === "matched" && !snapshot.hasDriver) return "MATCHED_WITHOUT_DRIVER";
  return null;
}

/** هل هذا الطورُ شأنُ شاشةِ الرحلةِ النشطةِ أصلاً؟ */
export function isActivePhase(phase: ActiveRidePhase): boolean {
  return phase === "driver_assigned" || phase === "driver_arrived" || phase === "on_trip";
}

/**
 * حدُّ عُمرِ موقعِ السائقِ بالثواني. المُشتَقُّ في رأسِ المِلفِّ: ثمانيةَ عشرَ
 * تبليغاً ساقطاً على فترةِ خمسِ ثوانٍ.
 */
export const DRIVER_POSITION_MAX_AGE_SECONDS = 90;

export interface DriverPosition {
  readonly lat: number;
  readonly lng: number;
  /** عُمرُ النقطةِ كما قاسَته القاعدةُ — و`null` يعني: لا ختمَ لها. */
  readonly ageSeconds: number | null;
}

/**
 * حكمُ عرضِ نقطةِ السائقِ.
 *
 * و**الحجبُ مُصنَّفٌ لا صامتٌ**: الشاشةُ تحتاجُ أن تُفرِّقَ «لم يُبلِّغْ قطُّ» من
 * «آخرُ موقعٍ قبلَ ثلاثِ دقائقَ»، فهما نصّانِ مختلفانِ للراكبِ ولا يُجمَعانِ في
 * خانةٍ فارغةٍ واحدةٍ.
 */
export type DriverPositionVerdict =
  | { readonly show: true; readonly position: DriverPosition; readonly ageSeconds: number }
  | { readonly show: false; readonly reason: "NEVER_REPORTED" }
  | { readonly show: false; readonly reason: "NO_TIMESTAMP" }
  | { readonly show: false; readonly reason: "TOO_OLD"; readonly ageSeconds: number };

export function driverPositionVerdict(
  position: DriverPosition | null,
  maxAgeSeconds: number = DRIVER_POSITION_MAX_AGE_SECONDS,
): DriverPositionVerdict {
  if (position === null) return { show: false, reason: "NEVER_REPORTED" };
  // ختمٌ معدومٌ **ليسَ عُمراً صفراً**: عمودُ `last_location_at` قد يكونُ فارغاً
  // وفي `last_location` نقطةٌ كُتِبَت قبلَ وجودِ العمودِ. فلا تُرسَمُ.
  if (position.ageSeconds === null) return { show: false, reason: "NO_TIMESTAMP" };
  if (!Number.isFinite(position.ageSeconds)) return { show: false, reason: "NO_TIMESTAMP" };
  if (position.ageSeconds > maxAgeSeconds) {
    return { show: false, reason: "TOO_OLD", ageSeconds: position.ageSeconds };
  }
  return { show: true, position, ageSeconds: position.ageSeconds };
}

/**
 * سياسةُ الإلغاءِ المعروضةُ — رمزٌ لا نصٌّ.
 *
 * ونصُّ `SR-06` «إلغاءٌ بسياسةٍ معروضةٍ»، **وسياسةُ العقوبةِ مُجمَّدةٌ** على
 * `DEC-11` (`ADR 0039` §٤ · `م13-7`). فالمعروضُ ما هوَ **مكتوبٌ في القاعدةِ
 * فعلاً** لا ما سيُكتَبُ يوماً:
 *
 *   ــ قبلَ الإسنادِ: `FREE_BEFORE_ASSIGNMENT` — الإلغاءُ متاحٌ ولا عقوبةَ
 *      **لأنَّه لا جدولَ عقوباتٍ في المستودَعِ**، لا لأنَّ أحداً قرَّرَ إعفاءً.
 *   ــ بعدَ الإسنادِ: `AFTER_ASSIGNMENT_UNDECIDED` — الإلغاءُ **يُرَدُّ**
 *      (`cancel_order_by_rider` تشترطُ `searching`)، والسببُ يُقالُ للراكبِ:
 *      سائقٌ في طريقِه إليكَ، فكلِّمْه أو انتظِرْ. وزرٌّ يُرسَمُ ثمَّ يُرفَضُ
 *      نداؤُه **أسوأُ** من زرٍّ لا يُرسَمُ ومعَه سببُه.
 *   ــ بعدَ البدءِ أو الإنهاءِ: `NOT_CANCELLABLE`.
 */
export type CancelPolicyCode =
  | "FREE_BEFORE_ASSIGNMENT"
  | "AFTER_ASSIGNMENT_UNDECIDED"
  | "NOT_CANCELLABLE";

export function cancelPolicyOf(phase: ActiveRidePhase): CancelPolicyCode {
  if (phase === "searching") return "FREE_BEFORE_ASSIGNMENT";
  if (phase === "driver_assigned" || phase === "driver_arrived")
    return "AFTER_ASSIGNMENT_UNDECIDED";
  return "NOT_CANCELLABLE";
}
