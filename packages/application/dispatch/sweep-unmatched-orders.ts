/**
 * الغرض: التقاط الطلبات التي بقيت في حالة البحث بلا أي عرض، فتُصعَّد إلى قروب
 *   الإسناد ويُخبَر صاحبها بالحقيقة. قبل هذه الحالة كان الطلب الذي لا يجد
 *   مرشَّحاً يسقط في فراغ: لا عرض يُكتب فلا شيء تُنهي مهلته expire-offers،
 *   ولا دورة تفاوض تُنشأ فلا شيء تُدوّره rotate-negotiations. فيبقى الطلب
 *   'searching' إلى الأبد، والراكب ينتظر بلا كلمة حتى يلغي بنفسه.
 * الحالة: منفّذ ومُختبَر على قاعدة حقيقية.
 * ينتمي إلى: packages/application/dispatch
 * يستخدمه: apps/workers/src/jobs/sweep-unmatched-orders.ts
 * ملاحظات مستقبلية: تعدّد النسخ آمن — عدم تكرار التصعيد مضمون في القاعدة
 *   عبر escalate_order (فحص audit_log داخل صفّ مقفول)، لا في ذاكرة العملية.
 */

import type { CityId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import {
  type EscalateUnmatchedOrderDependencies,
  escalateUnmatchedOrder,
} from "./escalate-unmatched-order.ts";

/** طلب عالق: يبحث منذ مدة، وليس له أي عرض قائم ولا سائق مُسنَد. */
export interface UnmatchedOrder {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  /** معرّف محادثة الراكب في تيليجرام — يُراسَل ببوت الراكب لا ببوت السائق. */
  readonly riderChatId: string;
  readonly riderLanguage: string | null;
  readonly waitingSeconds: number;
}

export interface UnmatchedOrderFinder {
  /**
   * الطلبات الباحثة منذ أكثر من العتبة بلا أي عرض. الاستبعاد بـ"بلا أي عرض"
   * لا بـ"بلا عرض قائم": الطلب الذي عُرض ورُفض له مسار آخر هو دورات البثّ،
   * وتصعيده هنا يُغرق قروب الإسناد بحالات لم تستنفد طريقها الطبيعي بعد.
   */
  findStaleSearching(
    cityId: CityId,
    olderThanSeconds: number,
  ): Promise<Result<readonly UnmatchedOrder[], PortFailureError>>;
}

export interface UnmatchedRiderNotifier {
  /** يُستدعى مرّة واحدة لكل طلب: عند أوّل تصعيد فعلي لا في كل شوط. */
  noDriverFound(order: UnmatchedOrder): Promise<Result<void, PortFailureError>>;
}

export interface SweepUnmatchedDependencies {
  readonly finder: UnmatchedOrderFinder;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly notifier: UnmatchedRiderNotifier;
  /** عتبة الانتظار قبل التصعيد — تأتي من إعدادات المدينة لا من ثابت في الكود. */
  readonly staleAfterSeconds: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface SweepUnmatchedReport {
  readonly cityId: CityId;
  readonly examined: number;
  readonly escalated: readonly OrderId[];
  readonly notified: readonly OrderId[];
  /** طلبات كانت مُصعَّدة من قبل — تُعدّ ولا تُصعَّد ثانية ولا يُزعَج صاحبها. */
  readonly alreadyEscalated: number;
  readonly failed: number;
}

export async function sweepUnmatchedOrders(
  cityId: CityId,
  deps: SweepUnmatchedDependencies,
): Promise<Result<SweepUnmatchedReport, PortFailureError>> {
  const stale = await deps.finder.findStaleSearching(cityId, deps.staleAfterSeconds);
  if (!stale.ok) return stale;

  const escalated: OrderId[] = [];
  const notified: OrderId[] = [];
  let alreadyEscalated = 0;
  let failed = 0;

  for (const order of stale.value) {
    const result = await escalateUnmatchedOrder(
      { orderId: order.orderId, reason: "no_driver_at_all", cyclesTried: 0 },
      deps.escalate,
    );

    if (!result.ok) {
      // طلب واحد معطوب لا يُسقط بقية طلبات المدينة: يُسجَّل ويُمضى.
      failed += 1;
      deps.log?.("sweep.escalation_failed", { orderId: order.orderId, cityId });
      continue;
    }

    if (!result.value.escalated) {
      alreadyEscalated += 1;
      continue;
    }

    escalated.push(order.orderId);

    /**
     * الإشعار معلَّق على escalated === true عمداً، ولا يحتاج عموداً جديداً:
     * escalate_order لا يقبل تصعيداً ثانياً لنفس الطلب (يفحص audit_log داخل
     * صفّ مقفول)، فالمرّة الوحيدة التي تصل هنا هي المرّة الأولى. وهذا يجعل
     * "رسالة واحدة للراكب" مضموناً في القاعدة لا رجاءً في الذاكرة.
     *
     * وإخفاق الإرسال لا يُلغي التصعيد: الطلب وصل موظف الإسناد فعلاً، والتراجع
     * عن ذلك لأن رسالة لم تصل يُضيّع الطلب مرّتين بدل مرّة.
     */
    const told = await deps.notifier.noDriverFound(order);
    if (told.ok) {
      notified.push(order.orderId);
    } else {
      deps.log?.("sweep.rider_notify_failed", { orderId: order.orderId, cityId });
    }
  }

  return ok({
    cityId,
    examined: stale.value.length,
    escalated,
    notified,
    alreadyEscalated,
    failed,
  });
}
