/**
 * الغرض: قراءة الاشتراك السارِي للسائق، وبدء التجربة المجانية عبر الدالة الذرّية start_trial.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/subscription
 * يُتوقع أن يستخدمه لاحقاً: بوت السائق، عامل التجديد (2.1 لاحقاً)
 * ملاحظات مستقبلية: التجديد المدفوع يمرّ عبر activate_subscription بنفس النمط تماماً.
 */

import type { SubscriptionReader, TrialRpcPort } from "../../application/bots/types.ts";
import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../../domain/subscription/entity.ts";
import type { CityId, DriverId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

interface SubscriptionRow {
  readonly driver_id: string;
  readonly city_id: string;
  readonly plan: string;
  readonly status: string;
  readonly trial_ends_at: Date | null;
  readonly current_period_end: Date | null;
  readonly cancel_at_period_end: boolean;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    driverId: row.driver_id as DriverId,
    cityId: row.city_id as CityId,
    plan: row.plan as SubscriptionPlan,
    status: row.status as SubscriptionStatus,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

export function createSubscriptionReader(sql: Sql): SubscriptionReader {
  return {
    findLive: (driverId: DriverId) =>
      guard("subscriptions.findLive", async () => {
        const rows = await sql<SubscriptionRow[]>`
          select driver_id, city_id, plan, status, trial_ends_at, current_period_end,
                 cancel_at_period_end
            from subscriptions
           where driver_id = ${driverId}
             and status in ('trialing', 'active')
           limit 1
        `;
        const row = rows[0];
        return row === undefined ? null : toSubscription(row);
      }),
  };
}

export function createTrialRpc(sql: Sql): TrialRpcPort {
  return {
    startTrial: (driverId: DriverId, service: ServiceType) =>
      guard("rpc.start_trial", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select start_trial(${driverId}::uuid, ${service}::subscription_plan) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ start_trial غير مفهوم");
        return {
          started: envelope.ok,
          reason: envelope.ok ? null : (envelope.error ?? "UNKNOWN"),
        };
      }),
  };
}
