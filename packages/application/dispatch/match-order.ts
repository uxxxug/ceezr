/**
 * الغرض: حالة الاستخدام الجوهرية — من يستقبل هذا الطلب الآن؟
 *   تجمع الإعدادات والمرشحين والعروض السابقة، ثم تسلّم القرار لمنطق الدومين، ولا تقرّر بنفسها شيئاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (القسم 3.3).
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers (دورة البثّ)، apps/gateway
 * ملاحظات مستقبلية: البثّ الفعلي إلى تلغرام والكتابة في order_offers خطوة تالية تحتاج مفاتيح،
 *   ولذلك تعيد هذه الدالة الدفعة المقرَّرة ولا ترسل شيئاً.
 */

import type { CityId, Clock, OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  evaluateCandidates,
  selectBroadcastBatch,
  type CandidateEvaluation,
  type ScoredCandidate,
} from "../../domain/dispatch/entity.ts";
import { driversToExclude } from "../../domain/dispatch/value-objects.ts";
import {
  parseCitySettings,
  toMatchingParameters,
  type CitySettings,
  type SettingsError,
} from "../../domain/policy/entity.ts";
import { hasExhaustedBroadcastRounds, type Order } from "../../domain/transport/entity.ts";
import type {
  DriverCandidateRepository,
  OfferRepository,
  OrderRepository,
  PortFailureError,
  SettingsRepository,
} from "../ports/index.ts";

export class OrderNotFoundError {
  readonly code = "ORDER_NOT_FOUND" as const;
  constructor(readonly orderId: OrderId) {}
}

export class OrderNotSearchingError {
  readonly code = "ORDER_NOT_SEARCHING" as const;
  constructor(
    readonly orderId: OrderId,
    readonly status: Order["status"],
  ) {}
}

export class BroadcastRoundsExhaustedError {
  readonly code = "BROADCAST_ROUNDS_EXHAUSTED" as const;
  constructor(
    readonly orderId: OrderId,
    readonly maxRounds: number,
  ) {}
}

export class NoEligibleDriverError {
  readonly code = "NO_ELIGIBLE_DRIVER" as const;
  constructor(
    readonly orderId: OrderId,
    readonly evaluation: CandidateEvaluation,
  ) {}
}

export type MatchOrderError =
  | OrderNotFoundError
  | OrderNotSearchingError
  | BroadcastRoundsExhaustedError
  | NoEligibleDriverError
  | SettingsError
  | PortFailureError;

export interface MatchOrderDependencies {
  readonly orders: OrderRepository;
  readonly offers: OfferRepository;
  readonly candidates: DriverCandidateRepository;
  readonly settings: SettingsRepository;
  readonly clock: Clock;
}

export interface MatchOrderResult {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  /** الدورة التي ستُبثّ الآن (دورة الطلب الحالية + 1). */
  readonly round: number;
  readonly batch: readonly ScoredCandidate[];
  readonly evaluation: CandidateEvaluation;
  readonly offerTimeoutSeconds: number;
  readonly settings: CitySettings;
}

/**
 * تعيد الدفعة التي يجب بثّها، أو سبباً واضحاً لعدم البثّ.
 * لا تكتب في القاعدة ولا ترسل رسالة — القرار فقط، ليبقى قابلاً للاختبار بلا أي مفتاح.
 */
export async function matchOrder(
  input: { readonly orderId: OrderId },
  deps: MatchOrderDependencies,
): Promise<Result<MatchOrderResult, MatchOrderError>> {
  const orderResult = await deps.orders.findById(input.orderId);
  if (!orderResult.ok) return orderResult;
  const order = orderResult.value;
  if (order === null) return err(new OrderNotFoundError(input.orderId));

  if (order.status !== "searching") {
    return err(new OrderNotSearchingError(order.id, order.status));
  }

  const rawSettings = await deps.settings.findByCity(order.cityId);
  if (!rawSettings.ok) return rawSettings;

  const parsed = parseCitySettings(order.cityId, rawSettings.value);
  if (!parsed.ok) return parsed;
  const settings = parsed.value;

  if (hasExhaustedBroadcastRounds(order, settings.maxBroadcastRounds)) {
    return err(new BroadcastRoundsExhaustedError(order.id, settings.maxBroadcastRounds));
  }

  const offersResult = await deps.offers.findByOrder(order.id);
  if (!offersResult.ok) return offersResult;

  const candidatesResult = await deps.candidates.findAvailableInCity(order.cityId);
  if (!candidatesResult.ok) return candidatesResult;

  const now = deps.clock.now();
  const excludedDriverIds = driversToExclude(
    offersResult.value,
    settings.offerTimeoutSeconds,
    now,
  );

  const matchingParameters = toMatchingParameters(settings);
  const evaluation = evaluateCandidates(
    candidatesResult.value,
    {
      cityId: order.cityId,
      service: order.service,
      pickup: order.pickup,
      excludedDriverIds,
    },
    matchingParameters,
    now,
  );

  if (evaluation.eligible.length === 0) {
    return err(new NoEligibleDriverError(order.id, evaluation));
  }

  const batch = selectBroadcastBatch(evaluation, matchingParameters);

  return ok({
    orderId: order.id,
    cityId: order.cityId,
    round: order.broadcastRound + 1,
    batch,
    evaluation,
    offerTimeoutSeconds: settings.offerTimeoutSeconds,
    settings,
  });
}
