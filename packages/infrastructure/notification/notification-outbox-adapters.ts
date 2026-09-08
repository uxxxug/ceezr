/**
 * محوّلُ صندوقِ الصادرِ الموحَّدِ إلى RPCs الذرّيّة (BUG-004). كلُّ تغيّرِ حالةٍ يبقى
 * في PostgreSQL: claim بـFOR UPDATE SKIP LOCKED + claim_token، وfinish بالرمزِ لا
 * بالصفّ، وabandon بالرمزِ كذلك. المحوّلُ لا يعرفُ نوعًا بعينِه: يمرّرُ kind والحمولةَ
 * كما بنتهما القاعدةُ إلى معالجِ النوعِ. مرآةٌ لـcreateSafetyDeliveryPort في البنية،
 * تزيدُ عليها abandon.
 */
import type {
  FinishOutcome,
  NotificationOutboxPort,
  OutboxDelivery,
} from "../../application/notification/deliver-notification.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

const FINISH_OUTCOMES: readonly string[] = ["delivered", "dead", "retried"];

/**
 * مآلُ القاعدةِ يُقرأُ كما هو لا كما يُشتهى: نصٌّ غيرُ معروفٍ يعودُ `null` فلا
 * يُحسبَ موتاً ولا تسليماً بالغلطِ. (CAP-002)
 */
function finishOutcome(value: unknown): FinishOutcome | null {
  const text = typeof value === "string" ? value : null;
  return text !== null && FINISH_OUTCOMES.includes(text) ? (text as FinishOutcome) : null;
}

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

export function createNotificationOutboxPort(sql: Sql): NotificationOutboxPort {
  return {
    claim: () =>
      guard("rpc.claim_notification_delivery", async () => {
        const rows = await sql<{ result: unknown }[]>`select claim_notification_delivery() result`;
        const row = envelope(rows[0]?.result, "claim_notification_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const delivery = row.delivery as Record<string, unknown> | null;
        if (delivery == null) return { delivery: null };
        const payload = delivery.payload;
        return {
          delivery: {
            deliveryId: String(delivery.delivery_id),
            kind: String(delivery.kind),
            cityId: String(delivery.city_id) as CityId,
            claimToken: String(delivery.claim_token),
            attempts: Number(delivery.attempts),
            maxAttempts: Number(delivery.max_attempts),
            payload:
              typeof payload === "object" && payload !== null
                ? (payload as Record<string, unknown>)
                : {},
          } satisfies OutboxDelivery,
        };
      }),
    finish: (input) =>
      guard("rpc.finish_notification_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select finish_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.messageId}::text, ${input.messageId !== null}, ${input.error}::text) result`;
        const row = envelope(rows[0]?.result, "finish_notification_delivery");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    abandon: (input) =>
      guard("rpc.abandon_notification_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select abandon_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.reason}::text) result`;
        const row = envelope(rows[0]?.result, "abandon_notification_delivery");
        return row.ok === true;
      }),
  };
}
