/**
 * الغرض: نموذجُ عرضِ الاقتباسِ — دالّاتٌ نقيّةٌ تُحوِّلُ ردَّ الخادمِ إلى مفاتيحِ
 *   نصٍّ وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-04` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `QuoteScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-05` تعرضُ البطاقاتَ نفسَها قبلَ الإنشاءِ.
 *
 * ## لماذا `UNKNOWN` مفتاحٌ لا سقوطٌ
 *
 * رمزٌ جديدٌ من خادمٍ أحدثَ من هذا العميلِ **يقعُ** — والعميلُ في تلغرام لا
 * يُحدَّثُ لحظةَ نشرِ الخادمِ. فالمجهولُ يُعرَضُ نصّاً مهذَّباً عامّاً، ولا يُرمى
 * استثناءٌ يُبيِّضُ الشاشةَ، ولا يُعرَضُ الرمزُ الخامُ للمستخدمِ.
 *
 * ## ولماذا سببُ امتناعِ المدّةِ يُعرَضُ ولا يُوحَّدُ
 *
 * «لا محرِّكَ توجيهٍ مُهيَّأٌ» و«لا طريقَ بينَ الموضعَينِ» و«المحرِّكُ متوقّفٌ»
 * ثلاثةُ أجوبةٍ يَعقُبُها ثلاثةُ أفعالٍ مختلفةٍ من الراكبِ. وتوحيدُها في «غيرُ
 * متاحةٍ» يجعلُ الراكبَ يُعيدُ المحاولةَ أبداً في حالةٍ لن تتغيَّرَ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ سعراً ولا وسيلةَ دفعٍ ولا حقلاً مُعَدّاً لهما** (`ADR 0039` §٤
 *      · `م13-7`)، وحاجزُ `scripts/check-quote-contract.ts` يُنفِذُ ذاكَ آليّاً.
 *   ــ **لا يحسبُ مدّةً من مسافةٍ**: لا سرعةَ ثابتةً ولا معاملَ التفافٍ.
 *   ــ **لا يُخفي خدمةً غيرَ متاحةٍ**: يُعيدُ لها سببَها كي تُعرَضَ معطَّلةً.
 *   ــ **لا يُصيغُ نصّاً**: مفاتيحٌ وأعدادٌ، والنصُّ في `packages/shared/i18n`.
 */

import {
  describeDistance,
  type TaggedDistance,
} from "../../../../../../packages/domain/quote/distance-kind.ts";
import {
  isServiceKind,
  type ServiceKind,
} from "../../../../../../packages/domain/quote/service-offer.ts";
import type { ApiEtaVerdict, ApiServiceOffer, ApiTaggedDistance } from "./quote-contract.ts";

/** سطرُ المسافةِ: مفتاحٌ وقيمةٌ ووسمٌ. `null` لِما لا يُقاسُ — لا صفرٌ. */
export interface DistanceLine {
  readonly key: string;
  readonly value: number;
  readonly kindKey: string;
}

const DISTANCE_KIND_KEYS: Readonly<Record<string, string>> = {
  STRAIGHT_LINE: "rider.quote.distance.straightLine",
};

/**
 * سطرُ المسافةِ. الوسمُ يُترجَمُ مفتاحاً، ووسمٌ مجهولٌ يُسقِطُ السطرَ كلَّه
 * (`null`) ولا يُعرَضُ رقماً بلا وسمٍ: رقمٌ بلا وسمٍ هوَ عينُ ما مُنِعَ.
 */
export function distanceLine(distance: ApiTaggedDistance): DistanceLine | null {
  const kindKey = DISTANCE_KIND_KEYS[distance.kind];
  if (kindKey === undefined) return null;
  const described = describeDistance({
    kind: "STRAIGHT_LINE",
    meters: distance.meters,
  } as TaggedDistance);
  if (described === null) return null;
  return { key: described.key, value: described.value, kindKey };
}

const ETA_REASON_KEYS: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: "rider.quote.duration.notConfigured",
  PROVIDER_DOWN: "rider.quote.duration.providerDown",
  NO_ROUTE: "rider.quote.duration.noRoute",
  OFF_ROAD: "rider.quote.duration.offRoad",
  SNAP_UNKNOWN: "rider.quote.duration.snapUnknown",
  IMPLAUSIBLE: "rider.quote.duration.implausible",
  NO_INPUT: "rider.quote.duration.noInput",
};

