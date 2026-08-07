/**
 * الغرض: التصعيد إلى قروب الإسناد حين تفشل المطابقة كلياً: لا سائق مشترك، ولا استجابة
 *   من قروب غير المشتركين بعد استنفاد الدورات. الإسناد تدخّل تشغيلي لا نزاع،
 *   فلا يُخلط بقروب الدعم (القسم 3.5).
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 * ملاحظات مستقبلية: نداء الطوارئ (SOS) يدخل من هنا أيضاً بنوع تصعيد مختلف عند تفعيله.
 */

import { approximateArea } from "../../domain/dispatch/negotiation.ts";
import type { CityId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { OrderRepository, PortFailureError } from "../ports/index.ts";

export type EscalationReason = "unsubscribed_cycles_exhausted" | "no_driver_at_all";

export type EscalationOutcome =
  | {
      readonly escalated: true;
      readonly groupId: string;
      readonly cityId: CityId;
      readonly service: ServiceType;
    }
  | { readonly escalated: false; readonly reason: string };

/** منفذ الكتابة الذرّية — يقابل الدالة escalate_order (تصعيد واحد لكل طلب). */
export interface EscalationPort {
  escalate(
    orderId: OrderId,
    reason: EscalationReason,
  ): Promise<Result<EscalationOutcome, PortFailureError>>;
}

export interface EscalationCard {
  readonly groupId: string;
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly reason: EscalationReason;
  /** منطقة تقريبية فقط: قروب الإسناد قروب موظفين، لكن القاعدة واحدة حتى يُسنَد الطلب. */
  readonly areaLabel: string;
  readonly cyclesTried: number;
}

export interface EscalationGroupPublisher {
  publishEscalation(card: EscalationCard): Promise<Result<string | null, PortFailureError>>;
}

export interface EscalateUnmatchedOrderDependencies {
  readonly orders: OrderRepository;
  readonly escalation: EscalationPort;
  readonly publisher: EscalationGroupPublisher;
}

export class OrderNotFoundForEscalationError {
  readonly code = "ORDER_NOT_FOUND_FOR_ESCALATION" as const;
  constructor(readonly orderId: OrderId) {}
}

export type EscalateUnmatchedOrderError = PortFailureError | OrderNotFoundForEscalationError;

export interface EscalationReport {
  readonly orderId: OrderId;
  readonly escalated: boolean;
  readonly messageId: string | null;
  readonly reason: string | null;
}

/**
 * التصعيد لا يُلغي الطلب ولا يُغيّر حالته: يبقى 'searching' ليتصرّف فيه موظف الإسناد.
 * إلغاؤه هنا كان سيحرم الموظف من أي مساحة تدخّل، وهو نقيض الغرض من القروب.
 */
export async function escalateUnmatchedOrder(
  input: {
    readonly orderId: OrderId;
    readonly reason: EscalationReason;
    readonly cyclesTried: number;
  },
  deps: EscalateUnmatchedOrderDependencies,
): Promise<Result<EscalationReport, EscalateUnmatchedOrderError>> {
  const found = await deps.orders.findById(input.orderId);
  if (!found.ok) return found;
  if (found.value === null) return err(new OrderNotFoundForEscalationError(input.orderId));

  const escalated = await deps.escalation.escalate(input.orderId, input.reason);
  if (!escalated.ok) return escalated;

  if (!escalated.value.escalated) {
    return ok({
      orderId: input.orderId,
      escalated: false,
      messageId: null,
      reason: escalated.value.reason,
    });
  }

  const published = await deps.publisher.publishEscalation({
    groupId: escalated.value.groupId,
    orderId: input.orderId,
    cityId: escalated.value.cityId,
    service: escalated.value.service,
    reason: input.reason,
    areaLabel: approximateArea(found.value.pickup),
    cyclesTried: input.cyclesTried,
  });
  if (!published.ok) return published;

  return ok({
    orderId: input.orderId,
    escalated: true,
    messageId: published.value,
    reason: null,
  });
}
