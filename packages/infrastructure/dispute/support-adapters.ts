/**
 * الغرض: كل ما تمسّه تذاكر الدعم في القاعدة: الفتح، قراءة السياق الحيّ، حفظ معرّف
 *   البطاقة، الاستلام، والقرار. لا منطق قرار هنا — كله تفويض للدوال الذرّية.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.4.
 * ينتمي إلى: infrastructure/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/admin-dashboard
 * ملاحظات مستقبلية: لوحة الإدارة تستخدم هذه المحوّلات نفسها لا استعلامات موازية،
 *   وإلا انقسم منطق الصلاحيات بين مسارين.
 */

import type {
  ClaimOutcomeReport,
  OpenTicketOutcome,
  ResolveOutcome,
  SupportCardRecorder,
  SupportClaimPort,
  SupportResolutionPort,
  SupportTicketContext,
  SupportTicketContextReader,
  SupportTicketPort,
} from "../../application/dispute/index.ts";
import type {
  ClaimTicketReason,
  OpenTicketReason,
  ResolveTicketReason,
  SupportResolution,
  SupportTicketStatus,
  SupportTicketType,
} from "../../domain/dispute/index.ts";
import type { SubscriptionPlan, SubscriptionStatus } from "../../domain/subscription/entity.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

function unreadable(fn: string): never {
  throw new Error(`ردّ ${fn} غير مفهوم`);
}

/** تاريخ من jsonb: القاعدة تعيد نصّاً بصيغة ISO أو null. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function createSupportTicketPort(sql: Sql): SupportTicketPort {
  return {
    open: (input) =>
      guard("rpc.open_support_ticket", async (): Promise<OpenTicketOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select open_support_ticket(
            ${input.telegramUserId}::bigint,
            ${input.type}::support_ticket_type,
            ${input.message}::text,
            ${input.attachmentFileId}::text,
            ${input.orderId}::uuid
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("open_support_ticket");
        if (!envelope.ok) {
          const retry = envelope.retry_after_seconds;
          return {
            opened: null,
            reason: String(envelope.error ?? "UNKNOWN") as OpenTicketReason,
            retryAfterSeconds: retry === undefined || retry === null ? null : Number(retry),
          };
        }
        return {
          opened: {
            ticketId: String(envelope.ticket_id),
            cityId: String(envelope.city_id) as never,
            groupId: String(envelope.group_id),
            type: String(envelope.type) as SupportTicketType,
          },
          reason: null,
          retryAfterSeconds: null,
        };
      }),
  };
}

export function createSupportTicketContextReader(sql: Sql): SupportTicketContextReader {
  return {
    read: (ticketId: string) =>
      guard("rpc.get_support_ticket_context", async (): Promise<SupportTicketContext | null> => {
        const rows = await sql<{ result: unknown }[]>`
            select get_support_ticket_context(${ticketId}::uuid) as result
          `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("get_support_ticket_context");
        // تذكرة غير موجودة نتيجة عمل لا عطل: نعيد null ويقرّر المتّصل
        if (!envelope.ok) return null;

        const rawSub = envelope.subscription as Record<string, unknown> | null;
        const created = toDate(envelope.created_at);
        if (created === null) unreadable("get_support_ticket_context");

        return {
          groupId: toText(envelope.group_id),
          ticket: {
            id: String(envelope.ticket_id),
            type: String(envelope.type) as SupportTicketType,
            status: String(envelope.status) as SupportTicketStatus,
            cityName: String(envelope.city_name ?? ""),
            message: String(envelope.message ?? ""),
            attachmentFileId: toText(envelope.attachment_file_id),
            orderId: toText(envelope.order_id),
            createdAt: created,
            owner: {
              fullName: String(envelope.full_name ?? ""),
              // الهاتف قد يكون فارغاً لعميل سجّل بلا مشاركة رقمه
              phone: String(envelope.phone ?? ""),
              telegramId: String(envelope.telegram_id ?? ""),
              telegramUsername: toText(envelope.telegram_username),
              languageCode: String(envelope.language_code ?? "ar"),
            },
            subscription:
              rawSub === null || rawSub === undefined
                ? null
                : {
                    plan: String(rawSub.plan) as SubscriptionPlan,
                    status: String(rawSub.status) as SubscriptionStatus,
                    currentPeriodEnd: toDate(rawSub.current_period_end),
                    trialEndsAt: toDate(rawSub.trial_ends_at),
                    isLive: rawSub.is_live === true,
                  },
          },
        };
      }),
  };
}

export function createSupportCardRecorder(sql: Sql): SupportCardRecorder {
  return {
    attach: (ticketId: string, messageId: string) =>
      guard("rpc.attach_support_ticket_card", async (): Promise<void> => {
        await sql`
          select attach_support_ticket_card(${ticketId}::uuid, ${messageId}::bigint) as result
        `;
      }),
  };
}

export function createSupportClaimPort(sql: Sql): SupportClaimPort {
  return {
    claim: (ticketId: string, actorTelegramId: string) =>
      guard("rpc.claim_support_ticket", async (): Promise<ClaimOutcomeReport> => {
        const rows = await sql<{ result: unknown }[]>`
          select claim_support_ticket(
            ${ticketId}::uuid, ${actorTelegramId}::bigint
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("claim_support_ticket");
        if (!envelope.ok) {
          return {
            claimed: false,
            reason: String(envelope.error ?? "UNKNOWN") as ClaimTicketReason,
            claimedBy: toText(envelope.claimed_by),
          };
        }
        return { claimed: true, reason: null, claimedBy: null };
      }),
  };
}

export function createSupportResolutionPort(sql: Sql): SupportResolutionPort {
  return {
    resolve: (input) =>
      guard("rpc.resolve_support_ticket", async (): Promise<ResolveOutcome> => {
        const rows = await sql<{ result: unknown }[]>`
          select resolve_support_ticket(
            ${input.ticketId}::uuid,
            ${input.actorTelegramId}::bigint,
            ${input.action}::text,
            ${input.note}::text
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) unreadable("resolve_support_ticket");
        if (!envelope.ok) {
          return {
            resolved: false,
            reason: String(envelope.error ?? "UNKNOWN") as ResolveTicketReason,
            action: null,
            ownerTelegramId: null,
            ownerLanguage: null,
            status: null,
          };
        }
        return {
          resolved: true,
          reason: null,
          action: String(envelope.action) as SupportResolution,
          ownerTelegramId: toText(envelope.owner_telegram_id),
          ownerLanguage: toText(envelope.owner_language),
          status: toText(envelope.status),
        };
      }),
  };
}
