/**
 * الغرض: محوّلات البثّ الجماعي إلى دوالّ القاعدة. لا اختيارَ جمهورٍ ولا عدَّ صفوفٍ
 *   ولا قرارَ إعادةِ محاولةٍ هنا: كلّه في RPC واحدة ذرّية.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/infrastructure/broadcast
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: أيّ حقلٍ جديد في الحملة يُقرأ من `claim` لا باستعلامٍ ثانٍ.
 *
 * تحذيرٌ مدفوعُ الثمن مرّتين: المرشّحات تُمرَّر بـ`sql.json(...)` لا بـ
 * `${JSON.stringify(filters)}::jsonb`. الثانية تُرسل نصّاً فيُلفّفه السائق ثانيةً،
 * فتصل القاعدةَ jsonb من نوع `string`، و`filters -> 'verification'` تعود `null`،
 * فتُهمَل كلُّ المرشّحات بصمت ويُرسَل البثُّ إلى الجمهور كلّه. لا خطأ، لا سجلّ،
 * فقط رسالةٌ جماعية ذهبت إلى من لم يُقصَد. العيبُ نفسه وُثِّق في
 * `packages/infrastructure/financial/payment-adapters.ts` قبل هذا الملفّ.
 */
import type {
  BroadcastAdminPort,
  BroadcastDeliveryPort,
  BroadcastFilters,
} from "../../application/broadcast/ports.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function createBroadcastAdminPort(sql: Sql): BroadcastAdminPort {
  return {
    count: (input) =>
      guard("rpc.count_broadcast_audience", async () => {
        const result = await sql<{ result: unknown }[]>`
          select count_broadcast_audience(
            ${input.actorUserId}::uuid,
            ${input.cityId}::uuid,
            ${input.audience}::text,
            ${sql.json(input.filters satisfies BroadcastFilters as never)}
          ) result
        `;
        const row = envelope(result[0]?.result, "count_broadcast_audience");
        if (row.ok !== true) return { error: String(row.error ?? "UNKNOWN") };
        return {
          total: Number(row.total ?? 0),
          cities: rows(row.cities).map((entry) => ({
            cityId: String(entry.city_id),
            code: String(entry.code),
            nameAr: String(entry.name_ar),
            recipients: Number(entry.recipients ?? 0),
          })),
        };
      }),

    create: (input) =>
      guard("rpc.create_broadcast", async () => {
        const result = await sql<{ result: unknown }[]>`
          select create_broadcast(
            ${input.actorUserId}::uuid,
            ${input.cityId}::uuid,
            ${input.audience}::text,
            ${sql.json(input.filters satisfies BroadcastFilters as never)},
            ${input.body}::text,
            ${input.linkLabel}::text,
            ${input.linkUrl}::text,
            ${input.silent},
            ${input.sendAfter === null ? null : input.sendAfter.toISOString()}::timestamptz
          ) result
        `;
        const row = envelope(result[0]?.result, "create_broadcast");
        if (row.ok !== true) return { error: String(row.error ?? "UNKNOWN") };
        return {
          batchId: String(row.batch_id),
          total: Number(row.total ?? 0),
          cities: rows(row.cities).map((entry) => ({
            cityId: String(entry.city_id),
            recipients: Number(entry.recipients ?? 0),
          })),
        };
      }),

    cancel: (input) =>
      guard("rpc.cancel_broadcast", async () => {
        const result = await sql<{ result: unknown }[]>`
          select cancel_broadcast(${input.actorUserId}::uuid, ${input.batchId}::uuid) result
        `;
        const row = envelope(result[0]?.result, "cancel_broadcast");
        if (row.ok !== true) return { error: String(row.error ?? "UNKNOWN") };
        return { canceled: Number(row.canceled ?? 0) };
      }),
  };
}

export function createBroadcastDeliveryPort(sql: Sql): BroadcastDeliveryPort {
  return {
    claim: (cityId) =>
      guard("rpc.claim_broadcast_recipients", async () => {
        const result = await sql<{ result: unknown }[]>`
          select claim_broadcast_recipients(${cityId}::uuid) result
        `;
        const row = envelope(result[0]?.result, "claim_broadcast_recipients");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        return rows(row.recipients).map((entry) => ({
          recipientId: String(entry.recipient_id),
          audience: entry.audience === "riders" ? ("riders" as const) : ("drivers" as const),
          claimToken: String(entry.claim_token),
          chatId: String(entry.chat_id),
          languageCode: String(entry.language_code),
          attempts: Number(entry.attempts ?? 0),
          maxAttempts: Number(entry.max_attempts ?? 0),
          body: String(entry.body),
          silent: entry.silent === true,
          linkLabel: entry.link_label == null ? null : String(entry.link_label),
          linkUrl: entry.link_url == null ? null : String(entry.link_url),
        }));
      }),

    finish: (input) =>
      guard("rpc.finish_broadcast_delivery", async () => {
        const result = await sql<{ result: unknown }[]>`
          select finish_broadcast_delivery(
            ${input.recipientId}::uuid,
            ${input.claimToken}::uuid,
            ${input.messageId}::text::bigint,
            ${input.delivered},
            ${input.permanent},
            ${input.errorCode}::text
          ) result
        `;
        const row = envelope(result[0]?.result, "finish_broadcast_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        return true;
      }),
  };
}
