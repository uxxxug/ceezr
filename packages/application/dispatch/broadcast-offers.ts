/**
 * الغرض: الحلقة المفقودة بين "من يستحق الطلب" و"من عَلِم به": تأخذ قرار matchOrder،
 *   تكتب العروض فعلاً في order_offers بمهلة المدينة، ثم تُخطر كل سائق في الدفعة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر على قاعدة حقيقية في tests/integration.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل (عند إنشاء الطلب)، apps/workers (الدورات التالية)
 * ملاحظات مستقبلية: فشل إخطار سائق واحد لا يُلغي الدورة؛ يُسجَّل ويُستكمل الباقون.
 */

import type { DistanceKm } from "../../domain/geo/value-objects.ts";
import type { CityId, DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import { type MatchOrderDependencies, type MatchOrderError, matchOrder } from "./match-order.ts";

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

export interface OfferWriter {
  openRound(input: OpenRoundInput): Promise<Result<void, PortFailureError>>;
}

export interface OfferNotification {
  readonly orderId: OrderId;
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

  const notified: DriverId[] = [];
  const unreachable: DriverId[] = [];
  for (const entry of entries) {
    const sent = await deps.notifier.notifyOffer({
      orderId: decision.orderId,
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
    offered: entries.map((entry) => entry.driverId),
    notified,
    unreachable,
    expiresAt,
  });
}
