/**
 * الغرض: عقدُ قراءةِ الرحلةِ النشطةِ بينَ طبقةِ التطبيقِ والقاعدةِ — وقائعُ
 *   اللقطةِ وحدَها، **بلا حكمٍ وبلا نصٍّ معروضٍ** (البند `F2-06` · `SR-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `read-active-ride.ts` · `infrastructure/transport/active-ride-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يقرأُ اللقطةَ نفسَها بعدَ `completed`،
 *   و`F3-03` يزيدُ ختمَ «وصلَ» حقلاً اختياريّاً ولا يُعدِّلُ ما ههنا.
 * ملاحظات مستقبلية: لا حقلَ أجرةٍ ولا وسيلةِ دفعٍ ولا عقوبةِ إلغاءٍ ولا خانةَ
 *   لها قبلَ `DEC-11` (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا مِنفذٌ ثالثٌ ولم يُزَدْ إلى مِنفذِ `F2-05`
 *
 * مِنفذُ `F2-05` عقدُ **البحثِ**: عددُ المُخطَرينَ ودورةُ البثِّ. وهذا عقدُ
 * **الرحلةِ المُسنَدةِ**: بطاقةُ سائقٍ وموقعٌ بعُمرِه. ولو جُمِعا في واجهةٍ
 * واحدةٍ لَحمَلَ كلُّ قارئٍ حقوقَ الآخرِ، وصارَ شكلُ الردِّ حقولاً نصفُها `null`
 * أبداً — وقارئُ الشِّفرةِ لا يعرفُ أيَّها يُصدَّقُ في أيِّ حالةٍ.
 *
 * ## ولماذا العُمرُ حقلٌ لا مُشتقٌّ عندَ القارئِ
 *
 * لأنَّ القاعدةَ وحدَها تملكُ ساعةً واحدةً للنقطةِ وللآنِ. ولو أُرسِلَ الختمُ
 * وحسبَ التطبيقُ الفرقَ بساعتِه، لَصارَ انحرافُ ساعةِ الخادمِ عُمراً كاذباً
 * فتُرسَمُ نقطةٌ قديمةٌ أو تُحجَبُ نقطةٌ حاضرةٌ.
 *
 * ## وما لا يفعلُه هذا العقدُ
 *
 *   ــ **لا رقمَ هاتفٍ** — لا للسائقِ ولا للراكبِ (`SR-06` يطلبُ اتصالاً، والاتصالُ
 *      المُقنَّعُ غيرُ مبنيٍّ، وعرضُ الرقمِ الخاصِّ قرارُ خصوصيّةٍ لا واجهةٍ).
 *   ــ **لا رمزَ مشاركةٍ** — `F2-09` يملكُه.
 *   ــ **لا صورةَ سائقٍ ولا باركودَ** — لا عمودَ لهما في القاعدةِ.
 */

import type { RideStatus } from "../../domain/transport/ride-request.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RideStoreFailure } from "./ride-request-ports.ts";

export interface ActiveRidePoint {
  readonly lat: number;
  readonly lng: number;
  /** لافتةُ المكانِ كما اختارَها الراكبُ — و`null` غيابٌ لا نصٌّ فارغٌ. */
  readonly label: string | null;
}

/** موقعُ السائقِ **مقروناً بعُمرِه** — ولا يُنشَرُ أحدُهما بلا الآخرِ. */
export interface ActiveRideDriverPosition {
  readonly lat: number;
  readonly lng: number;
  readonly ageSeconds: number | null;
}

/**
 * بطاقةُ السائقِ كما تُقرأُ. وكلُّ حقلٍ يقبلُ `null` **لأنَّ عمودَه يقبلُ
 * العَدَمَ فعلاً** — لا احتياطاً: `vehicle_type` و`plate_number`
 * و`rating_average` أعمدةٌ بلا `not null` في `phase_2_1_core_schema`.
 */
export interface ActiveRideDriver {
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ. **ولا يُستبدَلُ برقمٍ افتراضيٍّ.** */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly position: ActiveRideDriverPosition | null;
}

export interface ActiveRideState {
  readonly orderId: string;
  readonly status: RideStatus;
  readonly service: string;
  readonly pickup: ActiveRidePoint;
  /** `null` جائزٌ: `orders.dropoff` عمودٌ يقبلُ العَدَمَ. */
  readonly dropoff: ActiveRidePoint | null;
  readonly createdAtMs: number;
  readonly matchedAtMs: number | null;
  readonly startedAtMs: number | null;
  /** ختمُ «وصلَ السائقُ» — `null` متى لم يُكتبْه السائقُ بعدُ (`F3-03`). */
  readonly arrivedAtMs: number | null;
  readonly completedAtMs: number | null;
  /** `null` = لا سائقَ مُسنَدٌ **أو** الحالةُ ليسَت من حالاتِ الإسنادِ. */
  readonly driver: ActiveRideDriver | null;
}

export type ActiveRideRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";

export type ActiveRideVerdict =
  | { readonly found: true; readonly state: ActiveRideState }
  | { readonly found: false; readonly refusal: ActiveRideRefusal };

export interface ActiveRideReader {
  read(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<ActiveRideVerdict, RideStoreFailure>>;
}
