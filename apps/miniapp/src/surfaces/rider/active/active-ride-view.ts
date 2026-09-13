/**
 * الغرض: نموذجُ عرضِ الرحلةِ النشطةِ — دالّاتٌ نقيّةٌ تُحوِّلُ اللقطةَ إلى مفاتيحِ
 *   نصٍّ وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-06` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `ActiveRideScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` تُعيدُ استعمالَ `activePhaseKey` ولا تكتبُ
 *   جدولَ أطوارٍ ثانياً.
 *
 * ## لماذا يُعادُ استعمالُ `rideStatusKey` و`elapsedText` حرفاً
 *
 * حالةُ الرحلةِ ومدّتُها مقولتانِ **واحدتانِ** في شاشتَينِ. ولو نُسِخَ جدولُ
 * الحالاتِ ههنا لَاختلفَ النصّانِ عندَ أوّلِ تعديلٍ، فيرى الراكبُ «يُبحَثُ» في
 * شاشةٍ و«قيدَ البحثِ» في أُخرى للرحلةِ نفسِها. فمصدرُ الحقيقةِ واحدٌ
 * (`search-view.ts`) ويُستوردُ لا يُستنسَخُ.
 *
 * ## ولماذا لا يُرسَمُ موقعٌ بلا عُمرِه
 *
 * `BUG-001`: كتاباتُ `drivers.last_location` غيرُ مرتَّبةٍ، فالإحداثيّةُ قد
 * تكونُ أقدمَ من ظنِّ قارئِها. فالعُمرُ **جزءٌ من المعلومةِ** لا حاشيةٌ: نقطةٌ
 * عُمرُها ثلاثٌ وثمانونَ ثانيةً تُقالُ كذلكَ، ونقطةٌ حُجِبَت يُقالُ سببُ حجبِها.
 *
 * ## ولماذا المدّةُ المتوقَّعةُ حكمٌ مُصنَّفٌ لا رقمٌ أو شَرطةٌ
 *
 * «لا مزوِّدَ توجيهٍ» و«لا طريقَ» و«المحرِّكُ ساقطٌ» ثلاثةُ أخبارٍ مختلفةٍ،
 * وشَرطةٌ واحدةٌ تُساويها كلَّها فتُفقَدُ المعلومةُ. ولا يُعرَضُ صفرُ دقائقٍ أبداً:
 * صفرٌ يُقرأُ «وصلَ» (`ADR 0024`).
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ سعراً ولا عقوبةَ إلغاءٍ**: `cancelPolicy` رمزٌ يُترجَمُ نصّاً
 *      إجرائيّاً بلا مالٍ (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يخترعُ طَوراً**: ما لا يُعرَفُ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً.
 *   ــ **لا يُصيغُ نصّاً**: النصُّ في `packages/shared/i18n` وحدَه.
 */

import { DRIVER_POSITION_MAX_AGE_SECONDS } from "../../../../../../packages/domain/transport/active-ride.ts";
import {
  elapsedSecondsFor,
  elapsedText,
  isRetryableRideError,
  rideStatusKey,
} from "../search/search-view.ts";

/** يُعادُ نشرُها من `search-view.ts` كي تُستوردَ الشاشةُ من بابٍ واحدٍ ولا تُنسَخَ. */
export { elapsedSecondsFor, elapsedText, isRetryableRideError, rideStatusKey };

const PHASE_KEYS: Readonly<Record<string, string>> = {
  searching: "rider.active.phase.searching",
  driver_assigned: "rider.active.phase.driverAssigned",
  on_trip: "rider.active.phase.onTrip",
  completed: "rider.active.phase.completed",
  closed: "rider.active.phase.closed",
};

/** الطَّورُ ⇒ مفتاحُ نصٍّ. وما لا يُعرَفُ يُقالُ عامّاً لا خاماً. */
export function activePhaseKey(phase: string): string {
  return PHASE_KEYS[phase] ?? "rider.active.phase.unknown";
}

