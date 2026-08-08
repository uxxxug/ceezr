/**
 * الغرض: منفذ دورة حياة الاشتراك على القاعدة الحقيقية: إنهاء المستحقّ، قائمة المقترب
 *   انتهاؤه، وتثبيت أن التحذير أُرسل — كلّها عبر دالّات ذرّية لا عبر قراءة ثم كتابة.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: infrastructure/subscription
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/expire-subscriptions.ts، لوحة الإدارة
 * ملاحظات مستقبلية: التجديد المدفوع التلقائي يضيف دالّة رابعة بنفس النمط تماماً.
 */

import type {
  ExpireSubscriptionsOutcome,
  ExpiringSubscription,
  SubscriptionLifecycleRpcPort,
} from "../../application/subscription/expire-subscriptions.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

interface ExpiringRow {
  readonly subscription_id: string;
  readonly city_id: string;
  readonly driver_id: string;
  readonly telegram_id: number | string;
  readonly language_code: string;
  readonly plan: string;
  readonly status: string;
  readonly ends_at: string;
  readonly days_left: number;
}

function toExpiring(row: ExpiringRow): ExpiringSubscription {
  return {
    subscriptionId: row.subscription_id,
    cityId: row.city_id as CityId,
    driverId: row.driver_id as DriverId,
    // معرّف تيليجرام bigint في القاعدة، ويُعامَل نصّاً في كل الطبقات فوقها:
    // تحويله رقماً في JavaScript يفقد الدقّة فوق 2^53.
    telegramId: String(row.telegram_id),
    languageCode: row.language_code,
    plan: row.plan,
    status: row.status,
    endsAt: new Date(row.ends_at),
    daysLeft: Number(row.days_left),
  };
}

export function createSubscriptionLifecycleRpc(sql: Sql): SubscriptionLifecycleRpcPort {
  return {
    expireDue: () =>
      guard("rpc.expire_due_subscriptions", async (): Promise<ExpireSubscriptionsOutcome> => {
        const rows = await sql<{ result: unknown }[]>`select expire_due_subscriptions() as result`;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ expire_due_subscriptions غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");
        const payload = envelope as { expired_subscriptions?: unknown };
        return { expiredCount: Number(payload.expired_subscriptions ?? 0) };
      }),

    expiringSoon: (days: number) =>
      guard(
        "rpc.subscriptions_expiring_soon",
        async (): Promise<readonly ExpiringSubscription[]> => {
          const rows = await sql<{ result: unknown }[]>`
          select subscriptions_expiring_soon(${days}::integer) as result
        `;
          const envelope = readEnvelope(rows[0]?.result);
          if (envelope === null) throw new Error("ردّ subscriptions_expiring_soon غير مفهوم");
          if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");
          const payload = envelope as { subscriptions?: unknown };
          const list = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
          return list.map((row) => toExpiring(row as ExpiringRow));
        },
      ),

    recordWarning: (subscriptionId: string) =>
      guard("rpc.record_subscription_warning", async (): Promise<void> => {
        const rows = await sql<{ result: unknown }[]>`
          select record_subscription_warning(${subscriptionId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ record_subscription_warning غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");
      }),
  };
}
