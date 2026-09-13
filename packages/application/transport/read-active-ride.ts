/**
 * الغرض: حالةُ استخدامِ قراءةِ الرحلةِ النشطةِ — طورٌ مُصنَّفٌ، وبطاقةُ سائقٍ
 *   متى جازَت، وموقعٌ **بحكمِ صلاحيّةٍ لا نقطةً عاريةً**، ومدّةُ وصولٍ من
 *   المُقدِّرِ القائمِ، وسياسةُ إلغاءٍ معروضةٌ (البند `F2-06` · `SR-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` (الإنهاءُ والتقييمُ) يقرأُ بهذا القارئِ
 *   نفسِه بعدَ `completed` ولا يكتبُ ثانياً.
 * ملاحظات مستقبلية: متى استُضيفَ محرِّكُ توجيهٍ (`ADR 0024`) عادَت المدّةُ
 *   `ROUTED` بلا تغييرِ حرفٍ ههنا — المسارُ مكتوبٌ والمزوِّدُ وحدَه غائبٌ.
 *
 * ## لماذا المدّةُ من `estimateArrival` ولا تُحسَبُ ههنا
 *
 * لأنَّها **مصدرُ حقيقةٍ واحدٌ** في المستودَعِ: بطاقةُ السائقِ في البوتِ
 * (`driver-trip-card.ts`) والاقتباسُ (`quote-ride.ts`) يسألانِه، فلو حُسِبَت
 * ههنا مرَّةً ثالثةً لَأمكنَ أن يرى الراكبُ رقماً والسائقُ رقماً آخرَ عن المسافةِ
 * نفسِها. **وبلا مزوِّدٍ مضبوطٍ تعودُ `NOT_CONFIGURED`** — امتناعٌ مُصنَّفٌ
 * يُعرَضُ نصّاً، لا صفرٌ ولا شَرطةٌ (`ADR 0024`).
 *
 * ## ولماذا تُطلَبُ المدّةُ من **موقعِ السائقِ الصالحِ** وحدَه
 *
 * مدّةُ وصولٍ محسوبةٌ من نقطةٍ عُمرُها خمسُ دقائقَ **كذبٌ مُضاعَفٌ**: رقمٌ يبدو
 * دقيقاً مبنيٌّ على موضعٍ لم يعُدْ صحيحاً. فإن حُجِبَ الموقعُ حُجِبَت المدّةُ
 * معَه بالسببِ نفسِه، ولا يُسأَلُ المحرِّكُ أصلاً — فلا نداءَ شبكةٍ لجوابٍ
 * سيُرمى.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تُنشِئُ ولا تُلغي**: تبعيّاتُها قارئٌ وجلسةٌ وساعةٌ — ومن قرأَ
 *      المُركِّبَ رأى أنَّ مسارَ `GET` لا يملكُ حقَّ كتابةٍ.
 *   ــ **لا تُنسِّقُ نصّاً ولا تُرجِمُ**: رموزٌ وأرقامٌ، والنصُّ في `i18n`.
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ** (`ADR 0039` §٤ ·
 *      `م13-7`)، ولا تُصدِرُ رمزَ مشاركةٍ (`F2-09`) ولا بلاغَ طوارئَ (`F2-10`).
 */

import type { EtaVerdict } from "../../domain/eta/index.ts";
import {
  type ActiveRidePhase,
  activeRidePhaseOf,
  type CancelPolicyCode,
  cancelPolicyOf,
  type DriverPositionVerdict,
  driverPositionVerdict,
} from "../../domain/transport/active-ride.ts";
import { elapsedSecondsSince } from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type EstimateArrivalDeps, estimateArrival } from "../tracking/estimate-arrival.ts";
import type { ActiveRideReader, ActiveRideRefusal, ActiveRideState } from "./active-ride-ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";

export interface ReadActiveRideDeps {
  readonly sessions: MiniAppSessionReader;
  readonly rides: ActiveRideReader;
  readonly now: () => Date;
  /** مزوِّدُ التوجيهِ — `null` قرارُ مشغِّلٍ مُعلَنٌ لا حقلٌ منسيٌّ. */
  readonly routing: EstimateArrivalDeps;
}

export interface ActiveRideView {
  readonly state: ActiveRideState;
  readonly phase: ActiveRidePhase;
  /** حكمُ نقطةِ السائقِ — `null` متى لا سائقَ أصلاً. */
  readonly position: DriverPositionVerdict | null;
  /**
   * مدّةُ وصولِ السائقِ إلى **نقطةِ الالتقاطِ** في طورِ الإسنادِ، وإلى
   * **الوجهةِ** في طورِ الرحلةِ. و`null` متى لا سؤالَ أصلاً (لا طورَ نشطٌ).
   */
  readonly eta: EtaVerdict | null;
  readonly cancelPolicy: CancelPolicyCode;
  readonly elapsedSeconds: number;
}

export type ReadActiveRideResult =
  | { readonly found: true; readonly view: ActiveRideView }
  | { readonly found: false; readonly refusal: ActiveRideRefusal };

export async function readActiveRide(
  deps: ReadActiveRideDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<ReadActiveRideResult, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  const read = await deps.rides.read({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));

  const verdict = read.value;
  if (!verdict.found) return ok({ found: false, refusal: verdict.refusal });

  const { state } = verdict;
  const phase = activeRidePhaseOf({ status: state.status, hasDriver: state.driver !== null });
  const position = state.driver === null ? null : driverPositionVerdict(state.driver.position);

  return ok({
    found: true,
    view: {
      state,
      phase,
      position,
      eta: await etaFor(deps, state, phase, position),
      cancelPolicy: cancelPolicyOf(phase),
      elapsedSeconds: elapsedSecondsSince(state.createdAtMs, deps.now().getTime()),
    },
  });
}

/**
 * المدّةُ لِما يقصدُه السائقُ **الآنَ**: نقطةُ الالتقاطِ قبلَ الرُّكوبِ، والوجهةُ
 * بعدَه. وهذا فرقٌ يراهُ الراكبُ: «يصلُكَ بعدَ ٤ دقائقَ» ثمَّ «تصلُ بعدَ ١٢».
 *
 * و`null` يُعادُ متى لا سؤالَ: طورٌ مُغلَقٌ، أو موقعٌ محجوبٌ، أو وجهةٌ معدومةٌ —
 * **ولا يُسألُ المحرِّكُ في أيٍّ من هذه**، فلا نداءَ شبكةٍ لجوابٍ سيُرمى.
 */
async function etaFor(
  deps: ReadActiveRideDeps,
  state: ActiveRideState,
  phase: ActiveRidePhase,
  position: DriverPositionVerdict | null,
): Promise<EtaVerdict | null> {
  if (phase !== "driver_assigned" && phase !== "on_trip") return null;
  if (position === null || !position.show) return null;

  const target = phase === "driver_assigned" ? state.pickup : state.dropoff;
  if (target === null) return null;

  return await estimateArrival(
    {
      from: { latitude: position.position.lat, longitude: position.position.lng },
      to: { latitude: target.lat, longitude: target.lng },
    },
    deps.routing,
  );
}
