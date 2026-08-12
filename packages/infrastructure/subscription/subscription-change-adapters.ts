/**
 * الغرض: محوّلات تغييرات الاشتراك — الإلغاء والاستئناف وعرض سعر الترقية وتطبيقها،
 *   كلّها عبر الدالّات الذرّية: cancel_subscription، resume_subscription،
 *   plan_upgrade_quote، upgrade_plan.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — الأمر الثاني.
 * ينتمي إلى: infrastructure/subscription
 * ملاحظات: لا يُحوَّل أي مبلغ ولا تُقارن أي خطّة هنا. الغلاف يُقرأ كما هو،
 *   والقيم الرقمية تُمرَّر بلا حساب — القاعدة هي مصدر الحقيقة الوحيد للأسعار.
 */

import type {
  CancellationOutcome,
  ResumeOutcome,
  SubscriptionChangeRpcPort,
  UpgradeApplied,
  UpgradeQuote,
} from "../../application/subscription/ports.ts";
import type { SubscriptionPlan, SubscriptionStatus } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { guard, type RpcEnvelope, readEnvelope, type Sql } from "../db/client.ts";

/** يقرأ نصّاً من الغلاف أو null — لا قيمة افتراضية مُخترعة. */
function text(envelope: RpcEnvelope, key: string): string | null {
  const value = envelope[key];
  return typeof value === "string" ? value : null;
}

function bool(envelope: RpcEnvelope, key: string): boolean {
  return envelope[key] === true;
}

function timestamp(envelope: RpcEnvelope, key: string): Date | null {
  const value = envelope[key];
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * يقرأ رقماً من الغلاف. jsonb يُعيد الأرقام أرقاماً، لكن numeric قد يعود
 * نصّاً عبر بعض المسارات، فتُقبل الحالتان ويُرفض ما ليس رقماً — لا يُفترض صفر
 * لمبلغٍ مجهول: مبلغٌ مجهول يُطالَب به السائق أسوأ من فشلٍ صريح.
 */
function amount(envelope: RpcEnvelope, key: string): number | null {
  const value = envelope[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function createSubscriptionChangeRpc(sql: Sql): SubscriptionChangeRpcPort {
  return {
    requestCancellation: (driverId: DriverId, reason: string | null) =>
      guard("rpc.cancel_subscription", async (): Promise<CancellationOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select cancel_subscription(${driverId}::uuid, ${reason}) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          throw new Error("ردّ cancel_subscription غير مفهوم");
        }
        return {
          ok: envelope.ok,
          error: envelope.ok ? null : (envelope.error ?? "UNKNOWN"),
          subscriptionId: text(envelope, "subscription_id"),
          alreadyCancelled: bool(envelope, "already_cancelled"),
          status: text(envelope, "status") as SubscriptionStatus | null,
          serviceUntil: timestamp(envelope, "service_until"),
        };
      }),

    resume: (driverId: DriverId) =>
      guard("rpc.resume_subscription", async (): Promise<ResumeOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select resume_subscription(${driverId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          throw new Error("ردّ resume_subscription غير مفهوم");
        }
        return {
          ok: envelope.ok,
          error: envelope.ok ? null : (envelope.error ?? "UNKNOWN"),
          subscriptionId: text(envelope, "subscription_id"),
          alreadyActive: bool(envelope, "already_active"),
          status: text(envelope, "status") as SubscriptionStatus | null,
        };
      }),

    quoteUpgrade: (driverId: DriverId, newPlan: SubscriptionPlan) =>
      guard("rpc.plan_upgrade_quote", async (): Promise<UpgradeQuote> => {
        const rows = await sql<{ result: unknown }[]>`
          select plan_upgrade_quote(
            ${driverId}::uuid, ${newPlan}::subscription_plan
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          throw new Error("ردّ plan_upgrade_quote غير مفهوم");
        }
        if (!envelope.ok) {
          return {
            ok: false,
            error: envelope.error ?? "UNKNOWN",
            subscriptionId: text(envelope, "subscription_id"),
            cityId: null,
            currentPlan: text(envelope, "current_plan") as SubscriptionPlan | null,
            newPlan: text(envelope, "requested_plan") as SubscriptionPlan | null,
            amountDue: 0,
            paymentRequired: false,
            currency: null,
            periodEnd: null,
            status: null,
          };
        }
        const due = amount(envelope, "amount_due");
        if (due === null) {
          throw new Error("plan_upgrade_quote أعادت مبلغاً غير رقمي");
        }
        return {
          ok: true,
          error: null,
          subscriptionId: text(envelope, "subscription_id"),
          cityId: text(envelope, "city_id") as CityId | null,
          currentPlan: text(envelope, "current_plan") as SubscriptionPlan | null,
          newPlan: text(envelope, "new_plan") as SubscriptionPlan | null,
          amountDue: due,
          paymentRequired: bool(envelope, "payment_required"),
          currency: text(envelope, "currency"),
          periodEnd: timestamp(envelope, "period_end"),
          status: text(envelope, "status") as SubscriptionStatus | null,
        };
      }),

    applyUpgrade: (driverId: DriverId, newPlan: SubscriptionPlan, transactionId: string | null) =>
      guard("rpc.upgrade_plan", async (): Promise<UpgradeApplied> => {
        const rows = await sql<{ result: unknown }[]>`
          select upgrade_plan(
            ${driverId}::uuid, ${newPlan}::subscription_plan, ${transactionId}::uuid
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          throw new Error("ردّ upgrade_plan غير مفهوم");
        }
        return {
          ok: envelope.ok,
          error: envelope.ok ? null : (envelope.error ?? "UNKNOWN"),
          subscriptionId: text(envelope, "subscription_id"),
          alreadyOnPlan: bool(envelope, "already_on_plan"),
          plan: text(envelope, "plan") as SubscriptionPlan | null,
          periodEnd: timestamp(envelope, "period_end"),
        };
      }),
  };
}