/**
 * سطرُ الموقعِ — اتّحادٌ بحكمٍ: إمّا نقطةٌ **معَ عُمرِها**، وإمّا حجبٌ بسببِه.
 * ولا ثالثَ: لا نقطةَ بلا عُمرٍ، ولا حجبَ بلا سببٍ.
 */
export type PositionLine =
  | {
      readonly show: true;
      readonly lat: number;
      readonly lng: number;
      readonly ageKey: string;
      readonly ageSeconds: number;
      readonly ageMinutes: number;
    }
  | { readonly show: false; readonly key: string };

const POSITION_HIDDEN_KEYS: Readonly<Record<string, string>> = {
  NEVER_REPORTED: "rider.active.position.neverReported",
  NO_TIMESTAMP: "rider.active.position.noTimestamp",
  TOO_OLD: "rider.active.position.tooOld",
};

export function positionLine(
  position:
    | {
        readonly show: true;
        readonly lat: number;
        readonly lng: number;
        readonly ageSeconds: number;
      }
    | { readonly show: false; readonly reason: string }
    | null,
): PositionLine | null {
  if (position === null) return null;
  if (!position.show) {
    return {
      show: false,
      key: POSITION_HIDDEN_KEYS[position.reason] ?? "rider.active.position.unknown",
    };
  }
  const age = ageOf(position.ageSeconds);
  return {
    show: true,
    lat: position.lat,
    lng: position.lng,
    ageKey:
      age.minutes === 0 ? "rider.active.position.ageSeconds" : "rider.active.position.ageMinutes",
    ageSeconds: age.seconds,
    ageMinutes: age.minutes,
  };
}

function ageOf(seconds: number): { readonly minutes: number; readonly seconds: number } {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds) : 0;
  return { minutes: Math.trunc(safe / 60), seconds: safe % 60 };
}

/**
 * وهل تُعَدُّ القراءةُ طازجةً؟ الحدُّ من النطاقِ لا من رقمٍ مكتوبٍ ههنا، كي لا
 * يتباعدَ حكمُ الخادمِ عن حكمِ الشاشةِ عندَ تعديلِ الحدِّ.
 */
export function isFreshPosition(ageSeconds: number): boolean {
  return (
    Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= DRIVER_POSITION_MAX_AGE_SECONDS
  );
}

/** سطرُ المدّةِ المتوقَّعةِ — دقائقُ بمصدرِها، أو امتناعٌ بسببِه. */
export type EtaLine =
  | { readonly kind: "ROUTED"; readonly key: string; readonly minutes: number }
  | { readonly kind: "UNAVAILABLE"; readonly key: string };

const ETA_REASON_KEYS: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: "rider.active.eta.notConfigured",
  PROVIDER_DOWN: "rider.active.eta.providerDown",
  NO_ROUTE: "rider.active.eta.noRoute",
  OFF_ROAD: "rider.active.eta.offRoad",
  SNAP_UNKNOWN: "rider.active.eta.snapUnknown",
  IMPLAUSIBLE: "rider.active.eta.implausible",
  NO_INPUT: "rider.active.eta.noInput",
};

export function etaLine(
  eta:
    | { readonly kind: "ROUTED"; readonly minutes: number }
    | { readonly kind: "UNAVAILABLE"; readonly reason: string }
    | null,
): EtaLine | null {
  if (eta === null) return null;
  if (eta.kind === "UNAVAILABLE") {
    return { kind: "UNAVAILABLE", key: ETA_REASON_KEYS[eta.reason] ?? "rider.active.eta.unknown" };
  }
  // صفرٌ يُقرأُ «وصلَ»: أقلُّ ما يُعرَضُ دقيقةٌ واحدةٌ (`ADR 0024`).
  const minutes = Number.isFinite(eta.minutes) && eta.minutes >= 1 ? Math.trunc(eta.minutes) : 1;
  return { kind: "ROUTED", key: "rider.active.eta.minutes", minutes };
}

