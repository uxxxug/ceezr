/**
 * الغرض: الحلقة المفقودة بين "من يستحق الطلب" و"من عَلِم به": تأخذ قرار matchOrder،
 *   تكتب العروض فعلاً في order_offers بمهلة المدينة، ثم تُخطر كل سائق في الدفعة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر على قاعدة حقيقية في tests/integration.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل (عند إنشاء الطلب)، apps/workers (الدورات التالية)
 * ملاحظات مستقبلية: فشل إخطار سائق واحد لا يُلغي الدورة؛ يُسجَّل ويُستكمل الباقون.
 */

import type { DistanceKm } from "../../domain/geo/value-objects.ts";
import type { Order } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OfferId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import {
  type MatchOrderDependencies,
  type MatchOrderError,
  matchOrder,
  OrderNotFoundError,
  OrderNotSearchingError,
  RoundAlreadyOpenedError,
} from "./match-order.ts";

export interface OfferEntry {
  readonly driverId: DriverId;
  readonly score: number;
  readonly distanceKm: DistanceKm;
}

export interface OpenRoundInput {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly round: number;
  readonly entries: readonly OfferEntry[];
  readonly expiresAt: Date;
}

/**
 * سببُ رفضِ القاعدةِ فتحَ الدورةِ. ثلاثةٌ لا يُجزئُ أحدُها عن الآخرِ:
 * طلبٌ ذهبَ، وطلبٌ لم يعُد يبحثُ، ودورةٌ سبقَ إليها غيرُنا.
 */
export type OpenRoundRefusal = "ORDER_NOT_FOUND" | "ORDER_NOT_SEARCHING" | "ROUND_ALREADY_OPENED";

/**
 * نتيجةُ فتحِ الدورةِ كما حسمَتْها القاعدةُ. وإنّما صارتْ قيمةً بعدَ أن كانتْ
 * `void` لأنَّ المنفذَ صارَ يُقرّرُ لا يُنفّذُ: من لا يَروي قرارَه لا يملكُ المتّصلُ
 * به إلّا أن يفترضَ النجاحَ.
 */
/**
 * عرضٌ واحدٌ أُدرجَ في الدورةِ، يُميَّزُ بمعرّفِه لا بالاسمِ `(order_id, driver_id)`.
 * الاسمُ لا يُفرّقُ بينَ جولتَينِ للسائقِ نفسِه على الطلبِ نفسِه، فكان الرفضُ يُصيبُ
 * كليهما بضغطةٍ واحدةٍ (`BUG-003`). والمعرّفُ هو ما يحصرُ القرارَ بعرضٍ بعينِه.
 */
export interface InsertedOffer {
  readonly offerId: OfferId;
  readonly driverId: DriverId;
}

export type OpenRoundOutcome =
  | {
      readonly opened: true;
      readonly offersInserted: number;
      readonly offers: readonly InsertedOffer[];
    }
  | { readonly opened: false; readonly refusal: "ORDER_NOT_FOUND" | "ROUND_ALREADY_OPENED" }
  /** الحالُ يُرافقُ هذا الرفضَ وحدَه، لأنَّه وحدَه الذي له حالٌ يُخبِرُ عن شيءٍ. */
  | {
      readonly opened: false;
      readonly refusal: "ORDER_NOT_SEARCHING";
      readonly status: Order["status"];
    };

export interface OfferWriter {
  openRound(input: OpenRoundInput): Promise<Result<OpenRoundOutcome, PortFailureError>>;
}

export interface OfferNotification {
  readonly orderId: OrderId;
  /**
   * عرضٌ واحدٌ بعينِه: الزرُّ الذي يُبنى من هذا الإشعارِ يحمِلُ `offerId` لا
   * `orderId`، فيَنصَبُّ الرفضُ على عرضٍ واحدٍ لا على كلِّ عرضٍ معلَّقٍ للسائقِ
   * (`BUG-003`).
   */
  readonly offerId: OfferId;
  readonly driverId: DriverId;
  readonly distanceKm: DistanceKm;
  readonly expiresInSeconds: number;
}

/**
 * إخطار السائق بأن الطلب أُلغي. كان الإلغاء قبل هذا صامتاً تماماً في جهة السائق:
 * تبقى بطاقة العرض في محادثته تدعوه إلى قبول طلب لم يعد قائماً، ويبقى السائق
 * المُسنَد سائراً إلى موعد أُلغي. الصمت هنا ليس نقص ميزة بل معلومة كاذبة.
 */
export interface CancellationNotice {
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  /** المُسنَد يُخاطَب بغير ما يُخاطَب به صاحب عرض معلّق: أحدهما كان في طريقه. */
  readonly wasAssigned: boolean;
}

export interface DriverNotifier {
  /** يعيد false إن تعذّر الوصول للسائق — ولا يرمي، فالبثّ يستمر لبقية الدفعة. */
  notifyOffer(notification: OfferNotification): Promise<Result<boolean, PortFailureError>>;
  /** يعيد false إن تعذّر الوصول — الإلغاء نفسه تمّ، والإخطار لا يُبطله. */
  notifyCancelled(notice: CancellationNotice): Promise<Result<boolean, PortFailureError>>;
}

