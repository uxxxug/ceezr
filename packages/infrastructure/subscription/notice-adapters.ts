/**
 * الغرض: محوّل صندوق إشعارات الاشتراك إلى دالّتي القاعدة: الحجزُ بـSKIP LOCKED
 *   والإعلانُ الذرّي. لا قرارَ إعادةٍ ولا حسابَ موعدٍ هنا.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/infrastructure/subscription
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts
 * ملاحظات مستقبلية: أيُّ حقلٍ جديد في الإشعار يُقرأ من `claim` لا باستعلامٍ ثانٍ.
 */
import type {
  SubscriptionNoticeDeliveryPort,
  SubscriptionNoticeKind,
  SubscriptionNoticePayload,
} from "../../application/subscription/notice-ports.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

const KINDS: readonly SubscriptionNoticeKind[] = [
  "activated",
  "trial_expired",
  "expired",
  "cancelled",
];

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * نوعٌ لا نعرفه لا يُخمَّن. القاعدةُ قد تسبق الكودَ في النشر، وإشعارٌ بنوعٍ جديد
 * يُسلَّم بنصٍّ خاطئ أسوأ من إشعارٍ يُترك في الصندوق حتى يُنشَر كودُه.
 */
function kindOf(value: unknown): SubscriptionNoticeKind | null {
  const raw = String(value);
  return KINDS.find((kind) => kind === raw) ?? null;
}

function payloadOf(value: unknown): SubscriptionNoticePayload {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SubscriptionNoticePayload)
    : {};
}

export function createSubscriptionNoticeDeliveryPort(sql: Sql): SubscriptionNoticeDeliveryPort {
  return {
    claim: (cityId) =>
      guard("rpc.claim_subscription_notices", async () => {
        const result = await sql<{ result: unknown }[]>`
          select claim_subscription_notices(${cityId}::uuid) result
        `;
        const row = envelope(result[0]?.result, "claim_subscription_notices");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        return rows(row.notices).flatMap((entry) => {
          const kind = kindOf(entry.kind);
          if (kind === null) return [];
          return [
            {
              noticeId: String(entry.notice_id),
              kind,
              claimToken: String(entry.claim_token),
              chatId: String(entry.chat_id),
              languageCode: String(entry.language_code),
              payload: payloadOf(entry.payload),
              attempts: Number(entry.attempts ?? 0),
              maxAttempts: Number(entry.max_attempts ?? 0),
            },
          ];
        });
      }),

    finish: (input) =>
      guard("rpc.finish_subscription_notice", async () => {
        const result = await sql<{ result: unknown }[]>`
          select finish_subscription_notice(
            ${input.noticeId}::uuid,
            ${input.claimToken}::uuid,
            ${input.messageId}::text::bigint,
            ${input.delivered},
            ${input.permanent},
            ${input.errorCode}::text
          ) result
        `;
        const row = envelope(result[0]?.result, "finish_subscription_notice");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        return true;
      }),
  };
}
