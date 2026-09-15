/**
 * الغرض: محوّلُ دعمِ الراكبِ على PostgreSQL — نداءُ `open_support_ticket`
 *   ونداءُ `rider_support_tickets`، وقراءةُ حمولتِهما **بلا افتراضٍ**
 *   (`F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: infrastructure/support
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * ملاحظةٌ (`F3-08`): **أحكامُ قراءةِ الحمولةِ نُقِلَت إلى `ticket-store.ts`**
 *   ليقرأَها محوّلُ السائقِ بعينِها؛ وبقيَ ههنا **نصُّ الاستعلامَينِ ظاهراً**
 *   حرفاً — والعِلّةُ مكتوبةٌ في رأسِ النواةِ.
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

import type { RiderSupportStore, SupportStoreError } from "../../application/support/ports.ts";
import type { OpenedSupportTicket, RiderSupportPage } from "../../domain/support/rider-support.ts";
import type { SupportTicketCursor } from "../../domain/support/ticket-types.ts";
import { err, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import {
  asTelegramId,
  failed,
  type ResultRow,
  readOpenedTicket,
  readTicketsPage,
} from "./ticket-store.ts";

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

    return readOpenedTicket(rows[0]?.result, input.category);
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

    return readTicketsPage(rows[0]?.result);
  }
}
