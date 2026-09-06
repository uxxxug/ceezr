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

/**
 * أنواع التصعيد ثلاثة لأنّ تصرّف موظّف الإسناد يختلف باختلافها:
 * - `no_driver_at_all`: لم يُعرض الطلب على أحد قطّ — العلّة في العرض لا في السائقين.
 * - `broadcast_rounds_exhausted`: عُرِض وتجاهلوه حتّى نفدت الدورات — السائقون موجودون
 *   ولكنّهم أعرضوا، وخلطُه بالأول يقول للموظّف خبراً غير صحيح.
 * - `unsubscribed_cycles_exhausted`: مسار قروب غير المشتركين انتهى بلا اتفاق.
 */
export type EscalationReason =
  | "unsubscribed_cycles_exhausted"
  | "no_driver_at_all"
  | "broadcast_rounds_exhausted";

export type EscalationOutcome =
  | {
      readonly escalated: true;
      readonly groupId: string;
      readonly cityId: CityId;
      readonly service: ServiceType;
    }
  | { readonly escalated: false; readonly reason: string };

/**
 * منفذ الكتابة الذرّية — يقابل escalate_order و mark_escalation_delivered.
 *
 * الدالّتان اثنتان ولا واحدة لأنّ الإرسال يقع بينهما، ولا يجوز أن يُعدّ التصعيد تامّاً
 * قبل أن تصل البطاقة: دمجهما في نداءٍ واحد هو بعينه العطب الذي جاءت هذه القسمة لإصلاحه.
 */
export interface EscalationPort {
  escalate(
    orderId: OrderId,
    reason: EscalationReason,
  ): Promise<Result<EscalationOutcome, PortFailureError>>;
  /**
   * يُعلن وصول البطاقة فعلاً. `firstDelivery` هو انتقال الصفّ من غير مسلَّمٍ إلى مسلَّم،
   * ويحدث مرّةً واحدةً داخل صفٍّ مقفول — فعليه يُعلَّق إخبار الراكب.
   */
  markDelivered(
    orderId: OrderId,
    messageId: string | null,
  ): Promise<
    Result<
      { readonly firstDelivery: boolean; readonly notificationQueued: boolean },
      PortFailureError
    >
  >;
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
  /**
   * أأُودِعَ إخطارُ «لا سائقَ» لصاحبِ الطلبِ في معاملةِ أوّلِ تسليمٍ نفسِها؟
   * (BUG-004) الإرسالُ بعدَ الالتزامِ ومن العاملِ، وهذا العلمُ يقولُ أأُودِعَ أم كانَ مودَعاً سلفاً.
   */
  readonly notificationQueued: boolean;
}

/**
 * التصعيد لا يُلغي الطلب ولا يُغيّر حالته: يبقى 'searching' ليتصرّف فيه موظف الإسناد.
 * إلغاؤه هنا كان سيحرم الموظف من أي مساحة تدخّل، وهو نقيض الغرض من القروب.
 *
 * و`escalated: true` تعني «وصلت البطاقة الآن لأوّل مرّة» لا «كُتب أثرٌ»: فإنّ كتابة الأثر
 * قبل الإرسال كانت تجعل إخفاقاً عابراً في الشبكة يُخرس الطلب إلى الأبد — أثرٌ يقول
 * «صُعِّد»، وبطاقةٌ لم تصل، وراكبٌ لم يُخبَر، وحارسٌ يمنع كلّ إعادة.
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
      notificationQueued: false,
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
  /** إخفاق الإرسال يعود خطأً والأثر باقٍ غيرَ مسلَّم، فالشوط التالي يعيد المحاولة. */
  if (!published.ok) return published;

  /**
   * التسليم يُعلن بعد الوصول لا قبله. ولو أخفق الإعلان بعد إرسالٍ ناجح فستُرسل بطاقةٌ
   * ثانيةٌ في شوطٍ لاحق — وهي مقايضةٌ مقصودة: بطاقةٌ مكرّرةٌ يراها موظّفٌ أهونُ بما لا
   * يُقاس من طلبٍ يتيمٍ صامتٍ لا يراه أحد.
   */
  const delivered = await deps.escalation.markDelivered(input.orderId, published.value);
  if (!delivered.ok) return delivered;

  return ok({
    orderId: input.orderId,
    escalated: delivered.value.firstDelivery,
    messageId: published.value,
    reason: delivered.value.firstDelivery ? null : "ALREADY_DELIVERED",
    notificationQueued: delivered.value.notificationQueued,
  });
}
