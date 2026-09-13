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
 * طورُ الرحلةِ كما يراهُ الراكبُ. **أربعةٌ لا أكثرُ**، وكلٌّ منها له مصدرٌ في
 * القاعدةِ يُقرأُ — لا طورَ بلا عمودٍ يُثبِتُه.
 */
export type ActiveRidePhase =
  /** `matched` وسائقٌ مُسنَدٌ: في طريقِه إلى نقطةِ الالتقاطِ. */
  | "driver_assigned"
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
}

/**
 * الطورُ من الحالةِ **ووجودِ السائقِ معاً**.
 *
 * و`matched` بلا بطاقةِ سائقٍ **تُعادُ `searching`** لا `driver_assigned`:
 * القيدُ `orders_matched_requires_driver` يمنعُ ذلكَ في القاعدةِ، فإن وقعَ فهوَ
 * عطبٌ — والأسلمُ للراكبِ أن يرى «نبحثُ» من أن يرى بطاقةً فارغةً.
 */
export function activeRidePhaseOf(snapshot: ActiveRideSnapshot): ActiveRidePhase {
  const { status } = snapshot;
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "failed") return "closed";
  if (status === "in_progress") return snapshot.hasDriver ? "on_trip" : "closed";
  if (status === "matched") return snapshot.hasDriver ? "driver_assigned" : "searching";
  return "searching";
}

/** هل هذا الطورُ شأنُ شاشةِ الرحلةِ النشطةِ أصلاً؟ */
export function isActivePhase(phase: ActiveRidePhase): boolean {
  return phase === "driver_assigned" || phase === "on_trip";
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
  if (phase === "driver_assigned") return "AFTER_ASSIGNMENT_UNDECIDED";
  return "NOT_CANCELLABLE";
}