const CANCEL_POLICY_KEYS: Readonly<Record<string, string>> = {
  FREE_BEFORE_ASSIGNMENT: "rider.active.cancel.beforeAssignment",
  AFTER_ASSIGNMENT_UNDECIDED: "rider.active.cancel.afterAssignment",
  NOT_CANCELLABLE: "rider.active.cancel.notCancellable",
};

/**
 * سياسةُ الإلغاءِ **نصٌّ إجرائيٌّ**: «يُلغى الآنَ» أو «الإلغاءُ بعدَ الإسنادِ لم
 * تُقرَّرْ قواعدُه» أو «لا يُلغى». ولا مالَ ولا نسبةَ ولا كلمةَ «رسمٍ» —
 * `ADR 0039` §٤ يُجمِّدُ ذلكَ حتّى `DEC-11`.
 */
export function cancelPolicyKey(code: string): string {
  return CANCEL_POLICY_KEYS[code] ?? "rider.active.cancel.unknown";
}

/** وهل يُرسَمُ زرُّ الإلغاءِ؟ للحرِّ وحدَه: زرٌّ يُرفَضُ حتماً أسوأُ من غيابِه. */
export function showsCancelButton(code: string): boolean {
  return code === "FREE_BEFORE_ASSIGNMENT";
}

const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_ORDER_ID: "rider.active.read.invalidId",
  ORDER_NOT_FOUND: "rider.active.read.notFound",
};

export function activeRefusalKey(code: string): string {
  return REFUSAL_KEYS[code] ?? "rider.active.read.unknown";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.active.error.session",
  SESSION_INVALID: "rider.active.error.session",
  SESSION_EXPIRED: "rider.active.error.session",
  SESSION_NOT_AVAILABLE: "rider.active.error.unavailable",
  MALFORMED: "rider.active.error.malformed",
  INVALID_JSON: "rider.active.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.active.error.account",
  RIDER_NOT_REGISTERED: "rider.active.error.notRegistered",
  RIDE_STORE_NOT_AVAILABLE: "rider.active.error.unavailable",
};

export function activeErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.active.error.unavailable";
}

/** هويّةُ السائقِ سطراً: ما عرفَته القاعدةُ يُقالُ، وما لم تعرفْه يُقالُ مجهولاً. */
export interface DriverIdentityLine {
  readonly nameKey: string;
  readonly name: string;
  readonly vehicleKey: string;
  readonly vehicle: string;
  readonly plateKey: string;
  readonly plate: string;
  readonly ratingKey: string;
  readonly ratingAverage: number;
  readonly ratingCount: number;
}

export function driverIdentityLine(driver: {
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}): DriverIdentityLine {
  const name = driver.firstName ?? "";
  const vehicle = driver.vehicleType ?? "";
  const plate = driver.plateNumber ?? "";
  return {
    nameKey: name.length === 0 ? "rider.active.driver.nameUnknown" : "rider.active.driver.name",
    name,
    vehicleKey:
      vehicle.length === 0 ? "rider.active.driver.vehicleUnknown" : "rider.active.driver.vehicle",
    vehicle,
    plateKey: plate.length === 0 ? "rider.active.driver.plateUnknown" : "rider.active.driver.plate",
    plate,
    // لا تقييمَ بعدُ ⇒ نصٌّ صريحٌ، ولا يُعرَضُ صفرٌ ولا خمسةٌ افتراضاً.
    ratingKey:
      driver.ratingAverage === null || driver.ratingCount <= 0
        ? "rider.active.driver.ratingNone"
        : "rider.active.driver.rating",
    ratingAverage: driver.ratingAverage ?? 0,
    ratingCount:
      Number.isFinite(driver.ratingCount) && driver.ratingCount > 0 ? driver.ratingCount : 0,
  };
}
