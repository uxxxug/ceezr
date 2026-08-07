/**
 * الغرض: قواعد دورة السائقين غير المشتركين — متى تُدوَّر المطالبة، ومتى يُعاد النشر، ومتى يُصعَّد.
 *   القرار كلّه هنا نقيّاً بلا قاعدة بيانات ولا تيليجرام: العامل ينفّذ ما يُملى عليه فقط.
 * الحالة: منفّذ فعلياً — المرحلة 2.3 (القسم 3.4 من الأمر الحاكم).
 * ينتمي إلى: domain/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 * ملاحظات مستقبلية: لا رقم هنا — عدد المقاعد والمهل ودورات الإعادة كلها تصل كمعاملات من platform_settings.
 */

import type { CityId, DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Coordinates } from "../geo/value-objects.ts";

/** حالة الدورة كما هي في القاعدة، حرفياً بلا ترجمة. */
export type NegotiationStatus = "collecting" | "negotiating" | "agreed" | "exhausted" | "cancelled";

/** مصير ضغطة زرّ واحدة. */
export type ClaimOutcome =
  | "waiting"
  | "negotiating"
  | "declined"
  | "expired"
  | "agreed"
  | "cancelled";

/** لقطة دورة واحدة كما يقرؤها العامل. */
export interface NegotiationSnapshot {
  readonly negotiationId: string;
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly cycle: number;
  readonly status: NegotiationStatus;
  readonly activeClaimId: string | null;
  readonly activeDriverId: DriverId | null;
  readonly collectDeadline: Date;
  readonly negotiateDeadline: Date | null;
}

/**
 * ما ينبغي فعله بهذه الدورة الآن:
 *  - advance: انتهت مهلة تفاوض السائق النشط بلا اتفاق صريح -> يُغلق ويُفتح مع الذي يليه
 *  - republish: الدورة ماتت (لا أحد ضغط، أو نفد الثلاثة) وما زال في الرصيد دورة أخرى
 *  - escalate: نفدت الدورات كلها -> قروب الإسناد
 *  - wait: لم يحن شيء بعد
 */
export type RotationAction =
  | { readonly kind: "advance"; readonly reason: "expired" }
  | { readonly kind: "republish"; readonly nextCycle: number }
  | { readonly kind: "escalate"; readonly reason: "unsubscribed_cycles_exhausted" }
  | { readonly kind: "wait" };

export interface RotationDecision {
  readonly negotiationId: string;
  readonly orderId: OrderId;
  readonly action: RotationAction;
}

/**
 * القرار لدورة واحدة. maxCycles يأتي من platform_settings ولا يُفترض هنا.
 *
 * ترتيب الفحص مقصود: التفاوض الجاري أسبق من نافذة الجمع، لأن أول ضغطة تفتح التفاوض
 * فوراً بينما نافذة الجمع تظلّ مفتوحة لبقية المقاعد — فوجود مهلة تفاوض منتهية
 * هو الحدث الحقيقي حتى لو كانت نافذة الجمع لم تنتهِ بعد.
 */
export function decideRotation(
  snapshot: NegotiationSnapshot,
  maxCycles: number,
  now: Date,
): RotationDecision {
  const base = { negotiationId: snapshot.negotiationId, orderId: snapshot.orderId };
  const exhaustedTail: RotationAction =
    snapshot.cycle >= maxCycles
      ? { kind: "escalate", reason: "unsubscribed_cycles_exhausted" }
      : { kind: "republish", nextCycle: snapshot.cycle + 1 };

  if (snapshot.status === "negotiating") {
    if (
      snapshot.negotiateDeadline !== null &&
      snapshot.negotiateDeadline.getTime() <= now.getTime()
    ) {
      return { ...base, action: { kind: "advance", reason: "expired" } };
    }
    return { ...base, action: { kind: "wait" } };
  }

  if (snapshot.status === "collecting") {
    // «collecting» تعني صفر ضغطات: أول ضغطة تحوّلها إلى negotiating فوراً.
    if (snapshot.collectDeadline.getTime() <= now.getTime()) {
      return { ...base, action: exhaustedTail };
    }
    return { ...base, action: { kind: "wait" } };
  }

  if (snapshot.status === "exhausted") {
    return { ...base, action: exhaustedTail };
  }

  // agreed / cancelled: انتهى أمرها، لا يمسّها العامل.
  return { ...base, action: { kind: "wait" } };
}

/**
 * هل ما زال في الدورة مقعد شاغر؟ يُستعمل لإخفاء الزرّ عن سائق لن يُقبل تسجيله،
 * فلا يُحبَط بضغطة تُرفض. الرفض النهائي يبقى في RPC لأن السباق لا يُحسم في العميل.
 */
export function hasFreeSlot(claimsTaken: number, slots: number): boolean {
  return claimsTaken < slots;
}

/**
 * السائق مؤهَّل للتسجيل في هذه الدورة إن لم يكن سجّل فيها، ولم يكن من سائقي الدورة
 * المباشرة السابقة (الخطوة 5 من القسم 3.4: منع تكرار الثلاثة أنفسهم مباشرةً).
 */
export function isEligibleToClaim(
  driverId: DriverId,
  claimedInThisCycle: readonly DriverId[],
  claimedInPreviousCycle: readonly DriverId[],
): boolean {
  return !claimedInThisCycle.includes(driverId) && !claimedInPreviousCycle.includes(driverId);
}

/**
 * دقّة إخفاء الموقع في بطاقة القروب: منزلتان عشريتان ≈ 1.1 كم.
 * قيد خصوصية تقني لا قرار تجاري: بطاقة القروب تُنشر لعشرات لم يُسنَد إليهم الطلب بعد،
 * فلا يُكشف لهم باب بيت العميل. الموقع الدقيق يصل للسائق المُسنَد وحده.
 */
const AREA_DECIMALS = 2;

/** منطقة تقريبية صالحة للنشر العلني — لا عنوان دقيق ولا رقم هاتف. */
export function approximateArea(point: Coordinates): string {
  const lat = point.latitude.toFixed(AREA_DECIMALS);
  const lng = point.longitude.toFixed(AREA_DECIMALS);
  return `${lat}, ${lng}`;
}

/**
 * أقصر تسلسل أرقام يُعامَل كرقم هاتف. الأرقام السعودية عشرة خانات (05xxxxxxxx)
 * وبالمقدّمة الدولية اثنتا عشرة؛ فتسع خانات حدّ آمن يمرّر الأسعار والعناوين ويحجز الأرقام.
 * حدّ تقني للخصوصية، لا قيمة تجارية.
 */
const PHONE_DIGIT_THRESHOLD = 9;

const PHONE_LIKE = new RegExp(`[+\\d][\\d\\s\\-()]{${PHONE_DIGIT_THRESHOLD - 1},}`, "g");

/**
 * يحجب ما يشبه رقم هاتف داخل رسالة مُمرَّرة. قناة التمرير تمنع كشف الأرقام من النظام،
 * وهذه تمنع كشفها من الطرفين أنفسهما داخل القناة — وهو ما يلتفّ على الشرط لولاها.
 * تعيد النصّ ومعه عدد ما حُجب، فيعرف المتصل أن يُنبّه المرسِل.
 */
export function redactPhoneNumbers(text: string): {
  readonly text: string;
  readonly redacted: number;
} {
  let redacted = 0;
  const cleaned = text.replace(PHONE_LIKE, (match) => {
    const digits = match.replace(/\D/g, "").length;
    if (digits < PHONE_DIGIT_THRESHOLD) return match;
    redacted += 1;
    return "▒▒▒▒";
  });
  return { text: cleaned, redacted };
}
