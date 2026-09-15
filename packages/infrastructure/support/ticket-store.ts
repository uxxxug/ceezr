/**
 * الغرض: **نواةُ قراءةِ حمولةِ تذاكرِ الدعمِ** من PostgreSQL — تصنيفُ الرفضِ
 *   وقراءةُ الصفِّ والصفحةِ **بلا افتراضٍ**، بلا دورٍ (`F3-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (مُستخرَجٌ من `rider-support-store.ts`
 *   بلا تغييرِ سلوكٍ؛ ويُقاسُ ذلكَ بتكاملِ الراكبِ القائمِ كما هوَ).
 * ينتمي إلى: infrastructure/support
 * يُستخدم من: `rider-support-store.ts` · `driver-support-store.ts`
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ النواةُ قراءةُ الحمولةِ ولا الاستعلامُ نفسُه
 *
 * الحمولةُ **واحدةٌ حرفاً**: `rider_support_tickets` و`driver_support_tickets`
 * تُعيدانِ الشكلَ نفسَه بالرموزِ نفسِها، فقراءتُها مرَّتَينِ تعني أنَّ إحكاماً
 * يُزادُ في محوّلٍ ويُنسى في الآخرِ — وذاكَ عينُ ما يُنتِجُ صفحةً تُقرأُ «لا
 * تذكرةَ لكَ» عندَ دورٍ واحدٍ.
 *
 * **أمّا نصُّ الاستعلامِ فيبقى في محوّلِ كلِّ دورٍ مكتوباً حرفاً**: اسمُ دالّةٍ
 * يُبنى في زمنِ التشغيلِ يُخفي عن القارئِ **أيَّ دالّةٍ تُنادى**، ويجعلُ فحصَ
 * النصِّ (`grep`) لا يجدُ نداءً قائماً. فالمُكرَّرُ ههنا **ثلاثةُ أسطرِ سباكةٍ
 * ظاهرةٍ**، والمُوحَّدُ **كلُّ حكمٍ**.
 *
 * ## وما لا تفعلُه هذه النواةُ عن قصدٍ
 *
 *   ــ **لا تعرفُ `Sql`**: تقرأُ قيمةً `unknown` لا تُنادي قاعدةً.
 *   ــ **لا تُصنِّفُ عطبَ شبكةٍ رفضاً**: الاستثناءُ يُلقَطُ في المحوّلِ.
 */

import type { SupportStoreError, SupportStoreRejection } from "../../application/support/ports.ts";
import {
  isSupportTicketReference,
  isSupportTicketStatus,
  type SupportTicketCursor,
} from "../../domain/support/rider-support.ts";
import type { SupportTicketsPage, SupportTicketView } from "../../domain/support/ticket-types.ts";
import { isSupportTicketType } from "../../domain/support/ticket-types.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

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

export function failed(
  reason: SupportStoreError extends never ? never : "STORE_ERROR" | "MALFORMED_RESULT",
) {
  return { reason } as const;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readInstant(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

/** كما في `sos-surface-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
export function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

export function rejectionFrom(payload: Record<string, unknown>): SupportStoreError {
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

export function readTicket(value: unknown): SupportTicketView | null {
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
  // **مجالُ القراءةِ هوَ النوعُ كلُّه** لا مجالُ الراكبِ (`F3-08`): حسابٌ سائقٌ
  // وراكبٌ تُكتَبُ تذكرتُه بمعرِّفَي الدورَينِ معاً، فصفحتُه الراكبةُ تحملُ صنفَ
  // سائقٍ — وردُّ صنفٍ لا يعرفُه هذا المحوّلُ يُسقِطُ **الصفحةَ كلَّها** بـ`503`
  // على شاشةِ راكبٍ لم يفعلْ شيئاً. وكانَ الشرطُ يقبلُ `subscription` وحدَها
  // استثناءً، **فصارَ يقبلُ النوعَ كلَّه قاعدةً** — توسيعٌ لا تخفيفٌ (`ح-8`):
  // **والكتابةُ لم تُمَسَّ** (`isRiderSupportCategory` تحكمُها في الطبقةِ،
  // و`NOT_A_DRIVER` في القاعدةِ).
  if (!isSupportTicketType(category)) return null;
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

export function readCursor(value: unknown): SupportTicketCursor | null {
  if (!isRecord(value)) return null;
  const createdAt = readInstant(value.created_at);
  const id = readText(value.id);
  if (createdAt === null || id === null) return null;
  return { createdAt, id };
}

export interface ResultRow {
  readonly result: unknown;
}

/**
 * قراءةُ صفحةِ تذاكرَ من حمولةِ الدالّةِ — **الأحكامُ كلُّها ههنا**: صفٌّ لا
 * يُفهَمُ يُسقِطُ الصفحةَ، و«مزيدٌ» بلا مؤشِّرٍ عطبٌ، ودقائقُ لا تُقرأُ عطبٌ.
 */
export function readTicketsPage(payload: unknown): Result<SupportTicketsPage, SupportStoreError> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  if (!Array.isArray(payload.tickets)) return err(failed("MALFORMED_RESULT"));
  const tickets: SupportTicketView[] = [];
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
  } satisfies SupportTicketsPage);
}

/**
 * قراءةُ إيصالِ الفتحِ — المرجعُ **يُفحَصُ صيغةً** لا يُعادُ كما جاءَ، بالعِلّةِ
 * المكتوبةِ في محوّلِ الراكبِ (مرجعٌ مُشوَّهٌ يُملى على موظّفٍ فلا يجدُ شيئاً).
 */
export function readOpenedTicket<C extends string>(
  payload: unknown,
  category: C,
): Result<
  { readonly reference: string; readonly ticketId: string; readonly category: C },
  SupportStoreError
> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  const ticketId = readText(payload.ticket_id);
  const reference = payload.reference;
  if (ticketId === null || !isSupportTicketReference(reference)) {
    return err(failed("MALFORMED_RESULT"));
  }
  return ok({ reference, ticketId, category });
}

export type { SupportTicketCursor };
