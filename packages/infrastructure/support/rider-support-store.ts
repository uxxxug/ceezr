/**
 * الغرض: محوّلُ دعمِ الراكبِ على PostgreSQL — نداءُ `open_support_ticket`
 *   ونداءُ `rider_support_tickets`، وقراءةُ حمولتِهما **بلا افتراضٍ**
 *   (`F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: infrastructure/support
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — الدالّتانِ لا تذكرانِ دوراً في اسمِهما
 *   إلّا الثانيةَ، وشكوى السائقِ تدخلُ من `open_support_ticket` عينِها.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا **مرجعٌ لا يُقابِلُ الصيغةَ عطبٌ** ولا يُعادُ كما جاءَ
 *
 * المرجعُ هو ما يُنطَقُ في القروبِ ويُكتَبُ في رسالةٍ. ومرجعٌ فارغٌ أو مُشوَّهٌ
 * يُعرَضُ على الشاشةِ يجعلُ المستخدمَ يُمليه على موظّفٍ فلا يجدُ شيئاً —
 * **وذاكَ أسوأُ من عطلٍ ظاهرٍ**. فصيغةٌ لا تُقابِلُ `MALFORMED_RESULT`.
 *
 * ## ولماذا التهدئةُ تُقرأُ ثانيتُها ولا تُحسَبُ ههنا
 *
 * `retry_after_seconds` تحسبُه القاعدةُ من `now()` الخاصِّ بمعاملتِها. وحسابُه
 * ههنا من ساعةِ العمليّةِ يُنتِجُ رقماً يخالفُه بمقدارِ انحرافِ الساعتَينِ،
 * فيُعِدُ الشاشةَ بوقتٍ يُردُّ فيه الطلبُ ثانيةً.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ
 *
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ وحدَها، والمعرّفُ
 *      يُفحَصُ رقميّاً قبلَ إرسالِه إلى `bigint` (كما في `sos-surface-store`).
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`،
 *      ولا يُقرأُ «لا تذاكرَ لكَ».
 *   ــ **لا يقرأُ اسمَ موظّفٍ**: الدالّةُ لا تُعيدُه أصلاً، ولا يُضافُ ههنا.
 */

import type {
  RiderSupportStore,
  SupportStoreError,
  SupportStoreRejection,
} from "../../application/support/ports.ts";
import {
  isRiderSupportCategory,
  isSupportTicketReference,
  isSupportTicketStatus,
  type OpenedSupportTicket,
  type RiderSupportPage,
  type RiderSupportTicket,
  type SupportTicketCursor,
} from "../../domain/support/rider-support.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

/** مجالُ الرفضِ المغلقُ — يُقابِلُ رموزَ الدالّتَينِ حرفاً. */
const REJECTIONS: readonly SupportStoreRejection[] = [
  "MESSAGE_EMPTY",
  "USER_NOT_FOUND",
  "USER_BLOCKED",
  "NOT_REGISTERED",
  "NOT_A_DRIVER",
  "NOT_A_RIDER",
  "CITY_GROUP_MISSING",
  "COOLDOWN_ACTIVE",
  "ORDER_NOT_YOURS",
  "LIMIT_OUT_OF_RANGE",
  "CURSOR_INCOMPLETE",
];