export interface BroadcastDependencies extends MatchOrderDependencies {
  readonly offerWriter: OfferWriter;
  readonly notifier: DriverNotifier;
  /**
   * اختياري فلا يكسر منادياً، ولكنّ غيابه كان علّة حقيقية: عند انعدام المؤهلين
   * تُرجع `NoEligibleDriverError` ومعها أسباب الرفض كاملة، ومنادي بوت العميل
   * يُسقط الخطأ بـ`if (!broadcast.ok) return replies` فتضيع الأسباب إلى غير رجعة.
   * فكان السؤال «لماذا لا تصل الطلبات السائقين؟» بلا جواب في النظام كلّه.
   */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface BroadcastResult {
  readonly orderId: OrderId;
  readonly round: number;
  readonly offered: readonly DriverId[];
  readonly notified: readonly DriverId[];
  readonly unreachable: readonly DriverId[];
  readonly expiresAt: Date;
}

const MS_PER_SECOND = 1000;

/**
 * يُخرج أسباب الرفض معدودة بدل أن تموت داخل الخطأ.
 * التعداد لا القائمة الكاملة: مدينة بمائة سائق تملأ السجلّ بلا فائدة،
 * والمشغّل يحتاج أن يعرف «أربعة بلا موقع» لا معرّفاتهم الأربعة.
 * المعرّفات تُرى في لوحة الإدارة، والسجلّ للإنذار لا للجرد.
 */
function logIneligibility(
  orderId: OrderId,
  error: MatchOrderError,
  log?: (message: string, meta: Record<string, unknown>) => void,
): void {
  if (log === undefined || error.code !== "NO_ELIGIBLE_DRIVER") return;
  const tally: Record<string, number> = {};
  for (const entry of error.evaluation.rejected) {
    tally[entry.reason] = (tally[entry.reason] ?? 0) + 1;
  }
  log("dispatch.no_eligible_driver", {
    orderId,
    candidatesSeen: error.evaluation.rejected.length,
    reasons: tally,
  });
}

export async function broadcastOffers(
  input: { readonly orderId: OrderId },
  deps: BroadcastDependencies,
): Promise<Result<BroadcastResult, MatchOrderError>> {
  const matched = await matchOrder(input, deps);
  if (!matched.ok) {
    logIneligibility(input.orderId, matched.error, deps.log);
    return matched;
  }
  const decision = matched.value;

  const expiresAt = new Date(
    deps.clock.now().getTime() + decision.offerTimeoutSeconds * MS_PER_SECOND,
  );
  const entries: readonly OfferEntry[] = decision.batch.map((candidate) => ({
    driverId: candidate.driverId,
    score: candidate.score,
    distanceKm: candidate.distanceKm,
  }));

  const written = await deps.offerWriter.openRound({
    orderId: decision.orderId,
    cityId: decision.cityId,
    round: decision.round,
    entries,
    expiresAt,
  });
  if (!written.ok) return written;

  /**
   * القاعدةُ هي التي حسمَت، لا نحن. وثلاثةُ الرفضِ تُترجَم إلى ثلاثةِ أخطاءٍ لا
   * إلى واحدٍ: من قرأ الطلبَ باحثاً ثمَّ وجدَه مُسنَداً حالُه غيرُ حالِ من وجدَ
   * دورتَه قد فُتحَت قبلَه بلحظةٍ — والمتّصلُ يتصرَّفُ باختلافِهما.
   */
  if (!written.value.opened) {
    const outcome = written.value;
    if (outcome.refusal === "ORDER_NOT_FOUND") return err(new OrderNotFoundError(decision.orderId));
    if (outcome.refusal === "ORDER_NOT_SEARCHING") {
      return err(new OrderNotSearchingError(decision.orderId, outcome.status));
    }
    return err(new RoundAlreadyOpenedError(decision.orderId, decision.round));
  }

  const notified: DriverId[] = [];
  const unreachable: DriverId[] = [];
  /**
   * العرضُ الذي يُخطرُ به السائقَ هو الذي أُدرجَ فعلاً في القاعدةِ، لا الذي
   * طُلبَ إدراجُه. و`offer_ids` يَصدُرُ من الإدراجِ نفسِه فيُحصرُ الإخطارُ بالعروضِ
   * القائمةِ فقط — فلا يُقالُ لسائقٍ «عُرِضَ عليك» بلا عرضٍ في القاعدةِ، ولا
   * يُبنى زرُّ رفضٍ لعرضٍ لم يُخلَق (`BUG-003`).
   */
  const insertedByDriver = new Map<DriverId, OfferId>();
  for (const offer of written.value.offers) {
    insertedByDriver.set(offer.driverId, offer.offerId);
  }
  for (const entry of entries) {
    const offerId = insertedByDriver.get(entry.driverId);
    if (offerId === undefined) {
      /**
       * لم يُدرَج عرضٌ لهذا السائقِ (تعارضٌ على القيدِ الفريدِّ مثلًا)، فلا إخطارَ
       * ولا زرَّ رفضٍ بلا عرضٍ وراءَه. السائقُ لا يُعدُّ معروضاً عليه ولا غيرَ معلوم.
       */
      unreachable.push(entry.driverId);
      continue;
    }
    const sent = await deps.notifier.notifyOffer({
      orderId: decision.orderId,
      offerId,
      driverId: entry.driverId,
      distanceKm: entry.distanceKm,
      expiresInSeconds: decision.offerTimeoutSeconds,
    });
    if (sent.ok && sent.value) notified.push(entry.driverId);
    else unreachable.push(entry.driverId);
  }

  return ok({
    orderId: decision.orderId,
    round: decision.round,
    offered: written.value.offers.map((offer) => offer.driverId),
    notified,
    unreachable,
    expiresAt,
  });
}