/** سطرُ المدّةِ: دقائقُ مُوجَّهةٌ أو امتناعٌ بمفتاحِ سببٍ. */
export type DurationLine =
  | { readonly kind: "ROUTED"; readonly minutes: number }
  | { readonly kind: "UNAVAILABLE"; readonly reasonKey: string };

export function durationLine(eta: ApiEtaVerdict): DurationLine {
  if (eta.kind === "ROUTED") return { kind: "ROUTED", minutes: eta.minutes };
  return {
    kind: "UNAVAILABLE",
    reasonKey: ETA_REASON_KEYS[eta.reason] ?? "rider.quote.duration.unknown",
  };
}

export interface ServiceCardView {
  readonly service: ServiceKind;
  readonly labelKey: string;
  readonly available: boolean;
  /** `null` عندَ الإتاحةِ: لا سببَ لِما لا مانعَ له. */
  readonly reasonKey: string | null;
}

const SERVICE_UNAVAILABLE_KEYS: Readonly<Record<string, string>> = {
  NO_CAPABLE_DRIVER_IN_CITY: "rider.quote.service.noCapableDriver",
};

/**
 * بطاقاتُ الخدماتِ. خدمةٌ لا يعرفُها هذا العميلُ **تُطرَحُ** ولا تُعرَضُ برمزٍ
 * خامٍ: لا نصَّ لها في قواميسِه، وعرضُ `courier` حرفيّاً أسوأُ من عدمِ عرضِه.
 */
export function serviceCards(offers: readonly ApiServiceOffer[]): readonly ServiceCardView[] {
  const cards: ServiceCardView[] = [];
  for (const offer of offers) {
    if (!isServiceKind(offer.service)) continue;
    cards.push({
      service: offer.service,
      labelKey: `rider.quote.service.${offer.service}`,
      available: offer.available,
      reasonKey: offer.available
        ? null
        : (SERVICE_UNAVAILABLE_KEYS[offer.reason] ?? "rider.quote.service.unavailable"),
    });
  }
  return cards;
}

const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_POINT: "rider.quote.refused.invalidPoint",
  CITY_HAS_NO_SERVICE_AREA: "rider.quote.refused.noServiceArea",
  ORIGIN_OUTSIDE_SERVICE_AREA: "rider.quote.refused.originOutside",
  DESTINATION_OUTSIDE_SERVICE_AREA: "rider.quote.refused.destinationOutside",
};

export function quoteRefusalKey(code: string): string {
  return REFUSAL_KEYS[code] ?? "rider.quote.refused.unknown";
}

/**
 * هل يُعرَضُ للراكبِ فعلٌ يُصلِحُ به الرفضَ؟
 *
 * «انطلاقُك خارجَ الحدِّ» يُصلَحُ بإعادةِ قراءةِ الموقعِ، و«وجهتُك خارجَ الحدِّ»
 * يُصلَحُ باختيارِ وجهةٍ أخرى، و«مدينتُك بلا حدٍّ مرسومٍ» **لا يُصلِحُه الراكبُ
 * أبداً** — وزرُّ «أعِدِ المحاولةَ» فيه يُشغِلُ الناسَ بما لا يتغيَّرُ.
 */
export type RefusalRemedy = "RELOCATE" | "PICK_ANOTHER_DESTINATION" | "NONE";

export function refusalRemedy(code: string): RefusalRemedy {
  if (code === "ORIGIN_OUTSIDE_SERVICE_AREA" || code === "INVALID_POINT") return "RELOCATE";
  if (code === "DESTINATION_OUTSIDE_SERVICE_AREA") return "PICK_ANOTHER_DESTINATION";
  return "NONE";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.quote.error.session",
  SESSION_INVALID: "rider.quote.error.session",
  SESSION_EXPIRED: "rider.quote.error.session",
  SESSION_NOT_AVAILABLE: "rider.quote.error.unavailable",
  MALFORMED: "rider.quote.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.quote.error.account",
  QUOTE_STORE_NOT_AVAILABLE: "rider.quote.error.unavailable",
};

export function quoteErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.quote.error.unavailable";
}

/** وهل تُعادُ المحاولةُ؟ لا تُعادُ لِعطبِ عقدٍ ولا لِجلسةٍ ساقطةٍ. */
export function isRetryableQuoteError(code: string): boolean {
  return code === "SESSION_NOT_AVAILABLE" || code === "QUOTE_STORE_NOT_AVAILABLE";
}