function failed(
  reason: SupportStoreError extends never ? never : "STORE_ERROR" | "MALFORMED_RESULT",
) {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

/** كما في `sos-surface-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): SupportStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  const rejection = code as SupportStoreRejection;
  const retry = readInteger(payload.retry_after_seconds);
  return {
    rejection,
    // ثانيةٌ سالبةٌ أو غائبةٌ لا تُعرَضُ رقماً: `null` تعني «أعِدْ لاحقاً» بلا وعدٍ.
    retryAfterSeconds:
      rejection === "COOLDOWN_ACTIVE" && retry !== null && retry >= 0 ? retry : null,
  };
}

function readTicket(value: unknown): RiderSupportTicket | null {
  if (!isRecord(value)) return null;
  const id = readText(value.id);
  const reference = value.reference;
  const status = value.status;
  const category = value.type;
  const message = readText(value.message);
  const createdAt = readInstant(value.created_at);
  if (id === null || message === null || createdAt === null) return null;
  if (!isSupportTicketReference(reference)) return null;
  if (!isSupportTicketStatus(status)) return null;
  // `subscription` تذكرةُ سائقٍ لا راكبٍ، ولا تظهرُ في صفحتِه؛ لكنَّها قيمةٌ
  // مشروعةٌ في النوعِ نفسِه فتُقبَلُ قراءةً ولا تُصنَّفُ حمولةً فاسدةً.
  if (!(isRiderSupportCategory(category) || category === "subscription")) return null;
  return {
    id,
    reference,
    category,
    status,
    message,
    resolution: typeof value.resolution === "string" ? value.resolution : null,
    orderId: typeof value.order_id === "string" ? value.order_id : null,
    createdAt,
    resolvedAt: readInstant(value.resolved_at),
  };
}

function readCursor(value: unknown): SupportTicketCursor | null {
  if (!isRecord(value)) return null;
  const createdAt = readInstant(value.created_at);
  const id = readText(value.id);
  if (createdAt === null || id === null) return null;
  return { createdAt, id };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresRiderSupportStore implements RiderSupportStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async openTicket(input: {
    readonly telegramUserId: string;
    readonly category: Parameters<RiderSupportStore["openTicket"]>[0]["category"];
    readonly message: string;
    readonly orderId: string | null;
  }): Promise<Result<OpenedSupportTicket, SupportStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select open_support_ticket(
          ${telegramId}::bigint,
          ${input.category}::support_ticket_type,
          ${input.message}::text,
          null::text,
          ${input.orderId}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const ticketId = readText(payload.ticket_id);
    const reference = payload.reference;
    if (ticketId === null || !isSupportTicketReference(reference)) {
      return err(failed("MALFORMED_RESULT"));
    }
    return ok({ reference, ticketId, category: input.category });
  }

  async listTickets(input: {
    readonly telegramUserId: string;
    readonly limit: number;
    readonly cursor: SupportTicketCursor | null;
  }): Promise<Result<RiderSupportPage, SupportStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select rider_support_tickets(
          ${telegramId}::bigint,
          ${input.limit}::integer,
          ${input.cursor?.createdAt ?? null}::timestamptz,
          ${input.cursor?.id ?? null}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    if (!Array.isArray(payload.tickets)) return err(failed("MALFORMED_RESULT"));
    const tickets: RiderSupportTicket[] = [];
    for (const raw of payload.tickets) {
      const ticket = readTicket(raw);
      // **صفٌّ لا يُفهَمُ يُسقِطُ الصفحةَ كلَّها** ولا يُحذَفُ منها بصمتٍ:
      // صفحةٌ ناقصةُ صفٍّ تُقرأُ «لا تذكرةَ لكَ» وهي كذبةٌ.
      if (ticket === null) return err(failed("MALFORMED_RESULT"));
      tickets.push(ticket);
    }

    if (typeof payload.has_more !== "boolean") return err(failed("MALFORMED_RESULT"));
    const nextCursor = payload.next_cursor === null ? null : readCursor(payload.next_cursor);
    // «مزيدٌ» بلا مؤشِّرٍ ورطةٌ: الشاشةُ تُظهِرُ «المزيد» ولا تعرفُ من أينَ.
    if (payload.has_more && nextCursor === null) return err(failed("MALFORMED_RESULT"));

    const expected = payload.expected_response_minutes;
    const expectedResponseMinutes =
      expected === null || expected === undefined ? null : readInteger(expected);
    if (expected !== null && expected !== undefined && expectedResponseMinutes === null) {
      return err(failed("MALFORMED_RESULT"));
    }

    return ok({
      tickets,
      hasMore: payload.has_more,
      nextCursor,
      expectedResponseMinutes:
        expectedResponseMinutes !== null && expectedResponseMinutes > 0
          ? expectedResponseMinutes
          : null,
    } satisfies RiderSupportPage);
  }
}
